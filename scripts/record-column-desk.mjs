import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const edition = process.argv[2];
if (!['inspect', 'studio'].includes(edition)) throw new Error('Choose inspect or studio.');
const studio = edition === 'studio';
const evidence = resolve('.local/column-desk-release', edition);
const out = resolve('public/samples/column-desk', edition);
const source = join(evidence, 'column-desk.zip');
const report = JSON.parse(await readFile(join(evidence, 'report.json'), 'utf8'));
const checksum = createHash('sha256').update(await readFile(source)).digest('hex');
if (!report.corePassed || checksum !== report.digest) throw new Error('The ZIP must match its passing verifier report.');

const clean = await mkdtemp(join(tmpdir(), 'column-desk-release-'));
const browser = await chromium.launch({ channel: 'chrome' });
let server;
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { ...options, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error ?? cmd + ' failed'));
  return result.stdout.trim();
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function record(name, action) {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 740 }, recordVideo: { dir: clean, size: { width: 1100, height: 740 } },
  });
  const page = await context.newPage();
  try { await action(page); }
  finally { await context.close(); }
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', await page.video().path(),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', join(out, name + '.mp4')]);
}
const vendor = { name: 'vendor-export.csv', mimeType: 'text/csv',
  buffer: Buffer.from('id,email,amount\nA1,a@example.test,12\nA1,invalid,bad\nA2,b@example.test\n') };
try {
  await mkdir(out, { recursive: true });
  run('python', ['-m', 'zipfile', '-e', source, clean]);
  const install = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: clean, shell: process.platform === 'win32' });
  server = spawn(process.execPath, ['server.mjs'], { cwd: clean, env: { ...process.env, PORT: '4178' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const startup = await new Promise((resolve, reject) => {
    server.stdout.once('data', bytes => resolve(String(bytes).trim()));
    server.once('error', reject);
    setTimeout(() => reject(new Error('Clean release did not start')), 7000).unref();
  });
  const url = 'http://127.0.0.1:4178/';
  if (!studio) {
    for (const name of ['index.html', 'style.css', 'csv.js', 'desk.js', 'edition.js']) await copyFile(join(clean, name), join(out, name));
    await copyFile(source, join(out, 'column-desk.zip'));
  }
  await record('product', async page => {
    await page.goto(url);
    await wait(1200);
    await page.getByLabel('Choose CSV').setInputFiles(vendor);
    await page.getByText('Expected 3 fields, found 2', { exact: false }).waitFor();
    await wait(1700);
    if (studio) {
      await page.getByRole('region', { name: 'CSV contract' }).scrollIntoViewIfNeeded();
      await page.getByLabel('id unique', { exact: true }).check();
      await wait(450);
      await page.getByLabel('email type', { exact: true }).selectOption('email');
      await wait(450);
      await page.getByLabel('amount required', { exact: true }).check();
      await page.getByLabel('amount type', { exact: true }).selectOption('number');
      await wait(500);
      await page.getByRole('button', { name: 'Validate against contract' }).click();
      await page.getByText('4 violations across 3 data rows.', { exact: true }).waitFor();
      await page.getByRole('region', { name: 'CSV contract' }).scrollIntoViewIfNeeded();
      const [saved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export contract', exact: true }).click()]);
      if (JSON.parse(await readFile(await saved.path(), 'utf8')).columns.length !== 3) throw new Error('Wrong exported rules.');
    } else {
      const [saved] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download inspection' }).click()]);
      if (JSON.parse(await readFile(await saved.path(), 'utf8')).issues.length !== 1) throw new Error('Wrong exported finding.');
    }
    await page.screenshot({ path: join(out, 'cover.png') });
    await wait(1800);
  });
  await record('setup', async page => {
    await page.setContent('<style>body{background:#f8f4e8;color:#282118;font:16px/1.55 ui-monospace,monospace;padding:55px}pre{white-space:pre-wrap;background:#fffaf0;padding:22px;border:1px solid #d8ceb7;border-radius:12px}</style><h1>Clean install from the verified ZIP</h1><pre></pre>');
    await page.locator('pre').evaluate((element, output) => { element.textContent = output; },
      'SHA-256 column-desk.zip\n' + checksum + '\n\n$ python -m zipfile -e column-desk.zip clean-folder\n' +
      '$ cd clean-folder\n$ npm ci --offline --ignore-scripts --no-audit --no-fund\n' + install + '\n\n$ node server.mjs\n' + startup);
    await wait(4200);
    await page.goto(url);
    await page.getByLabel('Choose CSV').setInputFiles(vendor);
    await page.getByText('Expected 3 fields, found 2', { exact: false }).waitFor();
    await wait(2200);
  });
  await writeFile(join(evidence, 'clean-install.json'), JSON.stringify({ edition, digest: checksum, install, startup,
    chromium: browser.version(), observed: studio ? 'Structure report, four rule violations, and three-column contract export' :
      'Short CSV record and corresponding JSON finding', exactArchive: true }, null, 2) + '\n');
  console.log(edition + ' recorded from exact ZIP ' + checksum);
} finally {
  await browser.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
  await rm(clean, { force: true, recursive: true, maxRetries: 5, retryDelay: 150 });
}
