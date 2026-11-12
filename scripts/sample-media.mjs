import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const evidence = resolve('.local/sample');
const out = resolve('public/samples/acorn');
const sourceZip = join(evidence, 'acorn-trail.zip');
const report = JSON.parse(await readFile(join(evidence, 'report.json'), 'utf8'));
if (!report.corePassed || report.digest !== createHash('sha256').update(await readFile(sourceZip)).digest('hex')) {
  throw new Error('Run the isolated sample verifier first. Its digest must match the exact sample ZIP.');
}
const temp = await mkdtemp(join(tmpdir(), 'zcode-buyer-'));
let browser, server;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(command + ' failed. ' + (result.stderr || result.error || ''));
  return result.stdout.trim();
}
function framePath(dir, index) { return join(dir, String(index).padStart(4, '0') + '.png'); }
async function frames(page, dir, offset, count) {
  for (let index = offset; index < offset + count; index++) {
    const start = performance.now();
    await page.screenshot({ path: framePath(dir, index) });
    const wait = 1000 / 12 - (performance.now() - start);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  }
}
function encode(dir, name) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '12', '-i', join(dir, '%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', join(out, name)]);
}
function escape(text) { return text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]); }
try {
  await mkdir(out, { recursive: true });
  await copyFile(sourceZip, join(out, 'acorn-trail.zip'));
  for (const file of ['index.html', 'game.js', 'game.css']) await copyFile(join('samples/acorn-trail', file), join(out, file));
  run('python', ['-m', 'zipfile', '-e', sourceZip, temp]);
  const install = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: temp, shell: process.platform === 'win32' });
  server = spawn(process.execPath, ['server.mjs'], { cwd: temp, env: { ...process.env, PORT: '4177', HOST: '127.0.0.1' }, stdio: ['ignore','pipe','ignore'] });
  const startup = await new Promise((resolve, reject) => {
    server.stdout.once('data', data => resolve(data.toString().trim()));
    server.once('error', reject);
    setTimeout(() => reject(new Error('Buyer server did not start')), 5000).unref();
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const product = join(temp, 'product-frames');
  const setup = join(temp, 'setup-frames');
  await mkdir(product); await mkdir(setup);
  await page.goto('http://127.0.0.1:4177/');
  const cover = await page.locator('#game').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
  await writeFile(join(out, 'cover.png'), Buffer.from(cover, 'base64'));
  await frames(page, product, 0, 16);
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowRight');
  await frames(page, product, 16, 48);
  await page.keyboard.up('ArrowRight');
  await page.getByText('Trail complete · 3 acorns delivered').waitFor({ timeout: 5000 });
  await frames(page, product, 64, 13);
  encode(product, 'product.mp4');

  const terminal = '$ SHA-256 acorn-trail.zip\n' + report.digest +
    '\n\n$ python -m zipfile -e acorn-trail.zip clean-folder\n$ cd clean-folder\n$ npm ci --offline --ignore-scripts --no-audit --no-fund\n' + install +
    '\n\n$ node server.mjs\n' + startup;
  await page.setContent('<style>body{background:#132522;color:#dbecde;font:17px/1.6 ui-monospace,monospace;padding:45px}h1{color:#fff6da}pre{border:1px solid #688375;padding:24px;white-space:pre-wrap}</style>' +
    '<h1>Clean install from the delivered ZIP</h1><pre>' + escape(terminal) + '</pre>');
  await frames(page, setup, 0, 52);
  await page.goto('http://127.0.0.1:4177/');
  await frames(page, setup, 52, 16);
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowRight');
  await frames(page, setup, 68, 48);
  await page.keyboard.up('ArrowRight');
  await page.getByText('Trail complete · 3 acorns delivered').waitFor({ timeout: 5000 });
  await frames(page, setup, 116, 14);
  encode(setup, 'setup.mp4');
  await writeFile(join(evidence, 'buyer-install.json'), JSON.stringify({
    digest: report.digest, extractedIntoFreshFolder: true, offlineNpmInstall: install, startup, observed: 'Trail complete · 3 acorns delivered',
    node: process.version, chrome: browser.version(),
  }, null, 2));
  console.log('Buyer installed and completed the trail using SHA-256 ' + report.digest);
} finally {
  await browser?.close();
  server?.kill();
  await rm(temp, { recursive: true, force: true });
}
