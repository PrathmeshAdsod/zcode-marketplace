import { spawn, spawnSync } from 'node:child_process';
import { cp, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const result = { phase: 'install', runtime: process.version, chromium: '', observed: false };
let server;
let browser;
try {
  await cp('/source', '/tmp/release', { recursive: true });
  const manifest = JSON.parse(await readFile('/tmp/release/package.json', 'utf8'));
  if (typeof manifest.scripts?.start !== 'string') throw new Error('No documented start script');
  const options = { cwd: '/tmp/release', env: { PATH: process.env.PATH, HOME: '/tmp', npm_config_cache: '/tmp/npm',
    npm_config_update_notifier: 'false', HOST: '127.0.0.1', PORT: '4173' }, stdio: 'ignore' };
  const install = spawnSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { ...options, timeout: 24000 });
  if (install.status !== 0) throw new Error('Offline install failed');
  result.phase = 'startup';
  server = spawn('npm', ['start'], { ...options, detached: true });
  server.on('error', () => {});
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch('http://127.0.0.1:4173/', { signal: AbortSignal.timeout(200) })).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  if (!ready) throw new Error('Local server did not start');
  result.phase = 'browser';
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  result.chromium = browser.version();
  const page = await browser.newPage({ viewport: { width: 1050, height: 700 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4173/', { timeout: 6000 });
  await page.getByRole('button', { name: 'Begin trail' }).waitFor({ timeout: 4000 });
  result.phase = 'play';
  await page.keyboard.press('Enter');
  await page.locator('#status').filter({ hasText: 'Acorns 0 / 3' }).waitFor({ timeout: 2500 });
  await page.keyboard.down('ArrowRight');
  await page.locator('#status').filter({ hasText: 'Trail complete' }).waitFor({ timeout: 9000 });
  await page.keyboard.up('ArrowRight');
  result.observed = true;
  result.phase = 'complete';
} catch {
  // Only fixed platform observations leave the container.
} finally {
  if (browser) await browser.close();
  if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  process.stdout.write(JSON.stringify(result));
}
