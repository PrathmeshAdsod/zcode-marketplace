import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2] ?? 'https://zcode-marketplace.pages.dev').origin;
const record = process.argv.includes('--record');
const output = '.local/finder-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true,
  ...(record ? { recordVideo: { dir: output, size: { width: 1440, height: 900 } } } : {}) });
const page = await context.newPage();
const brief = 'I need a game that opens in a browser. The classroom network may be down for the entire lesson once it is installed. Arrow keys would be nice. I can spend up to $60 once, and a recurring API bill is a deal breaker.';
const checks = [];
let passed = false;
const read = ms => record ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
const shot = (name) => page.screenshot({ path: output + '/' + name + '.png', animations: 'disabled' });
try {
  const session = await (await context.request.get(origin + '/api/session')).json();
  assert.equal(session.account, null);
  await page.goto(origin);
  await page.locator('#landing-title').waitFor();
  await read(2500);
  await page.goto(origin + '/browse');
  const search = page.getByRole('textbox', { name: 'Search marketplace' });
  await search.fill(brief);
  await search.press('Enter');
  await read(4500);
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url() === origin + '/api/finder/interpret'),
    page.getByRole('button', { name: 'Interpret with Gemini' }).click(),
  ]);
  const interpreted = await response.json();
  assert.equal(interpreted.model, 'gemini-3.5-flash-lite');
  assert.ok(['gemini', 'cache'].includes(interpreted.mode));
  await page.getByRole('heading', { name: 'Review your requirements' }).waitFor();
  const offline = interpreted.brief.requirements.find(row => row.key === 'offline');
  assert.equal(offline.priority, 'must');
  assert.ok(brief.includes(offline.quote));
  const priority = page.getByLabel('Priority for Keyboard controls', { exact: true });
  assert.equal(await priority.inputValue(), 'prefer');
  await shot('requirements');
  await read(8000);
  await priority.selectOption('must');
  await read(1300);
  await priority.selectOption('prefer');
  assert.equal(await page.getByText('Full match', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Find matching releases' }).click();
  const acorn = page.locator('.result-item').filter({ has: page.getByRole('link', { name: 'View Acorn Trail', exact: true }) });
  const orbit = page.locator('.result-item').filter({ has: page.getByRole('link', { name: 'View Orbit Rooms' }) });
  await acorn.getByText('Full match', { exact: true }).waitFor();
  assert.match(await orbit.innerText(), /Seller claimed.*Not tested/is);
  await acorn.locator('.result-evidence').scrollIntoViewIfNeeded();
  await shot('results');
  await read(7000);
  await acorn.getByRole('button', { name: 'Compare: Acorn Trail' }).click();
  await orbit.getByRole('button', { name: 'Compare: Orbit Rooms' }).click();
  await page.getByRole('link', { name: 'Compare (2)', exact: true }).click();
  await page.getByRole('table').waitFor();
  const offlineRow = page.getByRole('row', { name: /Works without network after setup/ });
  assert.match(await offlineRow.innerText(), /Verified.*Not tested/is);
  await shot('compare');
  await read(7500);
  const card = page.locator('.compare-decisions section').filter({ has: page.getByRole('heading', { name: 'Acorn Trail', exact: true }) });
  const link = card.locator('.finder-evidence-row').filter({ hasText: 'Works without network after setup' }).getByRole('link', { name: 'View finding' });
  const evidencePath = await link.getAttribute('href');
  assert.equal(evidencePath, '/release/acorn-trail#ev-87e194d0bdab-offline');
  await link.click();
  await page.locator('#ev-87e194d0bdab-offline').waitFor();
  await page.reload();
  await page.locator('#ev-87e194d0bdab-offline').scrollIntoViewIfNeeded();
  assert.match(await page.locator('#ev-87e194d0bdab-offline').innerText(), /container networking disabled/);
  await shot('evidence');
  await read(6000);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download sample ZIP' }).click()]);
  const digest = createHash('sha256').update(await readFile(await download.path())).digest('hex');
  const release = await (await context.request.get(origin + '/api/catalog/acorn-trail')).json();
  assert.equal(digest, release.digest);
  assert.equal(digest, release.report.digest);
  checks.push('Anonymous fresh browser', 'Editable requirements with verbatim source wording', 'Comparison shows verified and unknown', 'Evidence link resolves after reload', 'Downloaded sample SHA-256 matches the verifier');
  await read(3500);
  await writeFile('docs/evidence/finder-browser.json', JSON.stringify({ origin, date: new Date().toISOString(),
    browser: browser.version(), source: interpreted.mode, model: interpreted.model, evidencePath, digest, checks }, null, 2) + '\n');
  passed = true;
  console.log({ origin, model: interpreted.model, source: interpreted.mode, digest, checks });
} finally {
  await context.close();
  if (record && passed) {
    const source = await page.video()?.path();
    if (source) {
      const target = 'docs/evidence/zcode-finder-demo.mp4';
      const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || 'Video conversion failed.');
    }
  }
  await browser.close();
}
