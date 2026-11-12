import { Hono } from 'hono';
import { actor, assert, byIP, cookie, identify, local, origin, Problem, readJSON, session, setCookie, sha256, str, throttle, uuid, type AppEnv } from './common';
import { listCatalog, paymentReady, publicRelease, releaseSelect, samples, type ReleaseRow } from './catalog';
import { githubRoutes, githubWebhook } from './github';
import { reviewRoutes, sellerRoutes } from './seller';
import { commerceOperator, library, paypalWebhook, purchases } from './commerce';
import { verification } from './verification';
import { literalBrief, normalize, rank } from './search';
import { finder } from './finder';
import { geminiLimits, geminiUsage } from './gemini';
import { canStart, costAdmin, costAlertCount, costSummary, isCostAdmin, operations, releaseUnusedReservations, updatePause, type Operation } from './cost';
import { meterRequests } from './metering';

export const app = new Hono<AppEnv>().basePath('/api');
app.onError((error, c) => {
  if (error instanceof Problem) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'The service could not complete the request. Try again or contact support.' }, 500);
});
app.notFound(c => c.json({ error: 'This API route does not exist.' }, 404));
app.use('*', meterRequests);
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  const path = c.req.path;
  const incomingOrigin = c.req.header('origin');
  if (!['GET','HEAD'].includes(c.req.method) && !path.startsWith('/api/webhooks/') && !path.startsWith('/api/operator/')) {
    assert(incomingOrigin === origin(c), 403, 'Open Zcode directly to submit this request.');
  }
  c.set('actor', path.startsWith('/api/webhooks/') || path.startsWith('/api/operator/') ? null : await identify(c));
  if (c.get('actor')?.id.startsWith('demo-') && !local(c)) c.set('actor', null);
  await next();
});
app.get('/health', async c => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first();
  return c.json({ ok: Boolean(row), database: 'd1', privateStorage: Boolean(c.env.ARTIFACTS),
    inference: Boolean(geminiLimits(c.env)), sandboxConfigured: paymentReady(c.env) });
});
app.get('/session', async c => c.json({ account: c.get('actor'), localDemo: local(c),
  isCostAdmin: isCostAdmin(c), ...(isCostAdmin(c) ? { costAlerts: await costAlertCount(c.env).catch(() => 0) } : {}),
  githubConfigured: Boolean(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET && c.env.APP_ORIGIN) }));
const demoActors = {
  seller: { id: 'demo-seller', name: 'Sample seller', role: 'member' },
  buyer: { id: 'demo-buyer', name: 'Sample buyer', role: 'member' },
  other: { id: 'demo-other', name: 'Second sample buyer', role: 'member' },
  reviewer: { id: 'demo-reviewer', name: 'Sample reviewer', role: 'reviewer' },
  admin: { id: 'demo-admin', name: 'Sample administrator', role: 'member' },
};
app.post('/session/demo', async c => {
  assert(local(c), 404, 'Local demo accounts are unavailable.');
  const role = str((await readJSON(c)).role);
  assert(Object.hasOwn(demoActors, role), 400, 'Choose a sample identity.');
  const account = demoActors[role as keyof typeof demoActors];
  const old = cookie(c, 'zsession');
  if (old) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(old)).run();
  await c.env.DB.prepare('INSERT OR IGNORE INTO accounts(id,name,role) VALUES (?,?,?)').bind(account.id, account.name, account.role).run();
  await session(c, account.id);
  return c.json({ account });
});
app.post('/session/logout', async c => {
  const token = cookie(c, 'zsession');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  setCookie(c, 'zsession', '', 0);
  return c.json({ account: null });
});
app.get('/catalog', async c => c.json({ releases: await listCatalog(c.env, local(c)) }));
app.get('/catalog/:id', async c => {
  const id = c.req.param('id');
  const sample = samples.find(item => item.id === id && (!item.fixture || local(c)));
  if (sample) return c.json(sample);
  const row = await c.env.DB.prepare(releaseSelect + " WHERE r.id=? AND r.status='published'").bind(id).first<ReleaseRow>();
  assert(row, 404, 'This release is unavailable.');
  const item = publicRelease(row, c.env);
  const active = await c.env.DB.prepare('SELECT 1 FROM listings WHERE active_release=?').bind(id).first();
  return c.json({ ...item, purchasable: item.purchasable && Boolean(active) });
});
app.post('/search', async c => {
  const body = await readJSON(c, 6000);
  const query = str(body.query, 360);
  const baseline = body.baseline === true && local(c);
  const apply = body.brief && typeof body.brief === 'object';
  if (!baseline && query) await throttle(c, 'search', c.get('actor')?.id ?? byIP(c), 30, 300);
  const result = apply ? { brief: normalize(body.brief), mode: 'edited', model: null } : { brief: literalBrief(query), mode: 'literal', model: null };
  return c.json({ ...result, ...await rank(c, await listCatalog(c.env, local(c)), query, result.brief, true) });
});
app.get('/checkout/config', async c => {
  actor(c);
  const configured = paymentReady(c.env);
  const paused = configured && !await canStart(c.env, 'checkout');
  return c.json({ configured, paused });
});
app.get('/admin/cost', async c => {
  costAdmin(c);
  return c.json({ ...await costSummary(c.env), gemini: await geminiUsage(c.env) });
});
app.post('/admin/cost/pause', async c => {
  const account = costAdmin(c);
  const input = await readJSON(c, 2048);
  const operation = str(input.operation) as Operation;
  const reason = str(input.reason, 240);
  assert(operations.includes(operation) && typeof input.paused === 'boolean' && reason.length >= 8, 400,
    'Choose an operation and provide a reason of at least eight characters.');
  await updatePause(c.env, operation, input.paused, reason, account.id);
  return c.json(await costSummary(c.env));
});
app.post('/admin/cost/storage-recovery', async c => {
  const account = costAdmin(c);
  await throttle(c, 'storage-recovery', account.id, 6, 3600);
  return c.json({ released: await releaseUnusedReservations(c.env, account.id) });
});
app.post('/support', async c => {
  const account = actor(c);
  await throttle(c, 'support', account.id, 8, 3600);
  const input = await readJSON(c);
  const message = str(input.message, 2500);
  const purchase = str(input.purchaseId, 64);
  let releaseId = str(input.releaseId, 64);
  assert(message.length >= 12, 400, 'Describe the issue so support can reproduce it.');
  if (purchase) {
    const row = await c.env.DB.prepare('SELECT release_id FROM purchases WHERE id=? AND buyer_id=?').bind(purchase, account.id).first<{ release_id: string }>();
    assert(row, 404, 'Receipt not found.');
    releaseId = row.release_id;
  } else if (releaseId) {
    const row = await c.env.DB.prepare("SELECT 1 FROM releases WHERE id=? AND (status IN ('published','held') OR listing_id IN (SELECT id FROM listings WHERE seller_id=?))")
      .bind(releaseId, account.id).first();
    assert(row, 404, 'Release not found.');
  }
  const id = uuid();
  await c.env.DB.prepare('INSERT INTO support_cases(id,account_id,purchase_id,message,release_id) VALUES (?,?,?,?,?)')
    .bind(id, account.id, purchase || null, message, releaseId || null).run();
  return c.json({ id }, 201);
});
app.get('/support', async c => {
  const account = actor(c);
  const records = await c.env.DB.prepare('SELECT id,purchase_id,message,resolution,created_at FROM support_cases WHERE account_id=? ORDER BY created_at DESC LIMIT 50')
    .bind(account.id).all();
  return c.json({ cases: records.results });
});
app.get('/support/desk', async c => {
  actor(c, true);
  const records = await c.env.DB.prepare('SELECT s.id,s.purchase_id,s.release_id,s.message,s.resolution,s.created_at,r.status AS release_status FROM support_cases s LEFT JOIN releases r ON r.id=s.release_id ORDER BY s.created_at DESC LIMIT 40').all();
  return c.json({ cases: records.results });
});
app.post('/support/desk/:id', async c => {
  actor(c, true);
  const resolution = str((await readJSON(c)).resolution, 2500);
  assert(resolution.length >= 8, 400, 'Add a resolution or next action.');
  const row = await c.env.DB.prepare('UPDATE support_cases SET resolution=? WHERE id=? RETURNING id')
    .bind(resolution, c.req.param('id')).first();
  assert(row, 404, 'Support case not found.');
  return c.json(row);
});
app.post('/support/desk/:id/hold', async c => {
  const reviewer = actor(c, true);
  const caseId = c.req.param('id');
  const input = await readJSON(c);
  const reason = str(input.reason, 1000);
  const lifting = input.action === 'lift';
  assert(reason.length >= 8 && (lifting || input.action === 'hold'), 400, 'Choose a release hold action and record its rationale.');
  const record = await c.env.DB.prepare('SELECT s.release_id,r.status,l.seller_id FROM support_cases s JOIN releases r ON r.id=s.release_id JOIN listings l ON l.id=r.listing_id WHERE s.id=?')
    .bind(caseId).first<{ release_id: string; status: string; seller_id: string }>();
  assert(record && record.seller_id !== reviewer.id, 404, 'This case has no release you can moderate.');
  const id = record.release_id;
  if (lifting) {
    assert(record.status === 'held', 409, 'This release is not on hold.');
    const [change] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE releases SET status=(SELECT prior_status FROM release_holds WHERE release_id=? AND resolved_at IS NULL) WHERE id=? AND status='held' AND EXISTS(SELECT 1 FROM release_holds WHERE release_id=? AND resolved_at IS NULL)")
        .bind(id, id, id),
      c.env.DB.prepare('UPDATE release_holds SET resolved_at=unixepoch() WHERE release_id=? AND resolved_at IS NULL').bind(id),
      c.env.DB.prepare('UPDATE support_cases SET resolution=? WHERE id=?').bind('Release hold lifted. ' + reason, caseId),
    ]);
    assert(change.meta.changes, 409, 'The release hold changed.');
  } else {
    assert(['published','archived'].includes(record.status), 409, 'This release cannot be put on hold.');
    const [, change] = await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO release_holds(release_id,case_id,reviewer_id,reason,prior_status) SELECT id,?,?,?,status FROM releases WHERE id=? AND status IN ('published','archived') " +
        "ON CONFLICT(release_id) DO UPDATE SET case_id=excluded.case_id,reviewer_id=excluded.reviewer_id,reason=excluded.reason,prior_status=excluded.prior_status,created_at=unixepoch(),resolved_at=NULL WHERE release_holds.resolved_at IS NOT NULL")
        .bind(caseId, reviewer.id, reason, id),
      c.env.DB.prepare("UPDATE releases SET status='held' WHERE id=? AND status IN ('published','archived') AND EXISTS(SELECT 1 FROM release_holds WHERE release_id=? AND case_id=? AND resolved_at IS NULL)")
        .bind(id, id, caseId),
      c.env.DB.prepare('UPDATE support_cases SET resolution=? WHERE id=?').bind('Checkout and downloads paused for review. ' + reason, caseId),
    ]);
    assert(change.meta.changes, 409, 'The release hold changed.');
  }
  return c.json({ releaseId: id });
});
app.route('/github', githubRoutes);
app.route('/finder', finder);
app.route('/seller', sellerRoutes);
app.route('/reviews', reviewRoutes);
app.route('/purchases', purchases);
app.route('/library', library);
app.route('/operator/jobs', verification);
app.route('/operator', commerceOperator);
app.post('/webhooks/github', githubWebhook);
app.post('/webhooks/paypal', paypalWebhook);
