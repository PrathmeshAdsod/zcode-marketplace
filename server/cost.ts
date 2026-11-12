import { actor, assert, local, Problem, type Ctx, type Env } from './common';
import { paymentReady } from './catalog';

type Period = 'day' | 'rolling' | 'stored';
type Budget = { label: string; unit: string; period: Period; allowance: number; allocation: number };
const budget = (label: string, unit: string, period: Period, allowance: number, allocation = allowance): Budget =>
  ({ label, unit, period, allowance, allocation });

// Allocations leave headroom for other account workloads, meter writes, and protected commerce.
export const budgets = {
  api: budget('API requests', 'requests', 'day', 100_000, 20_000),
  dbRead: budget('D1 rows read', 'rows', 'day', 5_000_000, 2_000_000),
  dbWrite: budget('D1 rows written', 'rows', 'day', 100_000, 35_000),
  r2Bytes: budget('R2 reserved storage', 'bytes', 'stored', 10_000_000_000, 1_000_000_000),
  r2A: budget('R2 Class A operations', 'operations', 'rolling', 1_000_000, 12_000),
  r2B: budget('R2 Class B operations', 'operations', 'rolling', 10_000_000, 120_000),
  aiRequests: budget('AI inference calls', 'calls', 'day', 250),
  aiInput: budget('AI input token reservation', 'estimated tokens', 'day', 400_000),
  aiOutput: budget('AI output token reservation', 'tokens', 'day', 60_000),
  aiNeurons: budget('Workers AI compute reservation', 'estimated neurons', 'day', 10_000, 2_000),
  verifyJobs: budget('Verification executions', 'jobs', 'day', 20),
  verifyTime: budget('Verification execution reservation', 'seconds', 'day', 1200),
} satisfies Record<string, Budget>;
export type Metric = keyof typeof budgets;
export type Operation = 'ai' | 'verification' | 'checkout';
export const operations: Operation[] = ['ai', 'verification', 'checkout'];
const common: Metric[] = ['api','dbRead','dbWrite'];
const required: Record<Operation, Metric[]> = {
  ai: [...common, 'aiRequests', 'aiInput', 'aiOutput'],
  verification: [...common, 'verifyJobs','verifyTime','r2Bytes','r2A','r2B'],
  checkout: [...common, 'r2B'],
};
const table = (env: Env) => env.COST_DB ?? env.DB;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const rollingDays = 31;
const dayMs = 86_400_000;
export const jobBudget = { concurrency: 1, seconds: 60, archiveBytes: 8 * 1024 * 1024 };
export const cutoff = (key: Metric) => Math.floor(budgets[key].allocation * .8);
type Charge = Partial<Record<Metric, number>>;

function window(metric: Metric, now: number) {
  const period = budgets[metric].period;
  return {
    at: period === 'stored' ? 'all' : date(now),
    since: period === 'stored' ? 'all' : period === 'rolling' ? date(now - dayMs * (rollingDays - 1)) : date(now),
  };
}
function rows(charge: Charge, protectedRead = false) {
  const now = Date.now();
  return (Object.entries(charge) as [Metric, number][]).filter(([, value]) => value > 0).map(([metric, amount]) => ({
    metric, amount, ...window(metric, now), limit: protectedRead && metric === 'r2B' ? budgets.r2B.allocation : cutoff(metric),
  }));
}
const values = "SELECT json_extract(value,'$.metric') metric, json_extract(value,'$.at') period," +
  " json_extract(value,'$.since') since, json_extract(value,'$.amount') amount, json_extract(value,'$.limit') ceiling FROM json_each(?)";

async function alert(env: Env, metric: Metric, reason: string) {
  await table(env).prepare('INSERT OR IGNORE INTO cost_alerts(metric,period,reason) VALUES (?,?,?)')
    .bind(metric, window(metric, Date.now()).at, reason).run();
}

// A materialized snapshot makes a multi-metric grant all-or-nothing, even across concurrent requests.
export async function reserve(env: Env, charge: Charge, protectedRead = false) {
  const requests = rows(charge, protectedRead);
  if (!requests.length) return true;
  const result = await table(env).prepare(
    'WITH requested AS MATERIALIZED (' + values + '), totals AS MATERIALIZED (' +
    ' SELECT r.*,COALESCE((SELECT SUM(amount) FROM cost_usage u WHERE u.metric=r.metric AND u.period BETWEEN r.since AND r.period),0) used FROM requested r)' +
    ' INSERT INTO cost_usage(metric,period,amount) SELECT metric,period,amount FROM totals' +
    ' WHERE NOT EXISTS (SELECT 1 FROM totals WHERE used+amount>ceiling)' +
    ' ON CONFLICT(metric,period) DO UPDATE SET amount=cost_usage.amount+excluded.amount RETURNING metric,amount'
  ).bind(JSON.stringify(requests)).all<{ metric: Metric; amount: number }>();
  if (result.results.length === requests.length) {
    const rolling = requests.filter(request => budgets[request.metric].period === 'rolling');
    const rollingTotals = rolling.length ? await current(env, rolling.map(request => request.metric)) : {};
    for (const row of result.results) {
      if ((rollingTotals[row.metric] ?? row.amount) >= cutoff(row.metric))
        await alert(env, row.metric, 'Usage reached the 80% admission threshold.');
    }
    return true;
  }
  const snapshot = await current(env, requests.map(r => r.metric));
  for (const request of requests) {
    if ((snapshot[request.metric] ?? 0) + request.amount > request.limit) {
      await alert(env, request.metric, protectedRead ? 'Protected download reserve exhausted.' : 'Usage would exceed the 80% admission threshold.');
    }
  }
  return false;
}
export async function record(env: Env, charge: Charge) {
  const requests = rows(charge);
  if (!requests.length) return;
  const result = await table(env).prepare(
    'WITH requested AS (' + values + ')' +
    ' INSERT INTO cost_usage(metric,period,amount) SELECT metric,period,amount FROM requested WHERE true' +
    ' ON CONFLICT(metric,period) DO UPDATE SET amount=cost_usage.amount+excluded.amount RETURNING metric,amount'
  ).bind(JSON.stringify(requests)).all<{ metric: Metric; amount: number }>();
  for (const row of result.results) {
    if (row.amount >= cutoff(row.metric)) await alert(env, row.metric, 'Usage reached the 80% admission threshold.');
  }
}
async function current(env: Env, metrics: Metric[]) {
  const now = Date.now();
  const input = metrics.map(metric => ({ metric, ...window(metric, now), amount: 0, limit: 0 }));
  const data = await table(env).prepare(
    'WITH requested AS (' + values + ')' +
    ' SELECT r.metric, COALESCE(SUM(u.amount),0) used FROM requested r LEFT JOIN cost_usage u' +
    ' ON u.metric=r.metric AND u.period BETWEEN r.since AND r.period GROUP BY r.metric'
  ).bind(JSON.stringify(input)).all<{ metric: Metric; used: number }>();
  return Object.fromEntries(data.results.map(r => [r.metric, r.used])) as Partial<Record<Metric, number>>;
}
async function manual(env: Env, operation: Operation) {
  return table(env).prepare('SELECT reason FROM cost_pauses WHERE operation=? AND paused=1').bind(operation).first<{ reason: string }>();
}
export async function canStart(env: Env, operation: Operation, notify = true) {
  if (await manual(env, operation)) return false;
  if (operation !== 'ai' && !env.ARTIFACTS) return false;
  const used = await current(env, required[operation]);
  const reached = required[operation].filter(metric => (used[metric] ?? 0) >= cutoff(metric));
  if (notify) for (const metric of reached) await alert(env, metric, 'Usage reached the 80% admission threshold.');
  return !reached.length;
}
export async function requireCapacity(env: Env, operation: Operation) {
  assert(await canStart(env, operation).catch(() => false), 503, operation === 'checkout'
    ? 'New payments are paused while delivery capacity is limited. Your library and receipts are still available.'
    : 'New verification work is paused while capacity is limited. Your draft is saved.');
}
export async function aiCapacity(env: Env, input: number, output: number, kind: 'chat' | 'embed', cloud: boolean) {
  if (!await canStart(env, 'ai')) return false;
  // Reserve one token per UTF-8 byte plus framing, rounded up with extra compute margin.
  const neurons = kind === 'chat' ? Math.ceil(input * .003 + output * .016) : Math.ceil(input * .002);
  return reserve(env, { aiRequests: 1, aiInput: input, aiOutput: output, ...(cloud ? { aiNeurons: Math.max(1, neurons) } : {}) });
}

export async function artifactHead(env: Env, key: string, protectedRead = false) {
  if (!env.ARTIFACTS) return null;
  assert(await reserve(env, { r2B: 1 }, protectedRead), 503,
    'Archive storage is temporarily at its read limit. Retry from your receipt.');
  try { return await env.ARTIFACTS.head(key); }
  catch { throw new Problem(503, 'Archive storage is temporarily unavailable. Retry from your receipt.'); }
}
export async function artifactGet(env: Env, key: string) {
  if (!env.ARTIFACTS) return null;
  assert(await reserve(env, { r2B: 1 }, true), 503,
    'Archive storage is temporarily at its read limit. Retry from your receipt.');
  try { return await env.ARTIFACTS.get(key); }
  catch { throw new Problem(503, 'Archive storage is temporarily unavailable. Retry from your receipt.'); }
}
export async function reserveArtifact(env: Env, key: string, digest: string, bytes: number) {
  assert(await reserve(env, { r2A: 1 }), 503, 'Archive uploads are paused while storage capacity is limited.');
  // Reserve bytes before R2 writes and retain the charge if the write outcome is ambiguous.
  const stored = await table(env).prepare(
    'INSERT OR IGNORE INTO cost_artifacts(object_key,digest,bytes)' +
    " SELECT ?,?,? WHERE COALESCE((SELECT amount FROM cost_usage WHERE metric='r2Bytes' AND period='all'),0)+?<=?"
  ).bind(key, digest, bytes, bytes, cutoff('r2Bytes')).run();
  if (stored.meta.changes) {
    const total = await current(env, ['r2Bytes']);
    if ((total.r2Bytes ?? 0) >= cutoff('r2Bytes')) await alert(env, 'r2Bytes', 'Usage reached the 80% admission threshold.');
  }
  if (!stored.meta.changes) {
    const existing = await table(env).prepare('SELECT digest,bytes FROM cost_artifacts WHERE object_key=?').bind(key).first<{ digest: string; bytes: number }>();
    if (!existing) {
      await alert(env, 'r2Bytes', 'The next archive would exceed the storage threshold.');
      throw new Problem(503, 'Archive uploads are paused while storage capacity is limited.');
    }
    assert(existing.digest === digest && existing.bytes === bytes, 409, 'This lease already reserved a different archive.');
  }
}
export function isCostAdmin(c: Ctx) {
  const id = c.get('actor')?.id;
  return Boolean(id && (id === 'demo-admin' ? local(c) :
    (c.env.COST_ADMIN_GITHUB_IDS ?? '').split(',').map(value => value.trim()).includes(id)));
}
export function costAdmin(c: Ctx) {
  const account = actor(c);
  assert(isCostAdmin(c), 403, 'Usage administration requires an authorized administrator.');
  return account;
}
export async function costSummary(env: Env) {
  const metrics = Object.keys(budgets) as Metric[];
  const usage = await current(env, metrics);
  const pauses = await table(env).prepare('SELECT operation,paused,reason,changed_at FROM cost_pauses').all<{ operation: Operation; paused: number; reason: string; changed_at: number }>();
  const notifications = await table(env).prepare('SELECT metric,reason,created_at FROM cost_alerts ORDER BY created_at DESC LIMIT 16').all<{ metric: Metric; reason: string; created_at: number }>();
  const leases = await table(env).prepare("SELECT COUNT(*) n FROM outbox WHERE kind='verify' AND state='leased' AND lease_until>unixepoch()").first<{ n: number }>();
  return {
    metrics: metrics.map(key => ({ key, ...budgets[key], used: usage[key] ?? 0, threshold: cutoff(key) })),
    operations: operations.map(operation => ({
      operation, manual: pauses.results.find(pause => pause.operation === operation) ?? null,
      limits: required[operation].filter(metric => (usage[metric] ?? 0) >= cutoff(metric)),
      storageMissing: operation !== 'ai' && !env.ARTIFACTS,
      paymentsMissing: operation === 'checkout' && !paymentReady(env),
    })),
    alerts: notifications.results.map(item => ({ ...item, label: budgets[item.metric]?.label ?? item.metric })),
    verification: { ...jobBudget, active: leases?.n ?? 0 },
    asOf: new Date().toISOString(),
  };
}
export async function updatePause(env: Env, operation: Operation, paused: boolean, reason: string, who: string) {
  const db = table(env);
  await db.batch([
    db.prepare('INSERT INTO cost_pauses(operation,paused,reason,changed_by) VALUES (?,?,?,?)' +
      ' ON CONFLICT(operation) DO UPDATE SET paused=excluded.paused,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=unixepoch()')
      .bind(operation, Number(paused), reason, who),
    db.prepare('INSERT INTO cost_actions(id,operation,paused,reason,changed_by) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), operation, Number(paused), reason, who),
  ]);
}
export async function costAlertCount(env: Env) {
  const row = await table(env).prepare('SELECT COUNT(*) n FROM cost_alerts WHERE created_at>unixepoch()-86400')
    .first<{ n: number }>();
  return row?.n ?? 0;
}
export async function releaseUnusedReservations(env: Env, who: string) {
  assert(env.ARTIFACTS, 503, 'Private archive storage is unavailable.');
  const db = table(env);
  const unreferenced = "created_at<unixepoch()-86400 AND NOT EXISTS(SELECT 1 FROM releases WHERE artifact_key=cost_artifacts.object_key)";
  const candidates = await db.prepare('SELECT object_key FROM cost_artifacts WHERE ' + unreferenced + ' ORDER BY created_at LIMIT 10')
    .all<{ object_key: string }>();
  let released = 0;
  for (const { object_key } of candidates.results) {
    if (await artifactHead(env, object_key, true)) continue;
    const result = await db.prepare('DELETE FROM cost_artifacts WHERE object_key=? AND ' + unreferenced + ' RETURNING object_key').bind(object_key).first();
    if (result) released++;
  }
  await db.prepare("INSERT INTO cost_actions(id,operation,paused,reason,changed_by) VALUES (?,'storage-recovery',0,?,?)")
    .bind(crypto.randomUUID(), 'Confirmed missing reservations released: ' + released, who).run();
  return released;
}
