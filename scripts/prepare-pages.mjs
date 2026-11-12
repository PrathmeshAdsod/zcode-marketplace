import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [project, databaseName, databaseId, bucket] = process.argv.slice(2);
const admins = process.env.ZCODE_COST_ADMIN_GITHUB_IDS?.trim();
const reviewAssignments = process.env.ZCODE_RELEASE_REVIEW_ASSIGNMENTS?.trim();
const geminiLimits = Object.fromEntries(['GEMINI_FREE_RPM', 'GEMINI_FREE_TPM', 'GEMINI_FREE_RPD']
  .flatMap(name => process.env[name] ? [[name, process.env[name]]] : []));
if (!/^[a-z0-9-]{3,58}$/.test(project || '') || !/^[a-z0-9-]+$/.test(databaseName || '') ||
  !/^[a-f0-9-]{36}$/.test(databaseId || '') || (bucket && !/^[a-z0-9-]+$/.test(bucket))) {
  throw new Error('Usage: node scripts/prepare-pages.mjs PROJECT DB_NAME DB_ID [PRIVATE_R2_BUCKET]');
}
if (admins && !/^\d+(?:,\d+)*$/.test(admins)) throw new Error('Use comma-separated numeric GitHub IDs for cost administrators.');
if (reviewAssignments && !reviewAssignments.split(',').every(entry => /^\d+:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(entry))) {
  throw new Error('Use comma-separated GitHub ID and release UUID pairs for release reviewers.');
}
if (Object.keys(geminiLimits).length && (Object.keys(geminiLimits).length !== 3 ||
  Object.values(geminiLimits).some(value => !/^\d{1,8}$/.test(value) || Number(value) < 2)))
  throw new Error('Supply all three verified Gemini project limits as positive integers.');
const directory = resolve('.local/pages');
await mkdir(join(directory, 'src'), { recursive: true });
for (const dir of ['dist', 'server', 'functions', 'migrations']) await cp(dir, join(directory, dir), { recursive: true });
for (const file of ['domain.ts','catalog-samples.json','finder-contract.ts']) await cp('src/' + file, join(directory, 'src', file));
const config = {
  name: project, pages_build_output_dir: './dist', compatibility_date: '2026-11-12',
  d1_databases: [{ binding: 'DB', database_name: databaseName, database_id: databaseId }],
  vars: {
    APP_ORIGIN: 'https://' + project + '.pages.dev',
    ...(admins ? { COST_ADMIN_GITHUB_IDS: admins } : {}),
    ...(reviewAssignments ? { RELEASE_REVIEW_ASSIGNMENTS: reviewAssignments } : {}),
    ...geminiLimits,
  },
  ...(bucket ? { r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: bucket }] } : {}),
};
await writeFile(join(directory, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
console.log('Prepared Cloudflare Pages staging at ' + directory);
