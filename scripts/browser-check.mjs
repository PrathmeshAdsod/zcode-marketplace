import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:8788').origin;
const local = origin.startsWith('http://127.0.0.1');
const output = 'docs/evidence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const release = JSON.parse(await readFile('src/catalog-samples.json', 'utf8'))[0];
const results = [];
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await desktop.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(origin);
  await page.locator('#landing-title').waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.screenshot({ path: output + '/storefront.png', animations: 'disabled' });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Skip to content');
  results.push('Desktop storefront and keyboard skip link');

  const browseLink = page.getByRole('navigation', { name: 'Explore Zcode' }).getByRole('link', { name: 'Browse releases' });
  const landingLink = page.getByRole('link', { name: 'See a tested release' });
  await browseLink.hover();
  await page.locator('.magnetic-cursor[data-stick] span').waitFor({ state: 'visible' });
  assert.equal(await landingLink.getAttribute('href'), '/release/acorn-trail');
  await browseLink.click();
  const search = page.getByRole('textbox', { name: 'Search marketplace' });
  await search.fill('Offline browser game under $60');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Use keyword rules', exact: true }).click();
  await page.getByRole('button', { name: 'Find matching releases', exact: true }).click();
  const acorn = page.locator('.result-item').filter({ has: page.getByRole('link', { name: 'View Acorn Trail' }) });
  const orbit = page.locator('.result-item').filter({ has: page.getByRole('link', { name: 'View Orbit Rooms' }) });
  await acorn.getByText('Full match', { exact: true }).waitFor();
  await orbit.locator('.result-evidence').getByText('Example listing', { exact: true }).waitFor();
  await page.screenshot({ path: output + '/buyer-brief.png' });
  await acorn.getByRole('link', { name: 'View finding', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Repo Passport' }).waitFor();
  const finding = new URL(page.url()).hash;
  assert.ok(finding.startsWith('#ev-'));
  await page.reload();
  await page.locator(finding).waitFor();
  await page.locator(finding).scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + '/repo-passport.png' });
  results.push('Hosted-safe SPA refresh and direct link to release-specific evidence');

  for (const video of await page.locator('video').all()) {
    await video.evaluate(element => element.load());
    await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 1), { timeout: 15000 });
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download sample ZIP' }).click()]);
  const bytes = await readFile(await download.path());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), release.digest);
  results.push('Both videos load and browser download matches isolated runner checksum');

  await page.getByRole('button', { name: 'Add to comparison' }).click();
  await page.getByRole('link', { name: 'Browse software', exact: true }).click();
  await page.getByRole('button', { name: 'Compare: Orbit Rooms' }).click();
  await page.getByRole('link', { name: 'Compare (2)', exact: true }).click();
  await page.getByRole('table').waitFor();
  assert.match(await page.getByRole('row', { name: /Works without network after setup/ }).innerText(), /Verified.*Not tested/is);
  results.push('Two-release comparison distinguishes observed and unknown offline behavior');

  if (local) {
    await page.getByText('Account', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Sample seller', exact: true }).click();
    await page.getByRole('heading', { name: 'Seller studio', exact: true }).waitFor();
    const draftTitle = 'Browser verification draft ' + Date.now();
    await page.getByLabel('Title', { exact: true }).fill(draftTitle);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByText('Draft saved.', { exact: true }).waitFor();
    await page.getByRole('button', { name: new RegExp(draftTitle) }).waitFor();
    await page.locator('.account-menu summary').click();
    if (!await page.getByRole('button', { name: 'Sample reviewer', exact: true }).isVisible()) await page.locator('.account-menu summary').click();
    await page.getByRole('button', { name: 'Sample reviewer', exact: true }).click();
    await page.getByRole('heading', { name: 'Review desk', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Support cases', exact: true }).waitFor();
    if (!await page.getByRole('button', { name: 'Sample buyer', exact: true }).isVisible()) await page.locator('.account-menu summary').click();
    await page.getByRole('button', { name: 'Sample buyer', exact: true }).click();
    await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Review desk', exact: true }).count(), 0);
    results.push('Distinct local seller, reviewer and buyer sessions; persisted seller draft; role-separated navigation');
    await page.goto(origin + '/admin/usage');
    await page.getByRole('heading', { name: 'Administrator access required' }).waitFor();
    await page.locator('.account-menu summary').click();
    await page.getByRole('button', { name: 'Sample administrator', exact: true }).click();
    await page.getByRole('heading', { name: 'Service status' }).waitFor();
    const ai = page.locator('.cost-operation').filter({ has: page.getByRole('heading', { name: 'AI inference' }) });
    await ai.getByLabel('Reason').fill('Browser verification of administrator pause');
    await ai.getByRole('button', { name: 'Pause', exact: true }).click();
    await ai.getByRole('button', { name: 'Clear manual pause' }).waitFor();
    await ai.getByLabel('Reason').fill('Browser verification of administrator recovery');
    await ai.getByRole('button', { name: 'Clear manual pause' }).click();
    await ai.getByText('Available', { exact: true }).waitFor();
    results.push('Usage dashboard denies buyers and records administrator pause and recovery');
  } else {
    await page.goto(origin + '/checkout/acorn-trail');
    await page.getByText('Checkout is currently unavailable for this release.', { exact: true }).waitFor();
    assert.equal(await page.locator('paypal-button').count(), 0);
    results.push('Hosted sample checkout has no payment control');
  }
  await desktop.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const phone = await mobile.newPage();
  for (const [path, heading] of [['/', /Find it.*Check it.*Run it/], ['/release/acorn-trail', 'Acorn Trail'], ['/browse', 'All software']]) {
    await phone.goto(origin + path);
    await phone.getByRole('heading', { name: heading, level: 1, exact: true }).waitFor();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Page overflows at ' + path);
    if (path === '/') await phone.screenshot({ path: output + '/mobile.png', animations: 'disabled' });
  }
  results.push('390px mobile viewport has no page overflow on home, release and browse');
  await mobile.close();
  const name = local ? 'browser-local.json' : 'browser-hosted.json';
  await writeFile(output + '/' + name, JSON.stringify({ origin, chrome: browser.version(), date: new Date().toISOString(), results }, null, 2) + '\n');
  console.log(results.join('\n'));
} finally {
  await browser.close();
}
