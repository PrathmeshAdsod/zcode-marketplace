import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardCheck, FolderGit2, GitBranch, PackagePlus, ShieldCheck } from 'lucide-react';
import { api, message, useRemote } from './api';
import { blankDraft, categories, type Draft, type Report } from './domain';
import { RequireAccount } from './main';
import { LoadState, Passport, Video } from './market';

type Listing = { id: string; revision: number; draft: Draft; status: string | null; slot: number | null; report: Report | null; reason: string | null; active_release: string | null };
type RepoData = { configured: boolean; repositories: { repo_id: number; full_name: string }[] };
const stateLabel: Record<string, string> = { queued: 'Verification queued', review: 'In editorial review', changes: 'Changes requested', published: 'Published', rejected: 'Declined', archived: 'Archived', held: 'On hold' };
export function Studio() {
  return <><div className="page-head"><div className="eyebrow"><FolderGit2 size={17}/> Seller workspace</div><h1>Seller studio</h1><p>Submit a private release with a product walkthrough and a clean install recording.</p></div><RequireAccount><SellerContents/></RequireAccount></>;
}
function SellerContents() {
  const listings = useRemote<{ listings: Listing[] }>('/seller/listings');
  const repos = useRemote<RepoData>('/github/repositories');
  const [selected, select] = useState<Listing | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [feedback, setFeedback] = useState('');
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  function start(item: Listing | null) {
    select(item); setDraft(item?.draft ?? { ...blankDraft }); setFeedback(''); setFailure(false);
  }
  async function perform(mode: 'save'|'submit'|'archive', event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setFeedback(''); setFailure(false);
    try {
      if (mode === 'archive') {
        if (selected) await api('/seller/listings/' + selected.id + '/archive', 'POST', {});
        start(null); setFeedback('Listing archived. Existing receipts retain their release.');
      } else {
        let record = selected;
        if (!record) {
          const created = await api<{ id: string; revision: number }>('/seller/listings', 'POST', draft);
          record = { ...created, draft, slot: null, status: null, report: null, reason: null, active_release: null };
        } else if (JSON.stringify(draft) !== JSON.stringify(record.draft)) {
          const changed = await api<{ revision: number }>('/seller/listings/' + record.id, 'PATCH', { ...draft, revision: record.revision });
          record = { ...record, ...changed, draft };
        }
        select(record);
        if (mode === 'submit') {
          const submitted = await api<{ status: string }>('/seller/listings/' + record.id + '/submit', 'POST', {});
          select({ ...record, status: submitted.status });
          setFeedback(submitted.status === 'queued' ? 'Release submitted for verification.' :
            'This revision is already marked “' + (stateLabel[submitted.status] || submitted.status) + '”. Edit the draft to submit a new revision.');
        } else {
          setFeedback('Draft saved.');
        }
      }
    } catch (error) { setFeedback(message(error)); setFailure(true); }
    finally { setBusy(false); listings.refresh(); }
  }
  function field(label: string, key: keyof Draft, multiline = false, placeholder?: string) {
    return <label>{label}{multiline ?
      <textarea rows={3} value={String(draft[key])} onChange={event => setDraft({ ...draft, [key]: event.target.value })} placeholder={placeholder}/> :
      <input value={String(draft[key])} onChange={event => setDraft({ ...draft, [key]: event.target.value })} placeholder={placeholder}/>}</label>;
  }
  const occupied = listings.data?.listings.filter(item => item.slot).length ?? 0;
  return <div className="studio-layout">
    <aside className="stack">
      <section className="panel"><div className="section-head"><h2>Your listings</h2><span className="tag">{occupied} / 5 slots</span></div>
        <button className="button secondary full" onClick={() => start(null)}><PackagePlus size={17}/> New draft</button>
        {!listings.data && <LoadState error={listings.error} retry={listings.refresh}/>}
        <div className="listing-list">{listings.data?.listings.map(item => <button className={'listing-entry ' + (selected?.id === item.id ? 'selected' : '')} key={item.id} onClick={() => start(item)}>
          <strong>{item.draft.title || 'Untitled draft'}</strong><span>{item.status ? stateLabel[item.status] : 'Draft'} · r{item.revision}</span></button>)}</div>
      </section>
      <section className="panel"><h2><GitBranch size={20}/> GitHub source</h2><p>Install the marketplace GitHub App on a personal account. Choose <strong>Only select repositories</strong> and select the private source you own.</p>
        {repos.data?.configured ? <><a className="button secondary full" href="/api/github/install/start">Connect repositories <ArrowRight size={16}/></a><a className="button secondary full" href="/api/github/install/refresh">Refresh selected repositories</a></> :
          <p className="notice">GitHub App setup is required before a release can be submitted.</p>}
        {!!repos.data?.repositories.length && <p>{repos.data.repositories.length} private {repos.data.repositories.length === 1 ? 'repository' : 'repositories'} connected.</p>}
      </section>
    </aside>
    <div className="stack">
      <form className="panel form-grid" onSubmit={event => void perform('save', event)}>
        <div className="section-head"><div><h2>{selected ? 'Edit listing' : 'New listing'}</h2><p>Drafts do not use a slot until submitted.</p></div>{selected?.status && <span className="tag neutral">{stateLabel[selected.status]}</span>}</div>
        {selected?.reason && <p className="notice warning">{selected.reason}</p>}
        {selected?.active_release && <Link className="text-link" to={'/release/' + selected.active_release}>View published release <ArrowRight size={15}/></Link>}
        <div className="form-columns">{field('Title', 'title')}{field('Version', 'version')}{field('Stack', 'stack')}{field('Price in USD', 'price', false, '29.00')}</div>
        {field('One-line summary', 'summary')}{field('Description', 'description', true)}
        <div className="form-columns">
          <label>Primary category<select value={draft.categories[0] ?? ''} onChange={event => setDraft({ ...draft, categories: event.target.value ? [event.target.value as Draft['categories'][number], ...draft.categories.slice(1).filter(item => item !== event.target.value)] : [] })}>
            <option value="">Select a category</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
          <fieldset><legend>Secondary categories · up to two</legend>{categories.filter(item => item !== draft.categories[0]).map(item => <label className="check compact" key={item}><input type="checkbox" checked={draft.categories.includes(item)} disabled={!draft.categories[0] || (!draft.categories.includes(item) && draft.categories.length >= 3)}
            onChange={event => setDraft({ ...draft, categories: event.target.checked ? [...draft.categories,item] : draft.categories.filter(value => value !== item) })}/>{item}</label>)}</fieldset>
        </div>
        <div className="form-columns">
          <label>Private repository<select value={draft.repoId} onChange={event => setDraft({ ...draft, repoId: Number(event.target.value) })}><option value={0}>Select a repository</option>{repos.data?.repositories.map(repo => <option key={repo.repo_id} value={repo.repo_id}>{repo.full_name}</option>)}</select></label>
          {field('Branch, tag or commit', 'ref')}
          {field('Product walkthrough URL', 'productVideo', false, 'YouTube, Vimeo or HTTPS video')}
          {field('Clean install video URL', 'setupVideo', false, 'A distinct walkthrough')}
          {field('Product walkthrough transcript', 'productTranscript', true)}
          {field('Clean install transcript', 'setupTranscript', true)}
        </div>
        {field('Preview image URL', 'cover', false, 'HTTPS PNG, JPG or WebP')}
        <div className="form-columns">
          {field('Setup instructions', 'setup', true)}{field('Required and optional costs', 'costs', true)}
          {field('Third-party notices', 'notices', true)}{field('Support and remedy terms', 'support', true)}
        </div>
        <label className="check"><input type="checkbox" checked={draft.rights} onChange={event => setDraft({ ...draft, rights: event.target.checked })}/> I have the right to distribute this source, its assets and both recordings.</label>
        <div className="button-row"><button className="button secondary" disabled={busy}>Save draft</button><button className="button primary" type="button" disabled={busy} onClick={() => void perform('submit')}>Submit for verification <ArrowRight size={16}/></button>
          {selected?.slot && <button className="text-button" type="button" disabled={busy} onClick={() => void perform('archive')}>Archive listing</button>}</div>
        {feedback && <p className={'notice ' + (failure ? 'error' : '')} role={failure ? 'alert' : 'status'}>{feedback}</p>}
      </form>
      {selected?.report && <Passport report={selected.report}/>}
    </div>
  </div>;
}
type Review = { id: string; seller: string; commit: string; draft: Draft; report: Report | null };
type Case = { id: string; purchase_id: string | null; release_id: string | null; release_status: string | null; message: string; resolution: string | null };
export function ReviewDesk() {
  return <><div className="page-head"><div className="eyebrow"><ShieldCheck size={17}/> Editorial workspace</div><h1>Review desk</h1><p>Check the two recordings, distribution terms and evidence before publication.</p></div><RequireAccount reviewer><ReviewContents/></RequireAccount></>;
}
function ReviewContents() {
  const review = useRemote<{ releases: Review[] }>('/reviews');
  const support = useRemote<{ cases: Case[] }>('/support/desk');
  return <div className="stack">
    {!review.data && <LoadState error={review.error} retry={review.refresh}/>}
    {review.data?.releases.length === 0 && <section className="empty"><h2>No releases awaiting review</h2><p>Completed verification jobs will appear here.</p></section>}
    {review.data?.releases.map(item => <ReviewCard key={item.id} item={item} refresh={review.refresh}/>)}
    <section className="panel"><h2>Support cases</h2>
      {!support.data && <LoadState error={support.error} retry={support.refresh}/>}
      {support.data?.cases.length === 0 && <p className="muted">No open cases.</p>}
      {support.data?.cases.map(item => <SupportCard key={item.id} item={item} refresh={support.refresh}/>)}
    </section>
  </div>;
}
function ReviewCard({ item, refresh }: { item: Review; refresh: () => void }) {
  const [reason, setReason] = useState('');
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(decision: string) {
    setBusy(true); setError('');
    try { await api('/reviews/' + item.id, 'POST', { decision, reason, mediaReviewed: watched }); refresh(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <article className="panel stack"><div><h2>{item.draft.title}</h2><p>{item.seller} · {item.draft.version}</p><code className="digest">{item.commit}</code></div>
    <p>{item.draft.description}</p><p>{item.draft.notices}</p>
    <div className="video-grid"><Video src={item.draft.productVideo} title="Product recording" transcript={item.draft.productTranscript}/><Video src={item.draft.setupVideo} title="Installation recording" transcript={item.draft.setupTranscript}/></div>
    <Passport report={item.report}/>
    <label className="check"><input type="checkbox" checked={watched} onChange={event => setWatched(event.target.checked)}/> I reviewed both recordings for the exact release.</label>
    <label>Decision rationale<textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={1000}/></label>
    <div className="button-row"><button className="button primary" disabled={busy || !watched || reason.trim().length < 8 || !item.report?.corePassed} onClick={() => void decide('published')}><ClipboardCheck size={17}/> Publish</button>
      <button className="button secondary" disabled={busy || reason.trim().length < 8} onClick={() => void decide('changes')}>Request changes</button>
      <button className="button secondary" disabled={busy || reason.trim().length < 8} onClick={() => void decide('rejected')}>Decline</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
  </article>;
}
function SupportCard({ item, refresh }: { item: Case; refresh: () => void }) {
  const [resolution, setResolution] = useState(item.resolution ?? '');
  const [error, setError] = useState('');
  return <form className="form-grid support-case" onSubmit={event => {
    event.preventDefault();
    void api('/support/desk/' + item.id, 'POST', { resolution }).then(refresh).catch(err => setError(message(err)));
  }}>
    <div><strong>Case {item.id}</strong><p>{item.message}</p>{item.purchase_id && <p className="muted">Receipt {item.purchase_id}</p>}</div>
    <label>Resolution<textarea rows={2} required minLength={8} value={resolution} onChange={event => setResolution(event.target.value)}/></label>
    <div className="button-row"><button className="button secondary">Record resolution</button>
      {item.release_status && ['published','archived','held'].includes(item.release_status) &&
        <button type="button" className="button secondary" disabled={resolution.trim().length < 8} onClick={() =>
          void api('/support/desk/' + item.id + '/hold', 'POST', { action: item.release_status === 'held' ? 'lift' : 'hold', reason: resolution }).then(refresh).catch(err => setError(message(err)))}>
          {item.release_status === 'held' ? 'Lift release hold' : 'Hold checkout and downloads'}
        </button>}</div>{error && <p role="alert">{error}</p>}
  </form>;
}
