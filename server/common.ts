import type { Context } from 'hono';

export type Env = {
  DB: D1Database; ARTIFACTS: R2Bucket; AI?: Ai;
  COST_DB?: D1Database; COST_ADMIN_GITHUB_IDS?: string;
  APP_ORIGIN?: string; LOCAL_DEMO?: string;
  GITHUB_APP_SLUG?: string; GITHUB_APP_ID?: string; GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string; GITHUB_PRIVATE_KEY?: string; GITHUB_WEBHOOK_SECRET?: string;
  REVIEWER_GITHUB_IDS?: string; RELEASE_REVIEW_ASSIGNMENTS?: string; TEAM_SELLER_GITHUB_ID?: string;
  PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_MERCHANT_ID?: string;
  PAYPAL_WEBHOOK_ID?: string; OPERATOR_TOKEN?: string; RUNNER_TOKEN?: string;
  OLLAMA_URL?: string; OLLAMA_MODEL?: string; OLLAMA_EMBED_MODEL?: string;
  GEMINI_API_KEY?: string; GEMINI_FREE_RPM?: string; GEMINI_FREE_TPM?: string; GEMINI_FREE_RPD?: string;
};
export type Actor = { id: string; name: string; role: 'member' | 'reviewer' | 'release-reviewer' };
export type AppEnv = { Bindings: Env; Variables: { actor: Actor | null } };
export type Ctx = Context<AppEnv>;
export class Problem extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503, message: string) { super(message); }
}
export function assert(value: unknown, status: Problem['status'], message: string): asserts value {
  if (!value) throw new Problem(status, message);
}
export const seconds = () => Math.floor(Date.now() / 1000);
export const uuid = () => crypto.randomUUID();
export const utf8 = (s: string) => new TextEncoder().encode(s);
export function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sha256(input: string | ArrayBuffer) {
  return hex(await crypto.subtle.digest('SHA-256', typeof input === 'string' ? utf8(input) : input));
}
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function hmac(secret: string, bytes: string | ArrayBuffer) {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, typeof bytes === 'string' ? utf8(bytes) : bytes));
}
export function equal(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}
export const isLoopback = (url: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
export const local = (c: Ctx) => c.env.LOCAL_DEMO === '1' && isLoopback(c.req.url);
export const origin = (c: Ctx) => c.env.APP_ORIGIN || new URL(c.req.url).origin;
export function actor(c: Ctx, reviewer = false) {
  const account = c.get('actor');
  assert(account, 401, 'Sign in to continue.');
  assert(!reviewer || account.role === 'reviewer', 403, 'Reviewer access is required.');
  return account;
}
export function assignedReleases(env: Env, accountId: string) {
  return (env.RELEASE_REVIEW_ASSIGNMENTS ?? '').split(',').flatMap(entry => {
    const match = /^(\d+):([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.exec(entry.trim());
    return match?.[1] === accountId ? [match[2]] : [];
  });
}
export function operator(c: Ctx) {
  assert(c.env.OPERATOR_TOKEN && c.env.OPERATOR_TOKEN.length >= 32 &&
    equal(c.req.header('authorization') ?? '', 'Bearer ' + c.env.OPERATOR_TOKEN), 403, 'Operator access is required.');
}
export function cookie(c: Ctx, name: string) {
  return (c.req.header('cookie') ?? '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}
export function setCookie(c: Ctx, name: string, value: string, maxAge: number) {
  c.header('Set-Cookie', name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge +
    (new URL(origin(c)).protocol === 'https:' ? '; Secure' : ''), { append: true });
}
export async function session(c: Ctx, id: string) {
  const token = uuid() + uuid();
  await c.env.DB.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(await sha256(token), id, seconds() + 86400).run();
  setCookie(c, 'zsession', token, 86400);
}
export async function identify(c: Ctx) {
  const token = cookie(c, 'zsession');
  if (!token || token.length !== 72) return null;
  const row = await c.env.DB.prepare('SELECT a.id,a.name,a.role FROM accounts a JOIN sessions s ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?')
    .bind(await sha256(token), seconds()).first<Actor>();
  if (row && !row.id.startsWith('demo-')) {
    row.role = (c.env.REVIEWER_GITHUB_IDS ?? '').split(',').map(id => id.trim()).includes(row.id) ? 'reviewer'
      : assignedReleases(c.env, row.id).length ? 'release-reviewer' : 'member';
  }
  return row;
}
export async function throttle(c: Ctx, scope: string, key: string, limit: number, windowSeconds: number) {
  const now = seconds();
  const id = scope + ':' + (await sha256(key)).slice(0, 24);
  const row = await c.env.DB.prepare(
    'INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count'
  ).bind(id, now + windowSeconds, now, now).first<{ count: number }>();
  assert(row && row.count <= limit, 429, 'Too many requests. Try again later.');
}
export async function readJSON(c: Ctx, limit = 24000): Promise<Record<string, unknown>> {
  const body = await readBytes(c, limit);
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(body));
    assert(data && typeof data === 'object' && !Array.isArray(data), 400, 'Expected a JSON object.');
    return data as Record<string, unknown>;
  } catch { throw new Problem(400, 'Expected a JSON object.'); }
}
export async function readBytes(c: Ctx, limit: number): Promise<ArrayBuffer> {
  const declared = c.req.header('content-length');
  assert(!declared || Number(declared) <= limit, 413, 'Request is too large.');
  const reader = c.req.raw.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Problem(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return bytes.buffer;
}
export function str(value: unknown, max = 256) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
export function providerId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
export const byIP = (c: Ctx) => c.req.header('cf-connecting-ip') || 'local';
