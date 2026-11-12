import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2] ?? 'https://zcode-marketplace.pages.dev').origin;
const record = process.argv.includes('--record');
const allowSaved = process.argv.includes('--accept-cached');
const output = '.local/column-desk-release/browser';
const buyerBrief = process.env.ZCODE_DEMO_BRIEF ??
  'Our vendor CSVs repeat order IDs and sometimes put text in the total column. I need to catch both when the network is down, and reuse those checks on the next import. I can spend under $20 once.';
const inspectId = 'column-desk-inspect';
const studioId = 'eac0b888-d153-41b7-88b3-4605a3691381';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 }, acceptDownloads: true,
  ...(record ? { recordVideo: { dir: output, size: { width: 1440, height: 900 } } } : {}),
});
const page = await context.newPage();
const wait = ms => record ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
const get = async path => {
  const response = await context.request.get(origin + path);
  assert.ok(response.ok(), path);
  return response.json();
};
const shot = name => page.screenshot({ path: output + '/' + name + '.png', animations: 'disabled' });
try {
  const { account, localDemo } = await get('/api/session');
  assert.equal(account, null);
  assert.equal(localDemo, false);
  const { releases } = await get('/api/catalog');
  assert.ok(releases.every(release => !release.fixture));
  const studio = releases.find(release => release.id === studioId);
  const inspect = releases.find(release => release.id === inspectId);
  assert.equal(inspect.report.digest, inspect.digest);
  const privatePath = await context.request.get(origin + '/samples/column-desk/studio/column-desk.zip');
  assert.notEqual(Buffer.from(await privatePath.body()).subarray(0, 4).toString('hex'), '504b0304');

  await page.goto(origin);
  await page.locator('#landing-title').waitFor();
  await wait(1600);
  await page.getByRole('navigation', { name: 'Explore Zcode' }).getByRole('link', { name: 'Browse releases', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search marketplace' });
  await search.fill(buyerBrief);
  await search.press('Enter');
  await wait(2600);
  const [interpret] = await Promise.all([
    page.waitForResponse(response => response.url() === origin + '/api/finder/interpret'),
    page.getByRole('button', { name: 'Interpret with Gemini' }).click(),
  ]);
  const interpreted = await interpret.json();
  assert.equal(interpreted.model, 'gemini-3.5-flash-lite');
  assert.ok(interpreted.mode === 'gemini' || (allowSaved && interpreted.mode === 'cache'),
    'Use a fresh brief for a live call or pass --accept-cached to verify a saved interpretation.');
  for (const key of ['offline', 'csv-validation', 'schema-export']) {
    assert.ok(interpreted.brief.requirements.some(row => row.key === key && row.priority === 'must' && row.expected));
  }
  assert.ok(interpreted.brief.requirements.every(row => buyerBrief.includes(row.quote)));
  await page.getByRole('heading', { name: 'Review your requirements' }).waitFor();
  await shot('requirements');
  await wait(5700);
  const budget = page.getByLabel('Upfront budget in USD');
  assert.equal(await budget.inputValue(), '20');
  await budget.fill('15');
  await wait(1100);
  await page.getByRole('button', { name: 'Find matching releases' }).click();
  const freeCard = page.locator('.result-item').filter({ has: page.getByRole('link', { name: 'View Column Desk Inspect', exact: true }) });
  await freeCard.getByText('Near match', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'View Acorn Trail', exact: true }).count(), 0);
  const validation = freeCard.locator('.finder-evidence-row').filter({ hasText: 'Check duplicate IDs' });
  assert.match(await validation.innerText(), /Contradicted/i);
  await validation.scrollIntoViewIfNeeded();
  await shot('matching');
  await wait(4700);
  if (studio) {
    const studioCard = page.locator('.result-item').filter({ has: page.getByRole('link', { name: 'View Column Desk Studio', exact: true }) });
    await studioCard.getByText('Full match', { exact: true }).waitFor();
    await studioCard.getByRole('button', { name: 'Compare: Column Desk Studio' }).click();
    await freeCard.getByRole('button', { name: 'Compare: Column Desk Inspect' }).click();
    await page.getByRole('link', { name: 'Compare (2)', exact: true }).click();
    const row = page.getByRole('row', { name: /Check duplicate IDs/ });
    assert.match(await row.innerText(), /Verified.*Contradicted/is);
    await shot('comparison');
    await wait(5500);
    await page.goto(origin + '/release/' + inspectId);
  } else {
    await page.getByText('No release verifies all of your mandatory requirements.', { exact: false }).waitFor();
    const link = validation.getByRole('link', { name: 'View finding' });
    const expected = '/release/' + inspectId + '#ev-' + inspect.digest.slice(0, 12) + '-csv-validation';
    assert.equal(await link.getAttribute('href'), expected);
    await link.click();
    await page.reload();
    const finding = page.locator('#' + expected.split('#')[1]);
    await finding.scrollIntoViewIfNeeded();
    assert.match(await finding.innerText(), /no contract form or validation module/);
    await shot('evidence');
    await wait(4500);
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download sample ZIP' }).click(),
  ]);
  assert.equal(createHash('sha256').update(await readFile(await download.path())).digest('hex'), inspect.digest);
  await page.goto(origin + inspect.demo);
  await page.getByLabel('Choose CSV').setInputFiles({
    name: 'test-vendor-export.csv', mimeType: 'text/csv', buffer: Buffer.from('order_id,total\nO1,25\nO2\n'),
  });
  await page.getByText('Expected 2 fields, found 1', { exact: false }).waitFor();
  await shot('inspect');
  await wait(5300);
  const evidencePath = interpreted.mode === 'cache' ? 'docs/evidence/column-desk-browser-cached.json' : 'docs/evidence/column-desk-browser.json';
  await writeFile(evidencePath, JSON.stringify({
    origin, date: new Date().toISOString(), browser: browser.version(), source: interpreted.mode, model: interpreted.model,
    freshAnonymousSession: true, fixturesExcluded: true, unrelatedGameExcluded: true, buyerBrief, interpretation: interpreted.brief,
    editedBudgetDollars: 15, inspectDigest: inspect.digest, studioInPublicCatalog: Boolean(studio),
    evidence: 'ev-' + inspect.digest.slice(0, 12) + '-csv-validation',
    downloads: { inspectChecksumMatches: true, studioSourceServedAsStaticAsset: false },
  }, null, 2) + '\n');
  console.log('Hosted Column Desk test passed. Studio in public catalog: ' + Boolean(studio));
} finally {
  await context.close();
  if (record) console.log('Raw browser recording: ' + await page.video()?.path());
  await browser.close();
}
