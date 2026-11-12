import { readFile, writeFile } from 'node:fs/promises';

const origin = new URL(process.argv[2] || 'https://zcode-marketplace.pages.dev').origin;
const phase = process.argv[3];
if (!['legacy', 'finder', 'keyword'].includes(phase)) throw new Error('Pass legacy, finder or keyword.');
const labels = JSON.parse(await readFile('docs/evidence/finder-briefs.json', 'utf8'));
const cohort = new Set(['acorn-trail', 'example-orbit', 'example-fieldnotes']);
async function request(path, data) {
  const response = await fetch(origin + '/api' + path, data ? {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(data), signal: AbortSignal.timeout(25000),
  } : { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(path + ' returned HTTP ' + response.status);
  return response.json();
}
const catalog = (await request('/catalog')).releases.filter(item => cohort.has(item.id));
const signature = catalog.map(({ id, version, digest, amount }) => [id, version, digest, amount].join(':')).sort();
const evidenceFile = 'docs/evidence/finder-' + phase + '-results.json';
const resume = process.argv.includes('--resume') ? JSON.parse(await readFile(evidenceFile, 'utf8')) : null;
const previous = phase !== 'legacy' ? JSON.parse(await readFile('docs/evidence/finder-legacy-results.json', 'utf8')) : null;
if (previous && JSON.stringify(previous.catalog) !== JSON.stringify(signature)) throw new Error('Evaluation cohort changed.');
if (resume && JSON.stringify(resume.catalog) !== JSON.stringify(signature)) throw new Error('The saved cohort changed.');
const key = row => ((row.kind === 'capability' || !row.kind ? row.key : row.kind + ':' + row.value) + ':' + (row.expected ? '+' : '-')).toLowerCase();
const exact = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
function summarize(label, brief, response, source) {
  const results = response.results.filter(row => cohort.has(row.item.id));
  const checks = results.flatMap(row => row.evidence.filter(check => check.evidenceId).map(check => {
    const finding = row.item.report?.findings.find(finding => finding.id === check.evidenceId);
    return { release: row.item.id, id: check.evidenceId, valid: Boolean(finding && finding.capability === check.key && row.item.report.digest === row.item.digest) };
  }));
  const hard = (brief.requirements?.filter(row => row.priority === 'must') ?? brief.hard).map(key);
  const soft = (brief.requirements?.filter(row => row.priority === 'prefer') ?? brief.preferences).map(key);
  const maxCents = brief.budget ? brief.budget.cents - Number(!brief.budget.inclusive) : brief.maxCents ?? null;
  const clarify = Boolean(response.conflict || brief.ambiguities?.length);
  const matches = results.filter(row => row.status === 'match').map(row => row.item.id);
  const rank = results.map(row => row.item.id);
  return {
    source, hard, soft, maxCents, clarify, matches, rank, checks,
    extractionExact: exact(hard, label.hard) && exact(soft, label.soft) && maxCents === label.maxCents && clarify === label.clarify,
    qualificationExact: exact(matches, label.qualified),
    falseQualified: matches.filter(id => !label.qualified.includes(id)),
    top3Qualified: label.qualified.length ? rank.slice(0, 3).some(id => label.qualified.includes(id)) : null,
    top1Qualified: label.qualified.length ? label.qualified.includes(rank[0]) : null,
  };
}
const rows = [];
for (const label of labels) {
  const completed = resume?.rows.find(row => row.id === label.id && !row.error && (phase !== 'finder' || row.mode === 'gemini'));
  if (completed) { rows.push(completed); continue; }
  try {
    if (phase === 'legacy') {
      const response = await request('/search', { query: label.query });
      rows.push({ id: label.id, ...summarize(label, response.brief, response, response.model ?? response.mode) });
    } else {
      const parsed = await request('/finder/interpret', { query: label.query, allowGemini: phase === 'finder' });
      const response = await request('/finder/match', { query: label.query, brief: parsed.brief });
      rows.push({ id: label.id, mode: parsed.mode, ...summarize(label, parsed.brief, response, parsed.model ?? parsed.mode),
        literalQuotes: [...parsed.brief.requirements, ...parsed.brief.ambiguities, ...[parsed.brief.budget, parsed.brief.category].filter(Boolean)]
          .every(row => row.quote && label.query.includes(row.quote)) });
      if (phase === 'finder') await new Promise(resolve => setTimeout(resolve, 6100));
    }
  } catch (error) { rows.push({ id: label.id, error: error.message }); }
  console.log(phase, label.id, rows.at(-1).source ?? rows.at(-1).error);
}
const totals = {
  briefs: rows.length, completed: rows.filter(row => !row.error).length,
  extractionExact: rows.filter(row => row.extractionExact).length,
  qualificationExact: rows.filter(row => row.qualificationExact).length,
  falseQualified: rows.reduce((n, row) => n + (row.falseQualified?.length ?? 0), 0),
  top3Qualified: rows.filter(row => row.top3Qualified === true).length,
  top1Qualified: rows.filter(row => row.top1Qualified === true).length,
  liveGemini: rows.filter(row => row.mode === 'gemini').length,
  positiveBriefs: labels.filter(row => row.qualified.length).length,
  validCitations: rows.flatMap(row => row.checks ?? []).filter(check => check.valid).length,
  citations: rows.flatMap(row => row.checks ?? []).length,
  sources: [...new Set(rows.map(row => row.source).filter(Boolean))],
};
await writeFile(evidenceFile, JSON.stringify({ date: new Date().toISOString(), catalog: signature, totals, rows }, null, 2) + '\n');
console.log(totals);
