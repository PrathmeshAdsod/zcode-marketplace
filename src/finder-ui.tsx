import { useState } from 'react';
import { ArrowRight, Check, CircleHelp, SlidersHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, message } from './api';
import { capabilities, categories, dollars, LICENSE_VERSION, type Capability, type Release } from './domain';
import type { EvidenceState, FinderBrief, FinderEvidence, FinderResult, Requirement } from './finder-contract';

type Interpretation = { brief: FinderBrief; mode: 'gemini' | 'cache' | 'literal'; model: string | null };
type Matches = { results: FinderResult[]; conflict: boolean };
const states: Record<EvidenceState, string> = {
  verified: 'Verified', contradicted: 'Contradicted', 'seller-claimed': 'Seller claimed', 'not-tested': 'Not tested',
};
const label = (entry: Requirement) => entry.kind === 'capability' ? capabilities[entry.key] :
  entry.kind === 'recurring-budget' ? dollars(entry.value) + ' per month' : entry.value;

export function checkoutPath(item: Release) {
  return '/checkout/' + encodeURIComponent(item.id) + '?' + new URLSearchParams({
    digest: item.digest ?? '', price: String(item.amount), license: LICENSE_VERSION,
  });
}

export function FinderFlow({ query, onResults }: { query: string; onResults: (result: Matches | null) => void }) {
  const [parsed, setParsed] = useState<Interpretation | null>(null);
  const [draft, setDraft] = useState<FinderBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  function edit(value: FinderBrief) {
    setDraft(value);
    setConflict(false);
    onResults(null);
  }
  async function interpret(allowGemini: boolean) {
    setBusy(true); setError(''); setParsed(null); setDraft(null); onResults(null);
    try {
      const result = await api<Interpretation>('/finder/interpret', 'POST', { query, allowGemini });
      setParsed(result); setDraft(result.brief);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function find() {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const matches = await api<Matches>('/finder/match', 'POST', { query, brief: draft });
      setConflict(matches.conflict);
      onResults(matches);
      try {
        sessionStorage.setItem('zcode-finder-checks', JSON.stringify(matches.results.map(({ item, status, evidence }) =>
          ({ id: item.id, digest: item.digest, status, evidence }))));
      } catch { /* comparison remains usable without session storage */ }
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  function change(index: number, next: Requirement) {
    if (draft) edit({ ...draft, requirements: draft.requirements.map((value, i) => i === index ? next : value) });
  }
  return <section className="requirements finder-panel" aria-labelledby="finder-review">
    <div className="section-head">
      <div><h2 id="finder-review">{draft ? 'Review your requirements' : 'Turn your brief into requirements'}</h2>
        <p>{parsed?.mode === 'gemini' ? 'Interpreted by Gemini 3.5 Flash-Lite' : parsed?.mode === 'cache' ? 'Saved Gemini 3.5 Flash-Lite interpretation' :
          parsed ? 'Interpreted by keyword rules' : 'Check the requirements before Zcode recommends a release.'}</p></div>
      {!draft && <SlidersHorizontal size={20}/>}
    </div>
    {!draft ? <>
      <p className="muted">Gemini receives this brief. Use keyword rules if it contains private or personal information.</p>
      <div className="button-row">
        <button className="button primary" disabled={busy} onClick={() => void interpret(true)}>Interpret with Gemini <ArrowRight size={16}/></button>
        <button className="button secondary" disabled={busy} onClick={() => void interpret(false)}>Use keyword rules</button>
      </div>
    </> : <form onSubmit={event => { event.preventDefault(); void find(); }}>
      {!draft.requirements.length && <p className="muted">Add a requirement if you have a deal breaker or preference.</p>}
      <div className="finder-requirements">
        {draft.requirements.map((item, i) => <div className="finder-requirement" key={i}>
          <div><strong>{item.expected ? '' : 'Exclude '}{label(item)}</strong>{item.quote && <q>{item.quote}</q>}</div>
          <select aria-label={'Priority for ' + label(item)} value={item.priority} onChange={event => change(i, { ...item, priority: event.target.value as Requirement['priority'] })}>
            <option value="must">Must have</option><option value="prefer">Nice to have</option>
          </select>
          {item.kind !== 'recurring-budget' && <button type="button" className="text-button" onClick={() => change(i, { ...item, expected: !item.expected })}>{item.expected ? 'Exclude' : 'Include'}</button>}
          <button type="button" className="text-button" aria-label={'Remove ' + label(item)} onClick={() => edit({ ...draft, requirements: draft.requirements.filter((_, index) => i !== index) })}>Remove</button>
        </div>)}
      </div>
      <div className="requirements-editor">
        <label>Add capability<select value="" disabled={draft.requirements.length >= 12} onChange={event => edit({ ...draft, requirements: [...draft.requirements,
          { kind: 'capability', key: event.target.value as Capability, expected: true, priority: 'must', quote: '' }] })}>
          <option value="" disabled>Select capability</option>{Object.entries(capabilities).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>Upfront budget in USD<input type="number" min="0" max="100000" step=".01" value={draft.budget ? draft.budget.cents / 100 : ''}
          onChange={event => edit({ ...draft, budget: event.target.value ? { cents: Math.round(Number(event.target.value) * 100), inclusive: draft.budget?.inclusive ?? true, quote: draft.budget?.quote ?? '' } : null })}/></label>
        {draft.budget && <label>Budget limit<select value={String(draft.budget.inclusive)}
          onChange={event => edit({ ...draft, budget: { ...draft.budget!, inclusive: event.target.value === 'true' } })}><option value="true">At most</option><option value="false">Strictly below</option></select></label>}
        <label>Category<select value={draft.category?.value ?? ''} onChange={event => edit({ ...draft, category: event.target.value ?
          { value: event.target.value as typeof categories[number], quote: draft.category?.quote ?? '' } : null })}><option value="">Any category</option>
          {categories.map(category => <option key={category}>{category}</option>)}</select></label>
      </div>
      {(draft.budget?.quote || draft.category?.quote) && <p className="finder-quotes">{draft.budget?.quote && <>Budget <q>{draft.budget.quote}</q></>}{draft.category?.quote && <> Category <q>{draft.category.quote}</q></>}</p>}
      {draft.ambiguities.map(({ reason, quote }, i) => <div className="notice warning finder-clarification" key={i}>
        <span><strong>{reason}</strong>{quote && <q>{quote}</q>}</span>
        <button type="button" className="text-button" onClick={() => edit({ ...draft, ambiguities: draft.ambiguities.filter((_, index) => i !== index) })}>Mark resolved</button>
      </div>)}
      {conflict && <p className="notice warning">Two mandatory requirements conflict. Remove or change one to find a full match.</p>}
      <div className="button-row">
        <button className="button primary" disabled={busy}>Find matching releases <ArrowRight size={16}/></button>
        <button type="button" className="text-button" disabled={busy} onClick={() => { setDraft(null); setParsed(null); onResults(null); }}>Start over</button>
      </div>
    </form>}
    {busy && <p role="status" className="muted">{draft ? 'Checking release evidence…' : 'Reading your brief…'}</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </section>;
}

export function ResultEvidence({ item, status, evidence }: FinderResult) {
  return <div className="result-evidence">
    <strong className={'tag ' + (status === 'near' ? 'neutral' : '')}>{status === 'match' ? 'Full match' : item.fixture ? 'Example listing' : 'Near match'}</strong>
    {evidence.map((check, i) => <div className="finder-evidence-row" key={i}>
      {check.state === 'verified' ? <Check size={15}/> : <CircleHelp size={15}/>}
      <div><strong>{check.label}</strong><span>{check.priority === 'prefer' && 'Preference · '}{states[check.state]}
        {check.evidenceId && <> · <Link to={'/release/' + item.id + '#' + check.evidenceId}>View finding</Link></>}</span>
        <p>{check.observation}</p>
      </div>
    </div>)}
    {item.purchasable && <Link className="button secondary full" to={checkoutPath(item)}>Review license and checkout <ArrowRight size={16}/></Link>}
  </div>;
}

export function comparisonEvidence(item: Release): FinderResult | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem('zcode-finder-checks') ?? '[]') as (Omit<FinderResult, 'item'> & { id: string; digest: string | null })[];
    const match = stored.find(entry => entry.id === item.id && entry.digest === item.digest);
    if (!match || !Array.isArray(match.evidence)) return null;
    const evidence: FinderEvidence[] = match.evidence.filter(check => !check.evidenceId ||
      (item.report?.digest === item.digest && item.report?.findings.some(finding => finding.id === check.evidenceId && finding.capability === check.key)));
    return evidence.length === match.evidence.length ? { ...match, evidence, item } : null;
  } catch { return null; }
}
