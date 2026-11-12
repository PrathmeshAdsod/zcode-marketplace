import { spawn, spawnSync } from 'node:child_process';
import { cp, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const result = { phase: 'install', runtime: process.version, chromium: '', observed: false };
const adapter = process.argv[2] ?? 'node-browser-trail/1';
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
  if (adapter === 'node-browser-trail/1') {
    await page.getByRole('button', { name: 'Begin trail' }).waitFor({ timeout: 4000 });
    result.phase = 'play';
    await page.keyboard.press('Enter');
    await page.locator('#status').filter({ hasText: 'Acorns 0 / 3' }).waitFor({ timeout: 2500 });
    await page.keyboard.down('ArrowRight');
    await page.locator('#status').filter({ hasText: 'Trail complete' }).waitFor({ timeout: 9000 });
    await page.keyboard.up('ArrowRight');
  } else {
    result.phase = 'inspection';
    await page.getByLabel('Choose CSV').setInputFiles({
      name: 'vendor-import.csv', mimeType: 'text/csv',
      buffer: Buffer.from('id,email,amount\n001,first@example.test,42\n001,wrong,invalid\n002,second@example.test\n'),
    }, { timeout: 4000 });
    await page.getByText('Expected 3 fields, found 2', { exact: false }).waitFor({ timeout: 4000 });
    const download = async name => {
      const [item] = await Promise.all([
        page.waitForEvent('download', { timeout: 4000 }),
        page.getByRole('button', { name, exact: true }).click(),
      ]);
      return JSON.parse(await readFile(await item.path(), 'utf8'));
    };
    const inspection = await download('Download inspection');
    if (inspection.records !== 3 || inspection.issues.length !== 1 || inspection.issues[0].record !== 4) throw new Error('Inspection mismatch');
    if (adapter === 'node-browser-csv-inspect/1') {
      if (await page.getByRole('region', { name: 'CSV contract' }).count() ||
        (await fetch('http://127.0.0.1:4173/contract.js')).status !== 404) throw new Error('Unexpected contract workflow');
    } else if (adapter === 'node-browser-csv-studio/1') {
      result.phase = 'contract';
      await page.getByLabel('id unique', { exact: true }).check();
      await page.getByLabel('email type', { exact: true }).selectOption('email');
      await page.getByLabel('amount required', { exact: true }).check();
      await page.getByLabel('amount type', { exact: true }).selectOption('number');
      await page.getByRole('button', { name: 'Validate against contract' }).click();
      await page.getByText('4 violations across 3 data rows.', { exact: true }).waitFor({ timeout: 4000 });
      const validation = await download('Download validation');
      if (validation.issues.length !== 4 || validation.issues.some(issue => ![3, 4].includes(issue.record))) throw new Error('Validation mismatch');
      const schema = await download('Export contract');
      if (schema.version !== 1 || schema.columns.length !== 3 || !schema.columns.some(rule => rule.name === 'id' && rule.unique)) throw new Error('Contract mismatch');
      await page.reload();
      await page.getByLabel('Load contract').setInputFiles({
        name: 'saved-contract.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(schema)),
      });
      await page.getByText('Contract loaded · 3 configured columns.').waitFor({ timeout: 4000 });
      await page.getByLabel('Choose CSV').setInputFiles({
        name: 'corrected.csv', mimeType: 'text/csv', buffer: Buffer.from('id,email,amount\nA1,first@example.test,12.50\nA2,second@example.test,20\n'),
      });
      await page.getByRole('button', { name: 'Validate against contract' }).click();
      await page.getByText('Contract passed for 2 data rows.', { exact: true }).waitFor({ timeout: 4000 });
    } else throw new Error('Unrecognized verification adapter');
  }
  result.observed = true;
  result.phase = 'complete';
} catch {
  // Only fixed platform observations leave the container.
} finally {
  if (browser) await browser.close();
  if (server?.pid) try { process.kill(-server.pid, 'SIGKILL'); } catch {}
  process.stdout.write(JSON.stringify(result));
}
