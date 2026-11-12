import { Hono } from 'hono';
import { assert, equal, readBytes, readJSON, sha256, str, uuid, type AppEnv, type Ctx } from './common';
import { getArchive, type Connection } from './github';
import { capabilities, type Capability, type Finding, type FindingStatus, type Report } from '../src/domain';
import { artifactHead, jobBudget, requireCapacity, reserve, reserveArtifact } from './cost';

const MAX = jobBudget.archiveBytes;
type Job = { id: string; subject: string; lease_id: string; attempts: number };
type Work = Connection & { commit_sha: string; seller_id: string };
function runner(c: Ctx) {
  assert(c.env.RUNNER_TOKEN && c.env.RUNNER_TOKEN.length >= 32 &&
    equal(c.req.header('authorization') ?? '', 'Bearer ' + c.env.RUNNER_TOKEN), 403, 'Runner access is required.');
  assert(c.env.ARTIFACTS, 503, 'Private artifact storage is awaiting setup.');
}
async function lease(c: Ctx) {
  runner(c);
  const id = c.req.param('id');
  const lease = str(c.req.header('x-lease-id'), 64);
  const job = await c.env.DB.prepare("SELECT * FROM outbox WHERE kind='verify' AND subject=? AND lease_id=? AND state='leased' AND lease_until>unixepoch()")
    .bind(id, lease).first<Job>();
  assert(job, 404, 'Verification lease expired.');
  return job;
}
const objectKey = (id: string, leaseId: string) => 'releases/' + id + '/' + leaseId + '.zip';
const findingStates: FindingStatus[] = ['pass', 'fail', 'untested', 'inconclusive'];

function reportFrom(input: unknown): Report {
  assert(input && typeof input === 'object', 400, 'Verification report is missing.');
  const fields = input as Record<string, unknown>;
  const digest = str(fields.digest);
  const environment = str(fields.environment, 400);
  const checkedAt = str(fields.checkedAt, 50);
  const elapsedMs = Number(fields.elapsedMs);
  assert(/^[a-f0-9]{64}$/.test(digest) && environment && Number.isFinite(Date.parse(checkedAt)) &&
    Number.isSafeInteger(elapsedMs) && elapsedMs > 0 && elapsedMs < 180000 &&
    fields.adapter === 'node-browser-trail/1' && Array.isArray(fields.findings) && fields.findings.length <= 8, 400, 'Invalid verification report.');
  const keys = new Set<Capability>();
  const findings: Finding[] = fields.findings.map((finding: Partial<Finding>) => {
    assert(finding && finding.capability && Object.hasOwn(capabilities, finding.capability) &&
      !keys.has(finding.capability) && finding.status && findingStates.includes(finding.status) &&
      str(finding.observation, 400), 400, 'Invalid verification finding.');
    keys.add(finding.capability);
    return {
      id: 'ev-' + digest.slice(0, 12) + '-' + finding.capability, capability: finding.capability,
      status: finding.status, observation: str(finding.observation, 400),
    };
  });
  const corePassed = fields.corePassed === true;
  assert(!corePassed || ['local', 'browser', 'keyboard'].every(key => findings.some(f => f.capability === key && f.status === 'pass')),
    400, 'Core verification requires successful install, launch and keyboard gameplay.');
  return { adapter: fields.adapter, environment, checkedAt, elapsedMs, digest, corePassed, findings };
}

export const verification = new Hono<AppEnv>();
verification.post('/claim', async c => {
  runner(c);
  const repoId = (await readJSON(c)).repoId;
  assert(Number.isSafeInteger(repoId) && Number(repoId) > 0, 400, 'Specify the operator-authorized repository ID.');
  await requireCapacity(c.env, 'verification');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE releases SET status='changes',block_reason='Verification retries exhausted. Contact support or submit a corrected revision.' WHERE status='queued' AND id IN (SELECT subject FROM outbox WHERE kind='verify' AND state='leased' AND attempts>=3 AND lease_until<=unixepoch())"),
    c.env.DB.prepare("UPDATE outbox SET state='dead' WHERE kind='verify' AND state='leased' AND attempts>=3 AND lease_until<=unixepoch()"),
  ]);
  const eligible =
    "SELECT o.id FROM outbox o JOIN releases r ON r.id=o.subject JOIN listings l ON l.id=r.listing_id " +
    "JOIN repo_connections g ON g.seller_id=l.seller_id AND g.repo_id=r.repo_id AND g.installation_id=r.installation_id " +
    "WHERE o.kind='verify' AND o.attempts<3 AND o.available_at<=unixepoch() AND r.status='queued' AND g.revoked_at IS NULL AND r.repo_id=? " +
    "AND (o.state='ready' OR (o.state='leased' AND o.lease_until<=unixepoch())) " +
    "AND (SELECT COUNT(*) FROM outbox WHERE kind='verify' AND state='leased' AND lease_until>unixepoch()) < ? " +
    "ORDER BY o.available_at LIMIT 1";
  if (!await c.env.DB.prepare(eligible).bind(repoId, jobBudget.concurrency).first()) return c.json({ id: null });
  assert(await reserve(c.env, { verifyJobs: 1, verifyTime: jobBudget.seconds }), 503, 'Verification has reached its execution budget.');
  const job = await c.env.DB.prepare(
    "UPDATE outbox SET state='leased',attempts=attempts+1,lease_id=?,lease_until=unixepoch()+180 WHERE id=(" +
    eligible + ") RETURNING id,subject,lease_id,attempts"
  ).bind(uuid(), repoId, jobBudget.concurrency).first<Job>();
  return c.json(job ? { id: job.subject, lease: job.lease_id } : { id: null });
});
verification.get('/:id/source', async c => {
  const job = await lease(c);
  const row = await c.env.DB.prepare("SELECT r.commit_sha,r.repo_id,r.installation_id,g.full_name,l.seller_id FROM releases r JOIN listings l ON l.id=r.listing_id " +
    "JOIN repo_connections g ON g.seller_id=l.seller_id AND g.repo_id=r.repo_id AND g.installation_id=r.installation_id WHERE r.id=? AND r.status='queued' AND g.revoked_at IS NULL")
    .bind(job.subject).first<Work>();
  assert(row, 409, 'The pinned repository connection is revoked.');
  const source = await getArchive(c.env, row.seller_id, row, row.commit_sha);
  const length = source.headers.get('content-length');
  assert(!length || Number(length) <= MAX, 413, 'Source archive exceeds the size limit.');
  let size = 0;
  const capped = source.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > MAX) controller.error(new Error('Archive too large'));
      else controller.enqueue(chunk);
    },
  }));
  return new Response(capped, { headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store' } });
});
verification.put('/:id/artifact', async c => {
  const job = await lease(c);
  const bytes = await readBytes(c, MAX);
  const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  assert(signature.join(',') === '80,75,3,4', 400, 'Expected a ZIP archive.');
  const digest = await sha256(bytes);
  assert(equal(digest, c.req.header('x-archive-sha256') ?? ''), 409, 'Archive digest mismatch.');
  const key = objectKey(job.subject, job.lease_id);
  await reserveArtifact(c.env, key, digest, bytes.byteLength);
  const object = await c.env.ARTIFACTS.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: { digest, release: job.subject },
  });
  if (!object) {
    const existing = await artifactHead(c.env, key);
    assert(existing?.customMetadata?.digest === digest, 409, 'A different artifact is already attached to this lease.');
  }
  return c.json({ digest });
});
verification.post('/:id/complete', async c => {
  const job = await lease(c);
  const input = await readJSON(c);
  const key = objectKey(job.subject, job.lease_id);
  const blocked = str(input.blocked, 400);
  const report = blocked ? null : reportFrom(input.report);
  if (report) {
    const object = await artifactHead(c.env, key);
    assert(object?.customMetadata?.digest === report.digest, 409, 'The report must describe the stored archive.');
  }
  const [update] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE releases SET status=?,digest=?,artifact_key=?,report=?,block_reason=? WHERE id=? AND status='queued' " +
      "AND EXISTS (SELECT 1 FROM outbox WHERE id=? AND state='leased' AND lease_id=? AND lease_until>unixepoch()) " +
      "AND EXISTS (SELECT 1 FROM listings l JOIN repo_connections g ON g.seller_id=l.seller_id AND g.repo_id=releases.repo_id " +
      "AND g.installation_id=releases.installation_id AND g.revoked_at IS NULL WHERE l.id=releases.listing_id)")
      .bind(blocked ? 'changes' : 'review', report?.digest ?? null, report ? key : null, report ? JSON.stringify(report) : null,
        blocked || null, job.subject, job.id, job.lease_id),
    c.env.DB.prepare("UPDATE outbox SET state='done',lease_id=NULL,lease_until=NULL WHERE id=? AND state='leased' AND lease_id=? AND lease_until>unixepoch() " +
      "AND EXISTS (SELECT 1 FROM releases WHERE id=? AND status IN ('changes','review'))")
      .bind(job.id, job.lease_id, job.subject),
  ]);
  assert(update.meta.changes, 409, 'The release or verification lease changed.');
  return c.json({ received: true });
});
