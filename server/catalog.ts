import { blankDraft, categories, cents, type Draft, type Release, type Report } from '../src/domain';
import sampleData from '../src/catalog-samples.json';
import { assert, str, type Env } from './common';

export const samples = sampleData as Release[];
export type ReleaseRow = {
  id: string; listing_id: string; seller_id: string; seller: string;
  repo_id: number; installation_id: number; commit_sha: string; snapshot: string;
  status: string; digest: string | null; artifact_key: string | null; report: string | null;
};
export const releaseSelect = 'SELECT r.*,l.seller_id,a.name AS seller FROM releases r JOIN listings l ON l.id=r.listing_id JOIN accounts a ON a.id=l.seller_id';
export const paypalConfigured = (env: Env) => Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
export const paymentReady = (env: Env) => Boolean(env.ARTIFACTS && paypalConfigured(env) &&
  env.PAYPAL_MERCHANT_ID && env.PAYPAL_WEBHOOK_ID && /^\d+$/.test(env.TEAM_SELLER_GITHUB_ID ?? '') &&
  env.APP_ORIGIN && (env.OPERATOR_TOKEN?.length ?? 0) >= 32);
export const sellerEligible = (env: Env, seller: string) => paymentReady(env) && seller === env.TEAM_SELLER_GITHUB_ID;
export function publicRelease(row: ReleaseRow, env: Env): Release {
  const d = JSON.parse(row.snapshot) as Draft;
  return {
    id: row.id, seller: row.seller, title: d.title, summary: d.summary, description: d.description,
    categories: d.categories, stack: d.stack, version: d.version, amount: cents(d.price) ?? 0,
    cover: d.cover, productVideo: d.productVideo, setupVideo: d.setupVideo, productTranscript: d.productTranscript,
    setupTranscript: d.setupTranscript, setup: d.setup, costs: d.costs, support: d.support, notices: d.notices,
    digest: row.digest, report: row.report ? JSON.parse(row.report) as Report : null,
    purchasable: Boolean(row.digest && row.artifact_key && sellerEligible(env, row.seller_id)),
  };
}
export async function listCatalog(env: Env) {
  const result = await env.DB.prepare(releaseSelect + " WHERE r.status='published' AND l.active_release=r.id ORDER BY r.created_at DESC LIMIT 80").all<ReleaseRow>();
  return [...result.results.map(row => publicRelease(row, env)), ...samples];
}
export function draftFrom(input: Record<string, unknown>): Draft {
  const value = { ...blankDraft };
  for (const key of Object.keys(blankDraft) as (keyof Draft)[]) {
    if (typeof blankDraft[key] === 'string') Object.assign(value, { [key]: str(input[key], key.endsWith('Transcript') ? 2000 : key === 'description' ? 1800 : key === 'summary' ? 240 : 500) });
  }
  value.title = value.title.slice(0, 80);
  const cats = input.categories ?? [];
  assert(Array.isArray(cats) && cats.length <= 3 && new Set(cats).size === cats.length &&
    cats.every(item => categories.includes(item)), 400, 'Choose up to three distinct categories, with the primary category first.');
  value.categories = cats;
  value.repoId = Number.isSafeInteger(input.repoId) && Number(input.repoId) > 0 ? Number(input.repoId) : 0;
  value.rights = input.rights === true;
  return value;
}
export function mediaURL(input: string, kind: 'video' | 'image') {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (kind === 'image') return /\.(webp|png|jpe?g|avif)$/i.test(url.pathname) ? url.href : '';
    const youtube = ['www.youtube.com', 'youtube.com', 'youtu.be', 'www.youtube-nocookie.com'];
    if (youtube.includes(url.hostname)) {
      const id = url.searchParams.get('v') || url.pathname.split('/').pop();
      return id && /^[\w-]{11}$/.test(id) ? 'https://www.youtube-nocookie.com/embed/' + id : '';
    }
    if (['vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
      const id = url.pathname.split('/').pop();
      return id && /^\d{6,12}$/.test(id) ? 'https://player.vimeo.com/video/' + id : '';
    }
    return /\.(mp4|webm)$/i.test(url.pathname) ? url.href : '';
  } catch { return ''; }
}
export function validateSubmission(d: Draft) {
  assert(d.title && d.summary && d.description && d.stack && d.version && d.categories.length, 400,
    'Add a title, summary, description, version, stack and primary category.');
  assert(cents(d.price) !== null, 400, 'Enter a USD price from $1 to $1,000.');
  assert(d.setup && d.costs && d.notices && d.support, 400, 'Describe setup, required costs, third-party notices and support.');
  assert(d.rights, 400, 'Confirm distribution rights for the source, assets and both videos.');
  assert(d.repoId && /^[a-zA-Z0-9._/-]{1,150}$/.test(d.ref), 400, 'Choose a connected repository and a valid ref.');
  const product = mediaURL(d.productVideo, 'video');
  const setup = mediaURL(d.setupVideo, 'video');
  assert(product && setup && product.split('?')[0] !== setup.split('?')[0], 400,
    'Provide two distinct videos: a product walkthrough and a clean installation recording.');
  assert(d.productTranscript && d.setupTranscript, 400, 'Add a transcript or captions text for each recording.');
  const cover = mediaURL(d.cover, 'image');
  assert(!d.cover || cover, 400, 'Use an HTTPS JPG, PNG, WebP or AVIF preview image.');
  return { ...d, cover, productVideo: product, setupVideo: setup };
}
