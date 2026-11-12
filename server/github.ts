import { Hono } from 'hono';
import { actor, assert, base64url, cookie, equal, hmac, local, origin, Problem, readBytes, seconds, session, setCookie, sha256, str, throttle, utf8, uuid, byIP, type AppEnv, type Ctx, type Env } from './common';

type Installation = { id: number; app_id: number; repository_selection: string; account: { id: number; type: string }; suspended_at?: string };
type Repository = { id: number; full_name: string; private: boolean; owner: { id: number } };
export type Connection = { repo_id: number; installation_id: number; full_name: string };
const GITHUB = 'https://api.github.com';
const API_VERSION = '2026-03-10';
async function transport(url: string, options: RequestInit, operation: string) {
  try { return await fetch(url, { ...options, redirect: 'manual' }); }
  catch { throw new Problem(502, 'GitHub ' + operation + ' is temporarily unavailable.'); }
}

async function github<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await transport(GITHUB + path, {
    ...options, signal: AbortSignal.timeout(9000), headers: {
      Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'zcode-marketplace',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  }, 'API');
  assert(response.ok, response.status === 403 || response.status === 404 ? 403 : 502,
    'GitHub could not verify this connection. Check the selected repositories and permissions.');
  try { return await response.json() as T; }
  catch { throw new Problem(502, 'GitHub returned an invalid API response.'); }
}
function pkcs8(pem: string) {
  const raw = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), ch => ch.charCodeAt(0));
  if (!pem.includes('BEGIN RSA PRIVATE KEY')) return raw;
  const tlv = (tag: number, payload: Uint8Array) => {
    const length = payload.length < 128 ? [payload.length] : payload.length < 256 ? [0x81, payload.length] : [0x82, payload.length >> 8, payload.length & 255];
    return Uint8Array.from([tag, ...length, ...payload]);
  };
  const rsa = [0x02, 0x01, 0x00, 0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return tlv(0x30, Uint8Array.from([...rsa, ...tlv(0x04, raw)]));
}
async function appJWT(env: Env) {
  assert(env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY, 503, 'The marketplace GitHub App is awaiting operator setup.');
  const key = await crypto.subtle.importKey('pkcs8', pkcs8(env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const encoded = (value: object) => base64url(utf8(JSON.stringify(value)));
  const head = encoded({ alg: 'RS256', typ: 'JWT' }) + '.' + encoded({ iat: seconds() - 30, exp: seconds() + 480, iss: env.GITHUB_APP_ID });
  return head + '.' + base64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(head))));
}
async function installationToken(env: Env, installation: number, repo?: number) {
  const token = await github<{ token: string }>('/app/installations/' + installation + '/access_tokens', await appJWT(env), {
    method: 'POST', body: JSON.stringify({ permissions: { contents: 'read' }, ...(repo ? { repository_ids: [repo] } : {}) }),
  });
  return token.token;
}
async function activeInstallation(env: Env, seller: string, installationId: number) {
  const info = await github<Installation>('/app/installations/' + installationId, await appJWT(env));
  assert(!info.suspended_at && info.id === installationId && info.app_id === Number(env.GITHUB_APP_ID) &&
    info.repository_selection === 'selected' && info.account.type === 'User' && String(info.account.id) === seller, 403,
  'Install the GitHub App on your personal account with Only select repositories. Organization review is not available yet.');
  return info;
}
const repoPath = (fullName: string) => '/repos/' + fullName.split('/').map(encodeURIComponent).join('/');
export async function freezeCommit(env: Env, seller: string, connection: Connection, ref: string) {
  await activeInstallation(env, seller, connection.installation_id);
  const token = await installationToken(env, connection.installation_id, connection.repo_id);
  const repo = await github<Repository>(repoPath(connection.full_name), token);
  assert(repo.id === connection.repo_id && repo.private && String(repo.owner.id) === seller, 403,
    'The connected repository must be private and owned by the signed-in seller.');
  const commit = await github<{ sha: string }>(repoPath(connection.full_name) + '/commits/' + encodeURIComponent(ref), token);
  assert(/^[a-f0-9]{40}$/.test(commit.sha), 502, 'GitHub did not return a full commit SHA.');
  return commit.sha;
}
export async function getArchive(env: Env, seller: string, connection: Connection, commit: string) {
  assert(await freezeCommit(env, seller, connection, commit) === commit, 409, 'The pinned commit is no longer available.');
  const token = await installationToken(env, connection.installation_id, connection.repo_id);
  const metadata = await github<{ commit: { tree: { sha: string } } }>(
    repoPath(connection.full_name) + '/commits/' + commit, token);
  const treeSha = metadata.commit.tree.sha;
  assert(/^[a-f0-9]{40}$/.test(treeSha), 502, 'GitHub did not provide a source tree for the pinned commit.');
  const tree = await github<{ truncated: boolean; tree: { mode: string; type: string }[] }>(
    repoPath(connection.full_name) + '/git/trees/' + treeSha + '?recursive=1', token);
  assert(!tree.truncated && !tree.tree.some(item => item.mode === '160000' || item.type === 'commit'), 409,
    'The source inventory is incomplete or contains submodules. Package all required content directly.');
  const redirect = await transport(GITHUB + repoPath(connection.full_name) + '/zipball/' + commit, {
    redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'zcode-marketplace' },
  }, 'archive lookup');
  const destination = redirect.headers.get('location');
  assert(redirect.status === 302 && destination, 502, 'GitHub did not provide an archive.');
  const url = new URL(destination);
  assert(url.protocol === 'https:' && url.host === 'codeload.github.com' && !url.username && !url.password, 502, 'Unexpected archive destination.');
  const archive = await transport(url.href, { signal: AbortSignal.timeout(20000) }, 'archive download');
  assert(archive.ok && archive.body, 502, 'The pinned source archive could not be downloaded.');
  return archive;
}
async function begin(c: Ctx, purpose: string, accountId?: string, verifier?: string, returnTo?: string) {
  const state = uuid() + uuid();
  await c.env.DB.prepare('INSERT INTO oauth_states(token_hash,purpose,account_id,verifier,expires_at,return_to) VALUES (?,?,?,?,?,?)')
    .bind(await sha256(state), purpose, accountId ?? null, verifier ?? null, seconds() + 600, returnTo ?? null).run();
  setCookie(c, 'zstate_' + purpose, state, 600);
  return state;
}
async function consume(c: Ctx, purpose: string, setupURL = false) {
  const state = c.req.query('state') ?? (setupURL ? cookie(c, 'zstate_' + purpose) ?? '' : '');
  assert(state.length === 72 && equal(state, cookie(c, 'zstate_' + purpose) ?? ''), 403, 'This connection expired. Start again from Zcode.');
  const row = await c.env.DB.prepare('DELETE FROM oauth_states WHERE token_hash=? AND purpose=? AND expires_at>? RETURNING account_id,verifier,return_to')
    .bind(await sha256(state), purpose, seconds()).first<{ account_id: string | null; verifier: string | null; return_to: string | null }>();
  assert(row, 403, 'This connection expired. Start again from Zcode.');
  setCookie(c, 'zstate_' + purpose, '', 0);
  return row;
}
export const githubRoutes = new Hono<AppEnv>();
async function authorize(c: Ctx, purpose: 'login' | 'connect', seller?: string, returnTo?: string) {
  assert(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET && c.env.APP_ORIGIN, 503, 'GitHub sign-in is awaiting operator setup.');
  const verifier = uuid() + uuid();
  const state = await begin(c, purpose, seller, verifier, returnTo);
  const query = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID, redirect_uri: origin(c) + '/api/github/callback', state,
    code_challenge_method: 'S256', code_challenge: base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier)))),
  });
  return c.redirect('https://github.com/login/oauth/authorize?' + query);
}
githubRoutes.get('/login', async c => {
  await throttle(c, 'login', byIP(c), 25, 600);
  const destination = str(c.req.query('return'), 100);
  const safe = /^\/(?:studio|review|library|support|admin\/usage|(?:checkout|receipt)\/[\w-]+)$/.test(destination) ? destination : '/';
  return authorize(c, 'login', undefined, safe);
});
githubRoutes.get('/callback', async c => {
  const connectState = cookie(c, 'zstate_connect');
  const connecting = Boolean(connectState && connectState === c.req.query('state'));
  const state = await consume(c, connecting ? 'connect' : 'login');
  const code = str(c.req.query('code'), 256);
  assert(code && state.verifier && c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET, 403, 'GitHub authorization was cancelled. Try signing in again.');
  const response = await transport('https://github.com/login/oauth/access_token', {
    method: 'POST', signal: AbortSignal.timeout(9000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET,
      code, code_verifier: state.verifier, redirect_uri: origin(c) + '/api/github/callback' }),
  }, 'authorization');
  const token = await response.json() as { access_token?: string };
  assert(response.ok && token.access_token, 403, 'GitHub authorization failed. Sign in again.');
  const user = await github<{ id: number; login: string }>('/user', token.access_token);
  const id = String(user.id);
  if (connecting) {
    assert(state.account_id === id && actor(c).id === id, 403, 'Sign in as the GitHub account that started installation.');
    const accessible = await github<{ installations: Installation[] }>('/user/installations?per_page=100', token.access_token);
    const install = accessible.installations.find(row => row.account.type === 'User' && row.account.id === user.id && row.repository_selection === 'selected');
    assert(install, 409, 'No selected-repository installation is approved for this personal GitHub account.');
    await activeInstallation(c.env, id, install.id);
    const { repositories, total_count } = await github<{ repositories: Repository[]; total_count: number }>(
      '/user/installations/' + install.id + '/repositories?per_page=20', token.access_token);
    assert(total_count <= 20, 409, 'Select at most 20 repositories in the GitHub App settings.');
    const repos = repositories.filter(repo => repo.private && repo.owner.id === user.id);
    const update = c.env.DB.prepare('UPDATE repo_connections SET revoked_at=unixepoch() WHERE seller_id=? AND installation_id=?').bind(id, install.id);
    await c.env.DB.batch([update, ...repos.map(repo => c.env.DB.prepare(
      'INSERT INTO repo_connections VALUES (?,?,?,?,NULL) ON CONFLICT(seller_id,repo_id) DO UPDATE SET installation_id=excluded.installation_id,full_name=excluded.full_name,revoked_at=NULL'
    ).bind(id, repo.id, install.id, repo.full_name))]);
    return c.redirect('/studio');
  }
  await c.env.DB.prepare("INSERT INTO accounts(id,name,role) VALUES (?,?,'member') ON CONFLICT(id) DO UPDATE SET name=excluded.name")
    .bind(id, user.login).run();
  await session(c, id);
  return c.redirect(state.return_to || '/');
});
githubRoutes.get('/install/start', async c => {
  const seller = actor(c);
  assert(c.env.GITHUB_APP_SLUG && c.env.APP_ORIGIN && /^[a-zA-Z0-9-]+$/.test(c.env.GITHUB_APP_SLUG) && !seller.id.startsWith('demo-'),
    503, 'Selected-repository connections require the configured GitHub App and a GitHub sign-in.');
  await throttle(c, 'install', seller.id, 12, 600);
  const state = await begin(c, 'install', seller.id);
  return c.redirect('https://github.com/apps/' + c.env.GITHUB_APP_SLUG + '/installations/new?state=' + state);
});
githubRoutes.get('/install/callback', async c => {
  const seller = actor(c);
  const state = await consume(c, 'install', true);
  assert(seller.id === state.account_id, 403, 'Sign in as the seller who started this connection.');
  return authorize(c, 'connect', seller.id);
});
githubRoutes.get('/install/refresh', async c => {
  const seller = actor(c);
  assert(!seller.id.startsWith('demo-'), 403, 'Sign in with GitHub to refresh connections.');
  await throttle(c, 'install', seller.id, 12, 600);
  return authorize(c, 'connect', seller.id);
});
githubRoutes.get('/repositories', async c => {
  const seller = actor(c);
  const result = await c.env.DB.prepare('SELECT repo_id,full_name FROM repo_connections WHERE seller_id=? AND revoked_at IS NULL ORDER BY full_name')
    .bind(seller.id).all();
  return c.json({ repositories: result.results, configured: Boolean(c.env.GITHUB_APP_SLUG) && !(local(c) && seller.id.startsWith('demo-')) });
});
export async function githubWebhook(c: Ctx) {
  assert(c.env.GITHUB_WEBHOOK_SECRET, 503, 'GitHub webhooks are awaiting configuration.');
  const raw = await readBytes(c, 300000);
  const signature = 'sha256=' + await hmac(c.env.GITHUB_WEBHOOK_SECRET, raw);
  assert(equal(signature, c.req.header('x-hub-signature-256') ?? ''), 403, 'Invalid signature.');
  const eventId = str(c.req.header('x-github-delivery'), 64);
  const type = str(c.req.header('x-github-event'), 64);
  assert(eventId && type, 400, 'Missing delivery headers.');
  const body = JSON.parse(new TextDecoder().decode(raw)) as {
    action?: string; installation?: { id: number }; repositories_removed?: { id: number }[];
  };
  const installation = body.installation?.id;
  const statements: D1PreparedStatement[] = [];
  if (installation && type === 'installation' && ['deleted', 'suspend'].includes(body.action ?? '')) {
    statements.push(c.env.DB.prepare('UPDATE repo_connections SET revoked_at=unixepoch() WHERE installation_id=?').bind(installation));
  }
  if (installation && type === 'installation_repositories' && body.action === 'removed') {
    for (const repo of (body.repositories_removed ?? []).slice(0, 100)) {
      statements.push(c.env.DB.prepare('UPDATE repo_connections SET revoked_at=unixepoch() WHERE installation_id=? AND repo_id=?').bind(installation, repo.id));
    }
  }
  const inbox = c.env.DB.prepare("INSERT INTO inbox(provider,event_id,event_type,processed_at) VALUES ('github',?,?,unixepoch())").bind(eventId, type);
  try { await c.env.DB.batch([inbox, ...statements]); }
  catch (error) {
    const exists = await c.env.DB.prepare("SELECT 1 FROM inbox WHERE provider='github' AND event_id=?").bind(eventId).first();
    if (!exists) throw error;
  }
  return c.json({ received: true });
}
