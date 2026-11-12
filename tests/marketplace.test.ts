import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { app } from '../server/app';
import type { Env } from '../server/common';
import { literalBrief, rank } from '../server/search';
import { samples } from '../server/catalog';
import { blankDraft, LICENSE_VERSION } from '../src/domain';
import { artifactHead, budgets, cutoff, reserve } from '../server/cost';

const ORIGIN = 'http://127.0.0.1:8788';
const sellers = ['9001', '9002'];
const buyer = '9003';
const other = '9004';
const reviewer = '9005';
const operator = 'test-operator-' + 'x'.repeat(32);
const runner = 'test-runner-' + 'x'.repeat(32);
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fixtureSHA = (repo: number) => repo.toString(16).padStart(40, '0');
const realFetch = globalThis.fetch;
let env: Env;
let mf: Miniflare;
let zip: Buffer;
let releaseDigest: string;
let release: string;
let purchase: string;
let downloaded: string;
let failCaptureReadback = false;
let faultCapture = false;
const capturedKeys = new Set<string>();
const orders = new Map<string, {
  id: string; intent: string; status: string; purchase_units: Array<{ amount: { value: string; currency_code: string };
    payments?: { captures: Array<{ id: string; status: string; amount: { value: string; currency_code: string }; final_capture: boolean }> } }>;
}>();
const captureToOrder = new Map<string, string>();
const events = (resource: object, id = 'test-paypal-event-1') => ({
  id, event_type: 'CHECKOUT.ORDER.COMPLETED', resource,
});
const webhookHeaders = {
  'paypal-transmission-id': 'test', 'paypal-transmission-time': '2026-11-12T00:00:00Z',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fixture',
  'paypal-auth-algo': 'SHA256withRSA', 'paypal-transmission-sig': 'test-valid',
};
const key = (id: string) => id.padStart(72, '0');
function response(data: unknown, status = 200) { return Response.json(data, { status }); }

function stub(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);
  const path = url.pathname;
  const method = init?.method ?? 'GET';
  if (url.hostname === 'api.github.com') {
    const repo = Number(path.split('/')[3]?.replace('repo-', ''));
    if (path === '/app/installations/42') return Promise.resolve(response({ id: 42, app_id: 11, repository_selection: 'selected', account: { id: 9001, type: 'User' } }));
    if (path.endsWith('/access_tokens')) return Promise.resolve(response({ token: 'test-installation-token' }));
    if (path.includes('/commits/')) return Promise.resolve(response({ sha: path.endsWith('/moving') ? '0'.repeat(40) : fixtureSHA(repo), commit: { tree: { sha: fixtureSHA(repo) } } }));
    if (path.includes('/git/trees/')) return Promise.resolve(response({ truncated: false, tree: [] }));
    if (path.includes('/zipball/')) return Promise.resolve(new Response(null, { status: 302, headers: { Location: 'https://codeload.github.com/fixture' } }));
    if (path.startsWith('/repos/')) return Promise.resolve(response({ id: repo, owner: { id: 9001 }, private: true }));
  }
  if (url.hostname === 'codeload.github.com') return Promise.resolve(new Response(Uint8Array.from(zip)));
  if (url.hostname === 'api-m.sandbox.paypal.com') {
    if (path === '/v1/oauth2/token') return Promise.resolve(response({ access_token: 'test-paypal-oauth' }));
    if (path === '/v1/notifications/verify-webhook-signature') {
      const body = JSON.parse(String(init?.body));
      if (body.webhook_event.id === 'external-refund-full')
        assert.match(String(init?.body), /"webhook_event":\{\n  "id": "external-refund-full"/);
      return Promise.resolve(response({ verification_status: body.transmission_sig === 'test-valid' ? 'SUCCESS' : 'FAILURE' }));
    }
    if (path === '/v2/checkout/orders' && method === 'POST') {
      const requestId = new Headers(init?.headers).get('paypal-request-id')!;
      assert.ok(requestId.length <= 38);
      const id = 'ORDER-' + requestId;
      if (!orders.has(id)) {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
        orders.set(id, { id, intent: body.intent, status: 'PAYER_ACTION_REQUIRED', purchase_units: body.purchase_units });
      }
      return Promise.resolve(response({ ...orders.get(id), links: [
        { rel: 'payer-action', method: 'GET', href: 'https://www.paypal.com/checkoutnow?token=' + id },
        { rel: 'payer-action', method: 'GET', href: 'https://www.sandbox.paypal.com/checkoutnow?token=WRONG-ORDER' },
        { rel: 'payer-action', method: 'GET', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id },
      ] }));
    }
    if (path.startsWith('/v2/checkout/orders/')) {
      const id = path.split('/')[4];
      const order = orders.get(id)!;
      if (path.endsWith('/capture')) {
        const requestId = new Headers(init?.headers).get('paypal-request-id')!;
        const capture = 'CAP-' + requestId;
        if (!capturedKeys.has(requestId)) {
          capturedKeys.add(requestId);
          order.purchase_units[0].payments = { captures: [{ id: capture, status: 'COMPLETED', amount: order.purchase_units[0].amount, final_capture: true }] };
          order.status = 'COMPLETED';
          captureToOrder.set(capture, id);
        }
        if (faultCapture) { faultCapture = false; failCaptureReadback = true; return Promise.resolve(response({}, 503)); }
      }
      if (failCaptureReadback) { failCaptureReadback = false; return Promise.resolve(response({}, 503)); }
      return Promise.resolve(response(order));
    }
    if (path.startsWith('/v2/payments/captures/')) {
      const id = path.split('/')[4];
      const capture = orders.get(captureToOrder.get(id)!)!.purchase_units[0].payments!.captures[0];
      if (path.endsWith('/refund')) {
        capture.status = 'REFUNDED';
        return Promise.resolve(response({ id: 'TEST-REFUND', status: 'COMPLETED', amount: capture.amount }));
      }
      return Promise.resolve(response(capture));
    }
  }
  return realFetch(input, init);
}
async function req(path: string, method = 'GET', body?: object | Uint8Array, account?: string, extra: Record<string,string> = {}) {
  const headers: Record<string,string> = { origin: ORIGIN, ...extra };
  if (account) headers.cookie = 'zsession=' + key(account);
  const raw = body instanceof Uint8Array ? Uint8Array.from(body).buffer : body === undefined ? undefined : JSON.stringify(body);
  if (typeof raw === 'string') headers['content-type'] = 'application/json';
  return app.fetch(new Request(ORIGIN + '/api' + path, { method, headers, body: raw }), env);
}
async function ok<T = Record<string, unknown>>(result: Promise<Response>, expected = 200) {
  const res = await result;
  const value = await res.json() as T;
  assert.equal(res.status, expected, JSON.stringify(value));
  return value;
}
const draft = (repoId: number) => ({ ...blankDraft, repoId, title: 'Integration fixture ' + repoId,
  summary: 'A locally tested browser game', description: 'Controlled local fixture', categories: ['Games'],
  version: '1.0.0', price: '29.00', productVideo: 'https://example.test/product.mp4', setupVideo: 'https://example.test/setup.mp4',
  productTranscript: 'Product recording text', setupTranscript: 'Installation recording text',
  setup: 'npm ci && npm start', costs: 'No paid API', notices: 'Original assets', support: 'Open a support case', rights: true,
});
const create = (repoId: number, body = draft(repoId)) => ok<{ id: string }>(req('/seller/listings', 'POST', body, sellers[0]), 201);

before(async () => {
  mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    name: 'test-market', compatibilityDate: '2026-11-12',
    manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: 'export default {fetch(){return new Response("tests")}}' } } },
    env: { DB: { type: 'd1', id: 'tests' }, ARTIFACTS: { type: 'r2', name: 'artifacts' } },
  } }] });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  const ARTIFACTS = await mf.getR2Bucket('ARTIFACTS') as unknown as R2Bucket;
  for (const file of ['0001_marketplace.sql','0002_runner_notes.sql','0003_moderation.sql','0004_cost_controls.sql','0005_paypal_checkout.sql','0006_gemini_finder.sql']) {
    const sql = await readFile('migrations/' + file, 'utf8');
    const statements = sql.split(/;\r?\n(?=\r?\n|CREATE|ALTER|PRAGMA|$)/g).map(piece => piece.trim()).filter(Boolean);
    for (const statement of statements) await DB.prepare(statement).run();
  }
  zip = await readFile('public/samples/acorn/acorn-trail.zip');
  releaseDigest = hash(zip);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' } });
  env = { DB, ARTIFACTS, APP_ORIGIN: ORIGIN, LOCAL_DEMO: '1', GITHUB_APP_ID: '11', GITHUB_PRIVATE_KEY: privateKey,
    PAYPAL_CLIENT_ID: 'fixture-id', PAYPAL_CLIENT_SECRET: 'fixture-secret', PAYPAL_MERCHANT_ID: 'fixture-merchant',
    PAYPAL_WEBHOOK_ID: 'fixture-webhook', TEAM_SELLER_GITHUB_ID: sellers[0], REVIEWER_GITHUB_IDS: reviewer,
    RUNNER_TOKEN: runner, OPERATOR_TOKEN: operator, COST_ADMIN_GITHUB_IDS: sellers[1] };
  for (const id of [...sellers, buyer, other, reviewer]) {
    await DB.prepare("INSERT INTO accounts(id,name,role) VALUES (?,?,'member')").bind(id, 'Fixture user ' + id).run();
    await DB.prepare('INSERT INTO sessions VALUES (?,?,unixepoch()+3600)').bind(hash(key(id)), id).run();
  }
  for (const repo of [101,102,103,104,105,106,107]) {
    await DB.prepare('INSERT INTO repo_connections VALUES (?,?,42,?,NULL)').bind(sellers[0], repo, 'fixture/repo-' + repo).run();
  }
  globalThis.fetch = stub;
});
after(async () => {
  globalThis.fetch = realFetch;
  await mf?.dispose();
});

test('admission preserves an incomplete draft and rejects a cross-tenant mutation', async () => {
  const item = await create(107, { ...draft(107), setupVideo: draft(107).productVideo });
  await ok(req('/seller/listings/' + item.id + '/submit', 'POST', {}, sellers[0]), 400);
  await ok(req('/seller/listings/' + item.id, 'PATCH', { ...draft(107), revision: 1 }, sellers[1]), 409);
  const all = await ok<{ listings: Array<{ id: string; slot: number | null }> }>(req('/seller/listings', 'GET', undefined, sellers[0]));
  assert.equal(all.listings.find(row => row.id === item.id)?.slot, null);
});

test('only one submission wins the last slot; submission pins the release and is idempotent', async () => {
  const drafts = await Promise.all([101,102,103,104,105,106].map(repo => create(repo)));
  for (const item of drafts.slice(0,4)) await ok(req('/seller/listings/' + item.id + '/submit', 'POST', {}, sellers[0]), 201);
  const replies = await Promise.all(drafts.slice(4).map(item => req('/seller/listings/' + item.id + '/submit', 'POST', {}, sellers[0])));
  assert.deepEqual(replies.map(res => res.status).sort(), [201,409]);
  const one = await ok<{ id: string }>(req('/seller/listings/' + drafts[0].id + '/submit', 'POST', {}, sellers[0]));
  release = one.id;
  const pinned = await env.DB.prepare('SELECT commit_sha, snapshot FROM releases WHERE id=?').bind(release).first<{ commit_sha: string; snapshot: string }>();
  assert.equal(pinned?.commit_sha, fixtureSHA(101));
  await ok(req('/seller/listings/' + drafts[0].id, 'PATCH', { ...draft(101), ref: 'moving', revision: 1 }, sellers[0]));
  assert.equal((await env.DB.prepare('SELECT snapshot FROM releases WHERE id=?').bind(release).first())?.snapshot, pinned?.snapshot);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM listing_slots').first())?.n, 5);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM outbox WHERE kind=\'verify\'').first())?.n, 5);
});

test('leased runner fetches pinned bytes; an independent reviewer publishes exact stored digest', async () => {
  const auth = { authorization: 'Bearer ' + runner };
  await ok(req('/operator/jobs/claim', 'POST', { repoId: 101 }), 403);
  const job = await ok<{ id: string; lease: string }>(req('/operator/jobs/claim', 'POST', { repoId: 101 }, undefined, auth));
  assert.equal(job.id, release);
  assert.equal((await ok(req('/operator/jobs/claim', 'POST', { repoId: 102 }, undefined, auth))).id, null);
  const route = '/operator/jobs/' + job.id;
  const lease = { ...auth, 'x-lease-id': job.lease };
  const source = await req(route + '/source', 'GET', undefined, undefined, lease);
  assert.equal(source.status, 200);
  assert.equal(hash(Buffer.from(await source.arrayBuffer())), releaseDigest);
  await ok(req(route + '/artifact', 'PUT', zip, undefined, { ...lease, 'x-archive-sha256': '0'.repeat(64) }), 409);
  await ok(req(route + '/artifact', 'PUT', zip, undefined, { ...lease, 'x-archive-sha256': releaseDigest }));
  const acornReport = samples.find(sample => sample.id === 'acorn-trail')?.report;
  assert.ok(acornReport);
  await ok(req(route + '/complete', 'POST', { report: acornReport }, undefined, lease));
  await ok(req(route + '/complete', 'POST', { report: acornReport }, undefined, lease), 404);
  await ok(req('/reviews/' + release, 'POST', { decision: 'published', reason: 'Both videos and the clean run are acceptable.', mediaReviewed: true }, sellers[0]), 403);
  await ok(req('/reviews/' + release, 'POST', { decision: 'published', reason: 'Both videos and the clean run are acceptable.', mediaReviewed: false }, reviewer), 409);
  await env.DB.prepare('UPDATE repo_connections SET revoked_at=unixepoch() WHERE seller_id=? AND repo_id=101').bind(sellers[0]).run();
  await ok(req('/reviews/' + release, 'POST', { decision: 'published', reason: 'Both videos and the clean run are acceptable.', mediaReviewed: true }, reviewer), 409);
  await env.DB.prepare('UPDATE repo_connections SET revoked_at=NULL WHERE seller_id=? AND repo_id=101').bind(sellers[0]).run();
  const unrelated = await env.DB.prepare("UPDATE releases SET status='review' WHERE repo_id=102 RETURNING id").first<string>('id');
  assert.ok(unrelated);
  env.RELEASE_REVIEW_ASSIGNMENTS = other + ':' + release;
  try {
    const desk = await ok<{ releases: { id: string }[] }>(req('/reviews', 'GET', undefined, other));
    assert.deepEqual(desk.releases.map(item => item.id), [release]);
    await ok(req('/reviews/' + unrelated, 'POST', { decision: 'rejected', reason: 'Unrelated to this assignment.' }, other), 404);
    await ok(req('/support/desk', 'GET', undefined, other), 403);
    await ok(req('/reviews/' + release, 'POST', { decision: 'published', reason: 'Both videos and the clean run are acceptable.', mediaReviewed: true }, other));
  } finally {
    delete env.RELEASE_REVIEW_ASSIGNMENTS;
    await env.DB.prepare("UPDATE releases SET status='queued' WHERE id=?").bind(unrelated).run();
  }
  await ok(req('/reviews', 'GET', undefined, other), 403);
  const publicItem = await ok(req('/catalog/' + release));
  assert.equal(publicItem.digest, releaseDigest);
  assert.equal(publicItem.purchasable, true);
  assert.ok(!('repoId' in publicItem) && !('artifact_key' in publicItem) && !('commit_sha' in publicItem));
});

test('a lost capture response stays pending, reconciles once and never creates a second grant', async () => {
  const agreement = { releaseId: release, digest: releaseDigest, amount: 2900, licenseVersion: LICENSE_VERSION, accepted: true };
  await ok(req('/purchases', 'POST', { ...agreement, amount: 2901 }, buyer), 409);
  const creates = await Promise.all([0,1].map(() => ok<{ id: string; order: string; approvalUrl: string }>(req('/purchases', 'POST', agreement, buyer))));
  assert.deepEqual(creates[0], creates[1]);
  purchase = creates[0].id;
  const order = creates[0].order;
  assert.equal(creates[0].approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=' + order);
  await ok(req('/purchases/' + purchase + '/capture', 'POST', { order: 'WRONG-ORDER' }, buyer), 409);
  await ok(req('/purchases/' + purchase + '/capture', 'POST', { order }, other), 404);
  await ok(req('/purchases/' + purchase + '/capture', 'POST', { order }, buyer), 409);
  orders.get(order)!.status = 'APPROVED';
  faultCapture = true;
  await ok(req('/purchases/' + purchase + '/capture', 'POST', { order }, buyer), 502);
  assert.equal((await ok(req('/purchases/' + purchase, 'GET', undefined, buyer))).state, 'pending');
  await ok(req('/admin/cost/pause', 'POST', { operation: 'checkout', paused: true, reason: 'Controlled storage pressure fixture' }, sellers[1]));
  await ok(req('/purchases', 'POST', agreement, other), 503);
  const headers = webhookHeaders;
  await ok(req('/webhooks/paypal', 'POST', events({ id: order }), undefined, { ...headers, 'paypal-transmission-sig': 'invalid' }), 403);
  await ok(req('/webhooks/paypal', 'POST', events({ id: order }), undefined,
    { ...headers, 'paypal-cert-url': 'https://api-m.paypal.com/v1/notifications/certs/CERT-fixture' }), 403);
  await Promise.all([ok(req('/webhooks/paypal', 'POST', events({ id: order }), undefined, headers)),
    ok(req('/purchases/' + purchase + '/refresh', 'POST', {}, buyer))]);
  await ok(req('/webhooks/paypal', 'POST', events({ id: order }), undefined, headers));
  const receipt = await ok(req('/purchases/' + purchase, 'GET', undefined, buyer));
  assert.equal(receipt.state, 'complete');
  assert.equal(receipt.available, true);
  assert.equal(receipt.digest, releaseDigest);
  assert.equal(capturedKeys.size, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM entitlements').first())?.n, 1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM inbox WHERE provider='paypal-sandbox'").first())?.n, 1);
  await ok(req('/admin/cost/pause', 'POST', { operation: 'checkout', paused: false, reason: 'Controlled storage recovery fixture' }, sellers[1]));
});

test('delivery recovers without capture, scope is enforced, and refund closes previously issued URLs', async () => {
  const row = await env.DB.prepare('SELECT artifact_key FROM releases WHERE id=?').bind(release).first<{ artifact_key: string }>();
  await env.ARTIFACTS.delete(row!.artifact_key);
  await ok(req('/library/' + purchase + '/download', 'POST', {}, buyer), 503);
  await env.ARTIFACTS.put(row!.artifact_key, Uint8Array.from(zip), { customMetadata: { digest: releaseDigest, release } });
  await ok(req('/library/' + purchase + '/download', 'POST', {}, other), 404);
  await ok(req('/purchases/' + purchase, 'GET', undefined, other), 404);
  const first = await ok<{ url: string }>(req('/library/' + purchase + '/download', 'POST', {}, buyer));
  downloaded = first.url.replace(/^\/api/, '');
  await ok(req(downloaded, 'GET', undefined, other), 404);
  const stream = await req(downloaded, 'GET', undefined, buyer);
  assert.equal(stream.status, 200);
  assert.equal(hash(Buffer.from(await stream.arrayBuffer())), releaseDigest);
  // Even the buyer cannot replay the consumed ticket.
  await ok(req(downloaded, 'GET', undefined, buyer), 404);
  const second = await ok<{ url: string }>(req('/library/' + purchase + '/download', 'POST', {}, buyer));
  downloaded = second.url.replace(/^\/api/, '');
  const support = await ok<{ id: string }>(req('/support', 'POST', { purchaseId: purchase, message: 'Please refund this controlled fixture.' }, buyer), 201);
  await ok(req('/support/desk/' + support.id + '/hold', 'POST', { action: 'hold', reason: 'Review this release before further delivery.' }, reviewer));
  await ok(req(downloaded, 'GET', undefined, buyer), 404);
  await ok(req('/support/desk/' + support.id + '/hold', 'POST', { action: 'lift', reason: 'Review complete; restore ordinary access.' }, reviewer));
  assert.equal((await req(downloaded, 'GET', undefined, buyer)).status, 200);
  const outstanding = await ok<{ url: string }>(req('/library/' + purchase + '/download', 'POST', {}, buyer));
  downloaded = outstanding.url.replace(/^\/api/, '');
  const receipt = await ok(req('/operator/refund/' + purchase, 'POST', { caseId: support.id }, undefined, { authorization: 'Bearer ' + operator }));
  assert.equal(receipt.state, 'refunded');
  await ok(req(downloaded, 'GET', undefined, buyer), 404);
  await ok(req('/library/' + purchase + '/download', 'POST', {}, buyer), 404);
  assert.equal(capturedKeys.size, 1);
});

test('cancelled checkout never grants access and evidence rules keep unknown hard constraints out of matches', async () => {
  const agreement = { releaseId: release, digest: releaseDigest, amount: 2900, licenseVersion: LICENSE_VERSION, accepted: true };
  const started = await ok<{ id: string }>(req('/purchases', 'POST', agreement, other));
  const cancelled = await ok(req('/purchases/' + started.id + '/cancel', 'POST', {}, other));
  assert.equal(cancelled.state, 'cancelled');
  await ok(req('/library/' + started.id + '/download', 'POST', {}, other), 404);
  const retried = await ok<{ id: string; order: string }>(req('/purchases', 'POST', agreement, other));
  assert.notEqual(retried.id, started.id);
  orders.get(retried.order)!.status = 'APPROVED';
  const recovered = await ok(req('/purchases/' + retried.id + '/refresh', 'POST', {}, other));
  assert.equal(recovered.state, 'complete');
  const query = 'Offline browser game under $60';
  const fit = await rank({} as never, samples, query, literalBrief(query), true);
  assert.equal(fit.results.find(result => result.item.id === 'acorn-trail')?.status, 'match');
  assert.equal(fit.results.find(result => result.item.id === 'example-orbit')?.status, 'near');
  assert.equal(literalBrief('Under $49').maxCents, 4899);
  assert.equal(literalBrief('Up to $49').maxCents, 4900);
});

const utcDay = () => new Date().toISOString().slice(0, 10);
async function setUsage(metric: string, amount: number, day = utcDay()) {
  await env.DB.prepare('INSERT INTO cost_usage(metric,period,amount) VALUES (?,?,?) ON CONFLICT(metric,period) DO UPDATE SET amount=excluded.amount')
    .bind(metric, day, amount).run();
}
test('budget reservations are atomic across metrics and alert at the threshold', async () => {
  await setUsage('aiRequests', cutoff('aiRequests') - 1);
  await setUsage('aiOutput', cutoff('aiOutput') - 200);
  const grants = await Promise.all([reserve(env, { aiRequests: 1, aiOutput: 200 }), reserve(env, { aiRequests: 1, aiOutput: 200 })]);
  assert.equal(grants.filter(Boolean).length, 1);
  assert.equal(await reserve(env, { aiRequests: 1, aiInput: 100 }), false);
  assert.equal(await env.DB.prepare("SELECT amount FROM cost_usage WHERE metric='aiInput' AND period=?").bind(utcDay()).first(), null);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM cost_alerts WHERE metric='aiRequests'").first())?.n, 1);
  await ok(req('/admin/cost', 'GET', undefined, reviewer), 403);
  const dashboard = await ok<{ operations: Array<{ operation: string; limits: string[] }> }>(req('/admin/cost', 'GET', undefined, sellers[1]));
  assert.ok(dashboard.operations.find(row => row.operation === 'ai')?.limits.includes('aiRequests'));
  let calls = 0;
  env.AI = { run: () => { calls++; throw new Error('AI should be gated'); } } as unknown as Ai;
  const results = await ok(req('/search', 'POST', { query: 'Offline browser game under $60' }, buyer));
  assert.equal(results.mode, 'literal');
  assert.equal(results.retrieval, 'lexical');
  assert.equal(calls, 0);
  delete env.AI;
});

test('storage pressure pauses new capture and preserves existing buyer delivery reserve', async () => {
  const agreement = { releaseId: release, digest: releaseDigest, amount: 2900, licenseVersion: LICENSE_VERSION, accepted: true };
  const owned = await env.DB.prepare("SELECT id FROM purchases WHERE buyer_id=? AND state='complete'").bind(other).first<{ id: string }>();
  assert.ok(owned);
  await setUsage('r2B', cutoff('r2B'));
  await ok(req('/purchases', 'POST', agreement, buyer), 503);
  const ticket = await ok<{ url: string }>(req('/library/' + owned.id + '/download', 'POST', {}, other));
  const download = await req(ticket.url.replace(/^\/api/, ''), 'GET', undefined, other);
  assert.equal(download.status, 200);
  assert.equal(hash(Buffer.from(await download.arrayBuffer())), releaseDigest);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM entitlements WHERE revoked_at IS NULL").first())?.n, 1);
  await setUsage('r2B', budgets.r2B.allocation);
  await assert.rejects(artifactHead(env, 'unavailable', true), /read limit/);
  await ok(req('/purchases/' + owned.id, 'GET', undefined, other));
});

test('storage recovery releases only old missing, unreferenced reservations', async () => {
  await setUsage('r2B', 0);
  const row = await env.DB.prepare('SELECT artifact_key FROM releases WHERE id=?').bind(release).first<{ artifact_key: string }>();
  assert.ok(row);
  await env.DB.prepare("UPDATE cost_artifacts SET created_at=0 WHERE object_key=?").bind(row.artifact_key).run();
  await env.DB.prepare("INSERT INTO cost_artifacts(object_key,digest,bytes,created_at) VALUES ('missing-fixture',?,15,0)")
    .bind(releaseDigest).run();
  const result = await ok(req('/admin/cost/storage-recovery', 'POST', {}, sellers[1]));
  assert.equal(result.released, 1);
  assert.ok(await env.ARTIFACTS.head(row.artifact_key));
  assert.ok(await env.DB.prepare("SELECT 1 FROM cost_artifacts WHERE object_key=?").bind(row.artifact_key).first());
});

test('a signed refund using the Sandbox API alias preserves a partial payment and revokes after a full refund', async () => {
  const fixtureBuyer = sellers[1];
  const item = await ok<{ id: string; order: string }>(req('/purchases', 'POST',
    { releaseId: release, digest: releaseDigest, amount: 2900, licenseVersion: LICENSE_VERSION, accepted: true }, fixtureBuyer));
  const order = orders.get(item.order)!;
  order.status = 'APPROVED';
  await ok(req('/purchases/' + item.id + '/capture', 'POST', { order: item.order }, fixtureBuyer));
  const capture = order.purchase_units[0].payments!.captures[0];
  const ticket = await ok<{ url: string }>(req('/library/' + item.id + '/download', 'POST', {}, fixtureBuyer));
  const refund = (id: string) => ({
    id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: {
      id: 'REFUND-123', links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/' + capture.id }],
    },
  });
  capture.status = 'PARTIALLY_REFUNDED';
  await ok(req('/webhooks/paypal', 'POST', refund('external-refund-partial'), undefined, webhookHeaders));
  assert.equal((await ok(req('/purchases/' + item.id, 'GET', undefined, fixtureBuyer))).state, 'complete');
  capture.status = 'REFUNDED';
  const raw = Buffer.from(JSON.stringify(refund('external-refund-full'), null, 2));
  await ok(req('/webhooks/paypal', 'POST', raw, undefined, { ...webhookHeaders, 'content-type': 'application/json' }));
  assert.equal((await ok(req('/purchases/' + item.id, 'GET', undefined, fixtureBuyer))).state, 'refunded');
  await ok(req(ticket.url.replace(/^\/api/, ''), 'GET', undefined, fixtureBuyer), 404);
});

test('a verified reversal survives a failed readback and prevents settlement from stale completion data', async () => {
  const item = await ok<{ id: string; order: string }>(req('/purchases', 'POST',
    { releaseId: release, digest: releaseDigest, amount: 2900, licenseVersion: LICENSE_VERSION, accepted: true }, reviewer));
  const order = orders.get(item.order)!;
  order.status = 'APPROVED';
  faultCapture = true;
  await ok(req('/purchases/' + item.id + '/capture', 'POST', { order: item.order }, reviewer), 502);
  const capture = order.purchase_units[0].payments!.captures[0];
  const revoked = {
    id: 'reversal-before-readback', event_type: 'PAYMENT.CAPTURE.REVERSED',
    resource: { id: capture.id, links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/checkout/orders/' + item.order }] },
  };
  failCaptureReadback = true;
  await ok(req('/webhooks/paypal', 'POST', revoked, undefined, webhookHeaders), 502);
  assert.equal(capture.status, 'COMPLETED');
  assert.equal((await ok(req('/purchases/' + item.id + '/refresh', 'POST', {}, reviewer))).state, 'refunded');
  assert.equal(await env.DB.prepare('SELECT 1 FROM entitlements WHERE purchase_id=?').bind(item.id).first(), null);
  await ok(req('/webhooks/paypal', 'POST', revoked, undefined, webhookHeaders));
});
