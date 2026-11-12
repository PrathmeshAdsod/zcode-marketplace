import { Hono } from 'hono';
import { actor, assert, operator, Problem, providerId, readBytes, readJSON, seconds, sha256, str, throttle, uuid, type AppEnv, type Ctx, type Env } from './common';
import { paymentReady, paypalConfigured, publicRelease, releaseSelect, sellerEligible, type ReleaseRow } from './catalog';
import { artifactGet, artifactHead, canStart, requireCapacity } from './cost';
import { approvalURL, PayPal, sameMoney, verifyOrder, type Agreement } from './paypal';
import { LICENSE_TEXT, LICENSE_VERSION } from '../src/domain';

type Purchase = Agreement & {
  buyer_id: string; seller_id: string; release_id: string; digest: string;
  license_version: string; license_text: string; state: string; provider_capture: string | null;
  provider_refund: string | null; accepted_at: number; capture_started: number | null; refund_started: number | null;
  provider_approval: string | null;
};
const knownOrder = (env: Env, id: string) => env.DB.prepare('SELECT * FROM purchases WHERE id=?').bind(id).first<Purchase>();
const owned = (env: Env, id: string, buyer: string) => env.DB.prepare('SELECT * FROM purchases WHERE id=? AND buyer_id=?').bind(id, buyer).first<Purchase>();
const retryWindow = 5 * 3600;
const reversal = "SELECT 1 FROM inbox WHERE provider='paypal-sandbox' AND event_type='PAYMENT.CAPTURE.REVERSED' AND subject=? AND capture_id=?";

async function delivery(env: Env, id: string) {
  const artifact = await env.DB.prepare("SELECT r.artifact_key,r.digest FROM purchases p JOIN releases r ON p.release_id=r.id WHERE p.id=? AND p.state='complete' AND r.status<>'held' AND p.digest=r.digest")
    .bind(id).first<{ artifact_key: string; digest: string }>();
  if (!artifact) return false;
  const object = await artifactHead(env, artifact.artifact_key, true);
  if (!object || object.customMetadata?.digest !== artifact.digest) return false;
  await env.DB.prepare("UPDATE outbox SET state='done',lease_id=NULL,lease_until=NULL WHERE kind='deliver' AND subject=? AND state<>'done'").bind(id).run();
  return true;
}
const reconcileStatement = (env: Env, id: string) =>
  env.DB.prepare("INSERT INTO outbox(id,kind,subject) VALUES (?,'reconcile',?) ON CONFLICT(id) DO UPDATE SET state='ready',available_at=unixepoch(),attempts=0 WHERE state IN ('done','dead')")
    .bind('reconcile:' + id, id);
async function settle(env: Env, purchase: Purchase, capture: string) {
  await env.DB.prepare("UPDATE purchases SET state='complete',provider_capture=? WHERE id=? AND state IN ('awaiting','pending') AND (provider_capture IS NULL OR provider_capture=?) AND NOT EXISTS (" + reversal + ')')
    .bind(capture, purchase.id, capture, purchase.id, capture).run();
}
async function revoke(env: Env, purchase: Purchase, capture: string) {
  await env.DB.prepare("UPDATE purchases SET state='refunded',provider_capture=COALESCE(provider_capture,?) WHERE id=? AND state IN ('awaiting','pending','complete') AND (provider_capture IS NULL OR provider_capture=?)")
    .bind(capture, purchase.id, capture).run();
}
async function sync(env: Env, purchase: Purchase, requestCapture = false) {
  assert(purchase.provider_order, 409, 'Resume checkout to create the PayPal order.');
  if (['refunded', 'declined', 'cancelled', 'expired'].includes(purchase.state)) return purchase;
  if (purchase.provider_capture && await env.DB.prepare(reversal).bind(purchase.id, purchase.provider_capture).first()) {
    await revoke(env, purchase, purchase.provider_capture);
    return (await knownOrder(env, purchase.id))!;
  }
  const api = new PayPal(env);
  let remote = await api.order(purchase.provider_order);
  let capture = verifyOrder(purchase, remote);
  // A pause stops fresh capture attempts. Canonical readback and settlement continue below.
  const mayCapture = !capture && requestCapture && remote.status === 'APPROVED' &&
    (purchase.state === 'awaiting' || (purchase.state === 'pending' && purchase.capture_started !== null &&
      seconds() - purchase.capture_started < retryWindow)) && await canStart(env, 'checkout').catch(() => false);
  if (mayCapture) {
    const release = await env.DB.prepare("SELECT artifact_key FROM releases WHERE id=? AND digest=? AND status IN ('published','archived')")
      .bind(purchase.release_id, purchase.digest).first<{ artifact_key: string }>();
    const object = release && await artifactHead(env, release.artifact_key);
    assert(object?.customMetadata?.digest === purchase.digest, 409, 'This release is on hold or temporarily unavailable.');
  }
  if (mayCapture && purchase.state === 'awaiting') {
    await env.DB.batch([
      env.DB.prepare("UPDATE purchases SET state='pending',capture_started=unixepoch() WHERE id=? AND state='awaiting'").bind(purchase.id),
      env.DB.prepare("INSERT OR IGNORE INTO outbox(id,kind,subject) VALUES (?,'reconcile',?)").bind('reconcile:' + purchase.id, purchase.id),
    ]);
    const updated = await knownOrder(env, purchase.id);
    assert(updated?.provider_order, 409, 'The accepted order changed. Open the current receipt.');
    purchase = updated;
  }
  if (mayCapture && purchase.state === 'pending' &&
      purchase.capture_started && seconds() - purchase.capture_started < retryWindow) {
    try { await api.capture(purchase); }
    catch (error) {
      // A response can be lost after capture. The canonical read below settles the operation.
      if (!(error instanceof Problem) || error.status !== 502) throw error;
    }
    remote = await api.order(purchase.provider_order!);
    capture = verifyOrder(purchase, remote);
  }
  if (capture) {
    const canonical = await api.readCapture(capture.id);
    assert(canonical.id === capture.id && (!purchase.provider_capture || purchase.provider_capture === capture.id) &&
      sameMoney(purchase, canonical.amount), 409, 'PayPal capture readback did not match this receipt.');
    if (canonical.status === 'REFUNDED' || await env.DB.prepare(reversal).bind(purchase.id, capture.id).first()) {
      await revoke(env, purchase, canonical.id);
    } else if (canonical.status === 'COMPLETED' && remote.status === 'COMPLETED' && capture.final_capture === true) {
      await settle(env, purchase, canonical.id);
    } else if (['DECLINED', 'FAILED'].includes(canonical.status)) {
      await env.DB.prepare("UPDATE purchases SET state='declined' WHERE id=? AND state IN ('awaiting','pending')").bind(purchase.id).run();
    } else {
      await env.DB.prepare("UPDATE purchases SET state='pending',provider_capture=COALESCE(provider_capture,?) WHERE id=? AND state IN ('awaiting','pending')")
        .bind(canonical.id, purchase.id).run();
    }
  } else if (remote.status === 'VOIDED' || (purchase.state === 'awaiting' && seconds() - purchase.accepted_at > 6 * 3600 &&
    ['CREATED','PAYER_ACTION_REQUIRED','SAVED'].includes(remote.status))) {
    await env.DB.prepare("UPDATE purchases SET state='expired' WHERE id=? AND state='awaiting'").bind(purchase.id).run();
  }
  const current = (await knownOrder(env, purchase.id))!;
  if (current.state === 'complete') {
    try { await delivery(env, purchase.id); } catch { /* durable delivery remains ready */ }
  }
  return current;
}

async function receipt(env: Env, purchase: Purchase) {
  const row = await env.DB.prepare(releaseSelect + ' WHERE r.id=?').bind(purchase.release_id).first<ReleaseRow>();
  assert(row, 409, 'The purchased release is unavailable. Open a support case.');
  const item = publicRelease(row, env);
  const available = purchase.state === 'complete' && row.status !== 'held' && Boolean(await env.DB.prepare("SELECT 1 FROM outbox WHERE kind='deliver' AND subject=? AND state='done'").bind(purchase.id).first());
  return {
    id: purchase.id, state: purchase.state, amount: purchase.amount, currency: purchase.currency,
    merchant: purchase.merchant, releaseId: purchase.release_id, title: item.title, version: item.version,
    seller: item.seller, digest: purchase.digest, licenseVersion: purchase.license_version, license: purchase.license_text,
    acceptedAt: purchase.accepted_at, capture: purchase.provider_capture, order: purchase.provider_order, refund: purchase.provider_refund,
    environment: 'sandbox', available, setup: item.setup, notices: item.notices, support: item.support, report: item.report,
    checkoutPaused: ['awaiting','pending'].includes(purchase.state) && !await canStart(env, 'checkout').catch(() => false),
  };
}
export const purchases = new Hono<AppEnv>();
purchases.post('/', async c => {
  const buyer = actor(c);
  assert(paymentReady(c.env) && !buyer.id.startsWith('demo-'), 503, 'A GitHub buyer account and the configured team PayPal Sandbox merchant are required.');
  await requireCapacity(c.env, 'checkout');
  await throttle(c, 'purchase', buyer.id, 12, 300);
  const input = await readJSON(c);
  const id = str(input.releaseId, 64);
  assert(input.accepted === true && input.licenseVersion === LICENSE_VERSION, 400, 'Read and accept the displayed release license.');
  const row = await c.env.DB.prepare(releaseSelect + ' WHERE r.id=?').bind(id).first<ReleaseRow>();
  assert(row?.digest && row.artifact_key && row.status === 'published' && sellerEligible(c.env, row.seller_id) &&
    buyer.id !== row.seller_id, 409, 'This release is not eligible for this buyer’s Sandbox checkout.');
  const offer = publicRelease(row, c.env);
  assert(input.digest === row.digest && input.amount === offer.amount, 409, 'The offer changed. Review it again before paying.');
  const archive = await artifactHead(c.env, row.artifact_key);
  assert(archive?.customMetadata?.digest === row.digest, 409, 'The release archive is temporarily unavailable.');
  await c.env.DB.prepare("INSERT OR IGNORE INTO purchases(id,buyer_id,seller_id,release_id,digest,license_version,license_text,amount,currency,merchant,environment) " +
    "SELECT ?,?,?,?,?,?,?,?,'USD',?,'sandbox' WHERE EXISTS(SELECT 1 FROM listings l JOIN releases r ON r.id=l.active_release WHERE r.id=? AND r.status='published')")
    .bind(uuid(), buyer.id, row.seller_id, row.id, row.digest, LICENSE_VERSION, LICENSE_TEXT, offer.amount, c.env.PAYPAL_MERCHANT_ID!, row.id).run();
  let purchase = await c.env.DB.prepare("SELECT * FROM purchases WHERE buyer_id=? AND release_id=? AND state NOT IN ('declined','cancelled','expired')")
    .bind(buyer.id, row.id).first<Purchase>();
  assert(purchase, 409, 'This offer is no longer available.');
  if (purchase.state !== 'awaiting') return c.json({ id: purchase.id, state: purchase.state, order: purchase.provider_order });
  if (!purchase.provider_order) {
    if (seconds() - purchase.accepted_at >= retryWindow) {
      await c.env.DB.prepare("UPDATE purchases SET state='expired' WHERE id=? AND state='awaiting' AND provider_order IS NULL").bind(purchase.id).run();
      throw new Problem(409, 'The unapproved attempt expired. Start checkout again.');
    }
    const created = await new PayPal(c.env).create(purchase);
    assert(providerId(created.id), 502, 'PayPal did not return an order ID.');
    const approve = approvalURL(created);
    await c.env.DB.prepare('UPDATE purchases SET provider_order=?,provider_approval=? WHERE id=? AND provider_order IS NULL AND state=\'awaiting\'')
      .bind(created.id, approve, purchase.id).run();
    purchase = (await knownOrder(c.env, purchase.id))!;
    assert(purchase.provider_order === created.id, 409, 'A different order was already recorded. Check the receipt.');
  }
  // Never re-create an existing order just to recover a missing approval URL.
  let approve = purchase.provider_approval;
  if (!approve && purchase.state === 'awaiting' && purchase.provider_order) {
    const remote = await new PayPal(c.env).order(purchase.provider_order);
    verifyOrder(purchase, remote);
    approve = approvalURL(remote);
  }
  return c.json({ id: purchase.id, state: purchase.state, order: purchase.provider_order, approvalUrl: approve });
});
purchases.get('/:id', async c => {
  const buyer = actor(c);
  const row = await owned(c.env, c.req.param('id'), buyer.id);
  assert(row, 404, 'Receipt not found.');
  return c.json(await receipt(c.env, row));
});
purchases.post('/:id/capture', async c => {
  const buyer = actor(c);
  const id = c.req.param('id');
  const row = await owned(c.env, id, buyer.id);
  assert(row?.provider_order, 404, 'Checkout not found.');
  await throttle(c, 'capture', buyer.id, 15, 300);
  const input = await readJSON(c);
  assert(input.order === row.provider_order, 409, 'The approved order does not match this checkout.');
  const current = await sync(c.env, row, true);
  if (['awaiting','pending'].includes(current.state) && !await canStart(c.env, 'checkout'))
    throw new Problem(503, 'Payment capture is paused while delivery capacity is limited. Check your receipt for status.');
  assert(current.state !== 'awaiting', 409, 'Approve the order in PayPal before capturing.');
  return c.json(await receipt(c.env, current));
});
purchases.post('/:id/refresh', async c => {
  const buyer = actor(c);
  const row = await owned(c.env, c.req.param('id'), buyer.id);
  assert(row, 404, 'Receipt not found.');
  await throttle(c, 'refresh', buyer.id, 20, 300);
  const current = row.provider_order ? await sync(c.env, row, ['awaiting','pending'].includes(row.state)) : row;
  return c.json(await receipt(c.env, current));
});
purchases.post('/:id/cancel', async c => {
  const buyer = actor(c);
  const row = await owned(c.env, c.req.param('id'), buyer.id);
  assert(row, 404, 'Receipt not found.');
  await throttle(c, 'cancel', buyer.id, 12, 300);
  const current = row.provider_order ? await sync(c.env, row) : row;
  if (current.state === 'awaiting' && !current.capture_started) {
    await c.env.DB.prepare("UPDATE purchases SET state='cancelled' WHERE id=? AND state='awaiting'").bind(current.id).run();
  }
  return c.json(await receipt(c.env, (await knownOrder(c.env, current.id))!));
});

export const library = new Hono<AppEnv>();
library.get('/', async c => {
  const buyer = actor(c);
  const rows = await c.env.DB.prepare('SELECT p.id,p.state,p.amount,p.accepted_at,p.release_id,json_extract(r.snapshot,\'$.title\') AS title,json_extract(r.snapshot,\'$.version\') AS version FROM purchases p JOIN releases r ON r.id=p.release_id WHERE p.buyer_id=? ORDER BY p.accepted_at DESC LIMIT 50')
    .bind(buyer.id).all();
  return c.json({ purchases: rows.results });
});
type Download = { id: string; artifact_key: string; digest: string };
const downloadQuery = "SELECT e.id,r.artifact_key,p.digest FROM entitlements e JOIN purchases p ON e.purchase_id=p.id JOIN releases r ON p.release_id=r.id " +
  "WHERE p.buyer_id=? AND p.state='complete' AND e.revoked_at IS NULL AND r.status<>'held' AND r.digest=p.digest " +
  "AND NOT EXISTS (SELECT 1 FROM inbox i WHERE i.provider='paypal-sandbox' AND i.event_type='PAYMENT.CAPTURE.REVERSED' AND i.subject=p.id AND i.capture_id=p.provider_capture)";
library.post('/:id/download', async c => {
  const buyer = actor(c);
  await throttle(c, 'download', buyer.id, 25, 300);
  const grant = await c.env.DB.prepare(downloadQuery + ' AND e.id=?').bind(buyer.id, c.req.param('id')).first<Download>();
  assert(grant, 404, 'Download is not available for this account.');
  assert(await delivery(c.env, grant.id), 503, 'Payment is recorded. The archive is temporarily unavailable. Retry from your receipt.');
  const token = uuid() + uuid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO download_tokens VALUES (?,?,?)').bind(await sha256(token), grant.id, seconds() + 180),
    c.env.DB.prepare("INSERT INTO delivery_events(id,entitlement_id,event) VALUES (?,?,'issued')").bind(uuid(), grant.id),
  ]);
  return c.json({ url: '/api/library/download/' + token, expiresIn: 180 });
});
library.get('/download/:token', async c => {
  const buyer = actor(c);
  const token = c.req.param('token');
  assert(token.length === 72, 404, 'Download link is invalid. Request a new link from the receipt.');
  // Atomically redeem one ticket for the buyer who owns the current grant.
  const redeemed = await c.env.DB.prepare('DELETE FROM download_tokens WHERE token_hash=? AND expires_at>? AND entitlement_id IN (SELECT g.id FROM (' +
    downloadQuery + ') g) RETURNING entitlement_id').bind(await sha256(token), seconds(), buyer.id).first<{ entitlement_id: string }>();
  assert(redeemed, 404, 'Download link expired or access was revoked. Request a new link from the receipt.');
  const grant = await c.env.DB.prepare(downloadQuery + ' AND e.id=?').bind(buyer.id, redeemed.entitlement_id).first<Download>();
  assert(grant, 404, 'Download link expired or access was revoked. Request a new link from the receipt.');
  const archive = await artifactGet(c.env, grant.artifact_key);
  assert(archive?.customMetadata?.digest === grant.digest, 503, 'The archive is temporarily unavailable.');
  await c.env.DB.prepare("INSERT INTO delivery_events(id,entitlement_id,event) VALUES (?,?,'stream_started')").bind(uuid(), grant.id).run();
  return new Response(archive.body, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="zcode-' + grant.digest.slice(0, 12) + '.zip"',
    'Content-Length': String(archive.size), 'X-Archive-Sha256': grant.digest, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});

export async function paypalWebhook(c: Ctx) {
  assert(paypalConfigured(c.env) && c.env.PAYPAL_WEBHOOK_ID, 503, 'PayPal webhooks are awaiting configuration.');
  const raw = await readBytes(c, 150000);
  let rawEvent: string, event: Record<string, unknown>;
  try {
    rawEvent = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    event = JSON.parse(rawEvent);
  } catch { throw new Problem(400, 'Invalid PayPal event.'); }
  assert(event && typeof event === 'object' && !Array.isArray(event), 400, 'Invalid PayPal event.');
  const eventId = event.id;
  const type = str(event.event_type, 80);
  assert(providerId(eventId) && type, 400, 'Invalid PayPal event.');
  const headers = {
    transmission_id: c.req.header('paypal-transmission-id'), transmission_time: c.req.header('paypal-transmission-time'),
    cert_url: c.req.header('paypal-cert-url'), auth_algo: c.req.header('paypal-auth-algo'), transmission_sig: c.req.header('paypal-transmission-sig'),
  };
  assert(Object.values(headers).every(Boolean) && headers.auth_algo === 'SHA256withRSA' &&
    /^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v1\/notifications\/certs\/[A-Za-z0-9_-]+$/.test(headers.cert_url ?? ''),
    403, 'Invalid PayPal signature headers.');
  const verification = await new PayPal(c.env).verifyWebhook(headers, rawEvent);
  assert(verification.verification_status === 'SUCCESS', 403, 'Invalid PayPal signature.');
  const resource = event.resource as {
    id?: string; invoice_id?: string; supplementary_data?: { related_ids?: { order_id?: string; capture_id?: string } };
    links?: { rel: string; href: string }[];
  } | undefined;
  const related = resource?.supplementary_data?.related_ids;
  const links = Array.isArray(resource?.links) ? resource.links.filter(link => link?.rel === 'up') : [];
  const fromLink = (pattern: RegExp) => links.map(link => typeof link.href === 'string' && link.href.match(pattern)?.[1]).find(Boolean);
  const providerOrder = type === 'CHECKOUT.ORDER.COMPLETED' ? resource?.id : related?.order_id ??
    fromLink(/^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v2\/checkout\/orders\/([A-Za-z0-9_-]+)$/);
  const capture = type.startsWith('PAYMENT.CAPTURE.') ? related?.capture_id ??
    fromLink(/^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v2\/payments\/captures\/([A-Za-z0-9_-]+)$/) ??
    (type === 'PAYMENT.CAPTURE.REFUNDED' ? undefined : resource?.id) : undefined;
  const orderId = providerId(providerOrder) ? providerOrder : null;
  const captureId = providerId(capture) ? capture : null;
  const invoice = providerId(resource?.invoice_id) ? resource.invoice_id : null;
  const prior = await c.env.DB.prepare("SELECT subject,processed_at FROM inbox WHERE provider='paypal-sandbox' AND event_id=?")
    .bind(eventId).first<{ subject: string | null; processed_at: number | null }>();
  if (prior?.processed_at) return c.json({ received: true });
  if (!prior) {
    const matches = await c.env.DB.prepare('SELECT * FROM purchases WHERE provider_order=? OR provider_capture=? OR id=? LIMIT 2')
      .bind(orderId, captureId, invoice).all<Purchase>();
    const row = matches.results[0];
    assert(matches.results.length < 2 && (!row || ((!orderId || row.provider_order === orderId) &&
      (!invoice || row.id === invoice) && (!captureId || !row.provider_capture || row.provider_capture === captureId))),
    409, 'PayPal event references do not match a single purchase.');
    const statements = [c.env.DB.prepare("INSERT OR IGNORE INTO inbox(provider,event_id,subject,event_type,capture_id) VALUES ('paypal-sandbox',?,?,?,?)")
      .bind(eventId, row?.id ?? null, type, captureId)];
    if (row) statements.push(reconcileStatement(c.env, row.id));
    await c.env.DB.batch(statements);
  }
  const stored = await c.env.DB.prepare("SELECT subject,event_type FROM inbox WHERE provider='paypal-sandbox' AND event_id=?")
    .bind(eventId).first<{ subject: string | null; event_type: string }>();
  if (stored?.subject && (stored.event_type.startsWith('PAYMENT.CAPTURE.') || stored.event_type === 'CHECKOUT.ORDER.COMPLETED')) {
    const row = await knownOrder(c.env, stored.subject);
    if (row?.provider_order) await sync(c.env, row);
  }
  await c.env.DB.prepare("UPDATE inbox SET processed_at=unixepoch() WHERE provider='paypal-sandbox' AND event_id=?").bind(eventId).run();
  return c.json({ received: true });
}

export const commerceOperator = new Hono<AppEnv>();
commerceOperator.post('/paypal/check', async c => {
  operator(c);
  await throttle(c, 'paypal-check', 'operator', 6, 3600);
  await new PayPal(c.env).checkWebhook();
  return c.json({ environment: 'sandbox', authenticated: true, webhookMatches: true, checkoutEnabled: paymentReady(c.env) });
});
commerceOperator.post('/reconcile', async c => {
  operator(c);
  const job = await c.env.DB.prepare(
    "UPDATE outbox SET state='leased',lease_until=unixepoch()+120,lease_id=?,attempts=attempts+1 WHERE id=(SELECT id FROM outbox WHERE kind IN ('reconcile','deliver') AND available_at<=unixepoch() AND (state='ready' OR (state='leased' AND lease_until<=unixepoch())) ORDER BY available_at LIMIT 1) RETURNING id,subject,kind,attempts,lease_id"
  ).bind(uuid()).first<{ id: string; subject: string; kind: string; attempts: number; lease_id: string }>();
  if (!job) return c.json({ processed: false });
  let done = false;
  let deferred = false;
  try {
    const row = await knownOrder(c.env, job.subject);
    if (!row) done = true;
    else if (job.kind === 'deliver') done = row.state === 'refunded' || await delivery(c.env, row.id);
    else if (row.provider_order) {
      const current = await sync(c.env, row, row.state === 'pending');
      done = ['refunded','declined','cancelled','expired'].includes(current.state) ||
        (current.state === 'complete' && !current.refund_started);
      deferred = ['awaiting','pending'].includes(current.state) && !await canStart(c.env, 'checkout').catch(() => false);
    }
  } catch (error) {
    if (job.kind === 'deliver' && error instanceof Problem && error.status === 503) deferred = true;
    else throw error;
  } finally {
    await c.env.DB.prepare('UPDATE outbox SET state=?,available_at=?,attempts=?,lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?')
      .bind(done ? 'done' : !deferred && job.attempts >= 12 ? 'dead' : 'ready',
        seconds() + (deferred ? 300 : Math.min(1800, 2 ** job.attempts * 5)), deferred ? Math.max(0, job.attempts - 1) : job.attempts,
        job.id, job.lease_id).run();
  }
  return c.json({ processed: true, kind: job.kind, done, deferred });
});
commerceOperator.post('/refund/:id', async c => {
  operator(c);
  const id = c.req.param('id');
  const input = await readJSON(c);
  const caseId = str(input.caseId, 64);
  const support = await c.env.DB.prepare('SELECT id FROM support_cases WHERE id=? AND purchase_id=?').bind(caseId, id).first();
  const row = await knownOrder(c.env, id);
  assert(support && row?.provider_capture && ['complete','refunded'].includes(row.state), 409, 'A completed capture and a linked support case are required.');
  let current = await sync(c.env, row);
  if (current.state === 'refunded') return c.json(await receipt(c.env, current));
  assert(!row.refund_started || seconds() - row.refund_started < retryWindow, 409, 'The refund needs manual PayPal reconciliation.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE purchases SET refund_started=COALESCE(refund_started,unixepoch()) WHERE id=? AND state=\'complete\'').bind(id),
    c.env.DB.prepare("UPDATE support_cases SET resolution='Full Sandbox refund requested' WHERE id=?").bind(caseId),
  ]);
  await reconcileStatement(c.env, id).run();
  const result = await new PayPal(c.env).refund(row, row.provider_capture);
  assert(providerId(result.id) && sameMoney(row, result.amount), 409, 'PayPal refund details did not match the request.');
  await c.env.DB.prepare('UPDATE purchases SET provider_refund=? WHERE id=? AND (provider_refund IS NULL OR provider_refund=?)').bind(result.id, id, result.id).run();
  current = await sync(c.env, (await knownOrder(c.env, id))!);
  if (current.state === 'refunded') await c.env.DB.prepare("UPDATE support_cases SET resolution='Full Sandbox refund verified' WHERE id=?").bind(caseId).run();
  return c.json(await receipt(c.env, current));
});
