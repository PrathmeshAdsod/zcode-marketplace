import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:8788').origin;
const target = resolve('docs/evidence/zcode-preview.mp4');
const temp = await mkdtemp(join(tmpdir(), 'zcode-preview-'));
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(45000);
let frame = 0;
async function annotate() {
  await page.evaluate(() => {
    const label = document.createElement('div');
    label.textContent = 'Zcode public sample walkthrough';
    Object.assign(label.style, { position: 'fixed', bottom: 0, insetInline: 0, zIndex: 1000, pointerEvents: 'none',
      padding: '6px 18px', background: '#183327', color: 'white', font: '14px system-ui,sans-serif' });
    document.body.append(label);
  });
}
async function capture(count) {
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await page.screenshot({ path: join(temp, String(frame++).padStart(4, '0') + '.png') });
    const delay = 100 - (performance.now() - start);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
}
try {
  await mkdir('docs/evidence', { recursive: true });
  await page.goto(origin);
  await page.locator('#landing-title').waitFor();
  await annotate();
  await capture(30);
  await page.getByRole('navigation', { name: 'Explore Zcode' }).getByRole('link', { name: 'Browse releases' }).click();
  const search = page.getByRole('textbox', { name: 'Search marketplace' });
  await search.pressSequentially('Offline browser game under $60', { delay: 38 });
  await capture(14);
  await search.press('Enter');
  await page.getByRole('button', { name: 'Use keyword rules', exact: true }).click();
  await page.getByRole('button', { name: 'Find matching releases', exact: true }).click();
  await page.getByText('Full match', { exact: true }).first().waitFor();
  await capture(42);
  await page.getByRole('link', { name: 'View finding', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Repo Passport' }).waitFor();
  await page.getByText('Completed setup and gameplay with container networking disabled.').scrollIntoViewIfNeeded();
  await capture(40);
  await page.getByRole('link', { name: 'Download sample ZIP' }).scrollIntoViewIfNeeded();
  await capture(35);
  await page.goto(origin + '/samples/acorn/index.html');
  await page.getByRole('button', { name: 'Begin trail' }).waitFor();
  await annotate();
  await capture(20);
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowRight');
  await capture(37);
  await page.keyboard.up('ArrowRight');
  await page.getByText('Trail complete · 3 acorns delivered').waitFor();
  await capture(28);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '10', '-i', join(temp, '%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', target], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  console.log('Recorded ' + (frame / 10).toFixed(1) + ' seconds of the working public sample.');
} finally {
  await browser.close();
  await rm(temp, { recursive: true, force: true });
}
