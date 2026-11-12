import { Hono } from 'hono';
import { actor, assert, readJSON, str, throttle, uuid, type AppEnv } from './common';
import { draftFrom, releaseSelect, validateSubmission, type ReleaseRow } from './catalog';
import { freezeCommit, type Connection } from './github';
import type { Draft, Report } from '../src/domain';
import { artifactHead, requireCapacity } from './cost';

export const sellerRoutes = new Hono<AppEnv>();
sellerRoutes.get('/listings', async c => {
  const account = actor(c);
  const data = await c.env.DB.prepare(
    'SELECT l.id,l.draft,l.revision,l.active_release,s.slot,r.status,r.id AS release_id,r.report,COALESCE(v.reason,r.block_reason) AS reason FROM listings l ' +
    'LEFT JOIN listing_slots s ON s.listing_id=l.id LEFT JOIN releases r ON r.id=(SELECT rr.id FROM releases rr WHERE rr.listing_id=l.id ORDER BY rr.revision DESC LIMIT 1) ' +
    'LEFT JOIN reviews v ON v.release_id=r.id WHERE l.seller_id=? ORDER BY l.updated_at DESC LIMIT 50'
  ).bind(account.id).all<{ draft: string; report: string | null }>();
  return c.json({ listings: data.results.map(item => ({ ...item, draft: JSON.parse(item.draft), report: item.report && JSON.parse(item.report) })) });
});
sellerRoutes.post('/listings', async c => {
  const account = actor(c);
  await throttle(c, 'draft', account.id, 16, 3600);
  const draft = draftFrom(await readJSON(c));
  const id = uuid();
  const write = await c.env.DB.prepare('INSERT INTO listings(id,seller_id,draft) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM listings WHERE seller_id=?)<50')
    .bind(id, account.id, JSON.stringify(draft), account.id).run();
  assert(write.meta.changes, 409, 'You reached the workspace draft limit.');
  return c.json({ id, revision: 1 }, 201);
});
sellerRoutes.patch('/listings/:id', async c => {
  const account = actor(c);
  const input = await readJSON(c);
  const draft = draftFrom(input);
  const revision = Number(input.revision);
  const row = await c.env.DB.prepare(
    'UPDATE listings SET draft=?,revision=revision+1,updated_at=unixepoch() WHERE id=? AND seller_id=? AND revision=? RETURNING revision'
  ).bind(JSON.stringify(draft), c.req.param('id'), account.id, revision).first();
  assert(row, 409, 'This draft changed or is unavailable. Reload your workspace.');
  return c.json(row);
});
sellerRoutes.post('/listings/:id/submit', async c => {
  const account = actor(c);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT draft,revision FROM listings WHERE id=? AND seller_id=?').bind(id, account.id).first<{ draft: string; revision: number }>();
  assert(row, 404, 'Listing not found.');
  const existing = await c.env.DB.prepare('SELECT id,status FROM releases WHERE listing_id=? AND revision=?').bind(id, row.revision).first();
  if (existing) return c.json(existing);
  await throttle(c, 'submit', account.id, 10, 3600);
  const draft = validateSubmission(JSON.parse(row.draft) as Draft);
  await requireCapacity(c.env, 'verification');
  const connection = await c.env.DB.prepare('SELECT repo_id,installation_id,full_name FROM repo_connections WHERE seller_id=? AND repo_id=? AND revoked_at IS NULL')
    .bind(account.id, draft.repoId).first<Connection>();
  assert(connection, 409, 'Connect the private repository before submitting this draft.');
  const sha = await freezeCommit(c.env, account.id, connection, draft.ref);
  const release = uuid();
  const guard = "EXISTS (SELECT 1 FROM listings WHERE id=? AND seller_id=? AND revision=?) " +
    "AND NOT EXISTS (SELECT 1 FROM releases WHERE listing_id=? AND status IN ('queued','review')) " +
    "AND NOT EXISTS (SELECT 1 FROM releases WHERE repo_id=? AND commit_sha=? AND status IN ('queued','review','published') AND listing_id<>?) " +
    "AND EXISTS (SELECT 1 FROM repo_connections WHERE seller_id=? AND repo_id=? AND installation_id=? AND revoked_at IS NULL)";
  const bindings = [id, account.id, row.revision, id, connection.repo_id, sha, id, account.id, connection.repo_id, connection.installation_id];
  await c.env.DB.batch([
    c.env.DB.prepare('WITH slots(slot) AS (VALUES(1),(2),(3),(4),(5)) INSERT OR IGNORE INTO listing_slots(seller_id,slot,listing_id) ' +
      'SELECT ?,slot,? FROM slots WHERE slot NOT IN (SELECT slot FROM listing_slots WHERE seller_id=?) AND ' + guard + ' ORDER BY slot LIMIT 1')
      .bind(account.id, id, account.id, ...bindings),
    c.env.DB.prepare("INSERT OR IGNORE INTO releases(id,listing_id,revision,repo_id,installation_id,commit_sha,snapshot,status) " +
      "SELECT ?,?,?,?,?,?,?,'queued' WHERE EXISTS (SELECT 1 FROM listing_slots WHERE listing_id=? AND seller_id=?) AND " + guard)
      .bind(release, id, row.revision, connection.repo_id, connection.installation_id, sha, JSON.stringify(draft), id, account.id, ...bindings),
  ]);
  const submitted = await c.env.DB.prepare('SELECT id,status FROM releases WHERE listing_id=? AND revision=?').bind(id, row.revision).first();
  assert(submitted, 409, 'Submission needs an available slot, a unique source, and a draft with no other release awaiting review.');
  return c.json(submitted, 201);
});
sellerRoutes.post('/listings/:id/archive', async c => {
  const account = actor(c);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM listings WHERE id=? AND seller_id=?').bind(id, account.id).first();
  assert(row, 404, 'Listing not found.');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE releases SET status='archived' WHERE listing_id=? AND status IN ('queued','review','changes','published')").bind(id),
    c.env.DB.prepare('UPDATE listings SET active_release=NULL,revision=revision+1,updated_at=unixepoch() WHERE id=?').bind(id),
    c.env.DB.prepare('DELETE FROM listing_slots WHERE seller_id=? AND listing_id=?').bind(account.id, id),
    c.env.DB.prepare("UPDATE outbox SET state='dead' WHERE kind='verify' AND state IN ('ready','leased') AND subject IN (SELECT id FROM releases WHERE listing_id=?)").bind(id),
  ]);
  return c.json({ archived: true });
});

export const reviewRoutes = new Hono<AppEnv>();
reviewRoutes.get('/', async c => {
  const reviewer = actor(c, true);
  const result = await c.env.DB.prepare(releaseSelect + " WHERE r.status='review' AND l.seller_id<>? ORDER BY r.created_at LIMIT 40").bind(reviewer.id).all<ReleaseRow>();
  return c.json({ releases: result.results.map(row => ({ id: row.id, seller: row.seller, commit: row.commit_sha, draft: JSON.parse(row.snapshot), report: row.report && JSON.parse(row.report) })) });
});
reviewRoutes.post('/:id', async c => {
  const reviewer = actor(c, true);
  const id = c.req.param('id');
  const input = await readJSON(c);
  const decision = str(input.decision);
  const reason = str(input.reason, 1000);
  assert(['published', 'changes', 'rejected'].includes(decision) && reason.length >= 8, 400, 'Choose a decision and explain it.');
  const row = await c.env.DB.prepare(releaseSelect + ' WHERE r.id=?').bind(id).first<ReleaseRow>();
  assert(row && row.seller_id !== reviewer.id, 404, 'Review not found.');
  assert(row.status === 'review', 409, 'This release is no longer waiting for review.');
  if (decision === 'published') {
    const report = row.report ? JSON.parse(row.report) as Report : null;
    assert(input.mediaReviewed === true && report?.corePassed && report.digest === row.digest && row.artifact_key, 409,
      'Publication requires both videos to be reviewed and a successful clean run of the exact stored archive.');
    const object = await artifactHead(c.env, row.artifact_key);
    assert(object?.customMetadata?.digest === row.digest, 409, 'The private release archive is missing or no longer matches the verification report.');
  }
  const canPublish = "AND EXISTS (SELECT 1 FROM listings l JOIN repo_connections g ON g.seller_id=l.seller_id " +
    "AND g.repo_id=releases.repo_id AND g.installation_id=releases.installation_id AND g.revoked_at IS NULL WHERE l.id=releases.listing_id)";
  const statements = [
    c.env.DB.prepare("INSERT INTO reviews(release_id,reviewer_id,decision,reason) SELECT id,?,?,? FROM releases WHERE id=? AND status='review' " +
      (decision === 'published' ? canPublish : '') + " ON CONFLICT DO NOTHING")
      .bind(reviewer.id, decision, reason, id),
    c.env.DB.prepare("UPDATE releases SET status=? WHERE id=? AND status='review' AND EXISTS (SELECT 1 FROM reviews WHERE release_id=? AND reviewer_id=? AND decision=?)")
      .bind(decision, id, id, reviewer.id, decision),
  ];
  if (decision === 'published') {
    statements.push(c.env.DB.prepare("UPDATE listings SET active_release=?,updated_at=unixepoch() WHERE id=? AND EXISTS (SELECT 1 FROM releases WHERE id=? AND status='published')")
      .bind(id, row.listing_id, id));
  }
  if (decision === 'rejected') {
    statements.push(c.env.DB.prepare("DELETE FROM listing_slots WHERE listing_id=? AND EXISTS (SELECT 1 FROM listings WHERE id=? AND active_release IS NULL) AND EXISTS (SELECT 1 FROM releases WHERE id=? AND status='rejected')")
      .bind(row.listing_id, row.listing_id, id));
  }
  const [insert] = await c.env.DB.batch(statements);
  assert(insert.meta.changes, 409, 'The review changed or the seller must reconnect the private repository.');
  return c.json({ decision });
});
