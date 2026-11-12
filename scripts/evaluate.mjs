import { readFile, writeFile } from 'node:fs/promises';

const local = 'http://127.0.0.1:8788';
const host = new URL(process.argv[2] ?? local).origin;
const briefs = JSON.parse(await readFile('docs/evidence/briefs.json', 'utf8'));
async function request(base, path, body) {
  const result = await fetch(base + '/api' + path, body === undefined ? {} : {
    method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(100000),
  });
  if (!result.ok) throw new Error(path + ' returned HTTP ' + result.status + ' for ' + base);
  return result.json();
}
const fingerprint = items => items.releases.map(item => [item.id,item.digest,item.amount]).sort().map(item => item.join(':')).join('|');
const [localCatalog, modelCatalog] = await Promise.all([request(local, '/catalog'), request(host, '/catalog')]);
if (fingerprint(localCatalog) !== fingerprint(modelCatalog)) throw new Error('Baseline and model catalogs must match exactly.');
const rows = [];
for (const item of briefs) {
  const [baseline, hybrid] = await Promise.all([request(local, '/search', { query: item.query, baseline: true }),
    request(host, '/search', { query: item.query })]);
  const summarize = response => {
    const citations = response.results.flatMap(row => row.evidence.filter(evidence => evidence.evidenceId).map(evidence => ({
      release: row.item.id, evidenceId: evidence.evidenceId, correct: row.item.report?.findings.some(finding =>
        finding.id === evidence.evidenceId && finding.capability === evidence.key &&
        (evidence.state === 'unknown' ? ['untested','inconclusive'].includes(finding.status) :
          (finding.status === 'pass') === (evidence.expected === (evidence.state === 'match')))),
    })));
    return { mode: response.mode, model: response.model, retrieval: response.retrieval, brief: response.brief,
      rank: response.results.map(row => row.item.id), matches: response.results.filter(row => row.status === 'match').map(row => row.item.id), citations };
  };
  rows.push({ ...item, baseline: summarize(baseline), hybrid: summarize(hybrid) });
  console.log(rows.length + '/' + briefs.length + ' ' + item.focus + ' · ' + hybrid.mode + ' / ' + hybrid.retrieval);
}
function metrics(method) {
  const positive = rows.filter(row => row.qualified.length);
  const negative = rows.filter(row => !row.qualified.length);
  const recommended = rows.flatMap(row => row[method].matches.map(id => row.qualified.includes(id)));
  const citations = rows.flatMap(row => row[method].citations);
  return {
    top3Hit: positive.filter(row => row.qualified.some(id => row[method].rank.slice(0,3).includes(id))).length,
    positiveBriefs: positive.length, abstained: negative.filter(row => !row[method].matches.length).length,
    negativeBriefs: negative.length, hardConstraintErrors: recommended.filter(value => !value).length, qualifiedRecommendations: recommended.length,
    correctCitations: citations.filter(item => item.correct).length, citations: citations.length,
    modelParses: rows.filter(row => row[method].mode === 'model').length,
    semanticSearches: rows.filter(row => row[method].retrieval === 'hybrid').length,
  };
}
const result = { date: new Date().toISOString(), modelOrigin: host, catalogSize: modelCatalog.releases.length,
  labelSource: 'Developer-authored expectations; independent human review pending',
  baseline: metrics('baseline'), hybrid: metrics('hybrid'), rows };
await writeFile('docs/evidence/brief-evaluation.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ catalogSize: result.catalogSize, baseline: result.baseline, hybrid: result.hybrid }, null, 2));
