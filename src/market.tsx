import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, CircleHelp, Code2, FileCheck2, GitCompareArrows, MonitorPlay, Play, Search } from 'lucide-react';
import { useRemote } from './api';
import { capabilities, categories, dollars, LICENSE_TEXT, type Release, type Report } from './domain';
import { useApp } from './main';
import { checkoutPath, comparisonEvidence, FinderFlow, ResultEvidence } from './finder-ui';
import type { FinderResult } from './finder-contract';

export function LoadState({ error, retry }: { error?: string; retry?: () => void }) {
  return <div className={'notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>{error || 'Loading…'}
    {error && retry && <button type="button" className="text-button" onClick={retry}>Try again</button>}</div>;
}
function Artwork({ item, hero = false }: { item: Release; hero?: boolean }) {
  return <div className={'artwork artwork-' + (item.id === 'example-orbit' ? 'orbit' : item.id === 'example-fieldnotes' ? 'notes' : 'forest') + (hero ? ' hero-artwork' : '')}>
    {item.cover ? <img src={item.cover} alt={item.title + ' product preview'} loading={hero ? 'eager' : 'lazy'}/> : item.id === 'example-orbit' ?
      <div className="orbit-art" aria-hidden="true"><span className="orbit-ring"/><span className="planet one"/><span className="planet two"/><span className="planet three"/><strong>ORBIT<br/>ROOMS</strong></div> :
      item.id === 'example-fieldnotes' ? <div className="notes-art" aria-hidden="true"><div><strong>Fieldnotes</strong><span>Today’s workspace</span><i/><i/><i/><i/></div><aside><i/><i/><i/></aside></div> :
      <div className="art-fallback"><Code2 size={60}/></div>}
  </div>;
}
const exactReport = (item: Release) => item.digest && item.report?.digest === item.digest ? item.report : null;
function ItemCard({ item }: { item: Release }) {
  const { compared, compare } = useApp();
  const selected = compared.includes(item.id);
  return <article className="product-card">
    <Link to={'/release/' + item.id} className="card-art-link" aria-label={'View ' + item.title}><Artwork item={item}/></Link>
    <div className="card-body">
      <div className="card-meta"><span>{item.categories[0]} · {item.stack.split(',')[0]}</span>{item.fixture && <span className="tag neutral">Example listing</span>}{item.sample && <span className="tag">Runnable sample</span>}</div>
      <div className="card-title"><h3><Link to={'/release/' + item.id}>{item.title}</Link></h3><strong>{item.sample ? 'Free sample' : dollars(item.amount)}</strong></div>
      <p>{item.summary}</p>
      <div className="card-foot">
        <span>{item.report?.corePassed ? <><FileCheck2 size={15}/> Clean install observed</> : <><CircleHelp size={15}/> No independent tests</>}</span>
        <button type="button" className={'icon-button' + (selected ? ' selected' : '')} title={(selected ? 'Remove ' : 'Compare ') + item.title} aria-label={(selected ? 'Remove from comparison: ' : 'Compare: ') + item.title} aria-pressed={selected} disabled={!selected && compared.length === 3} onClick={() => compare(item.id)}><GitCompareArrows size={17}/></button>
      </div>
    </div>
  </article>;
}
export function Results() {
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim().slice(0, 360);
  return <CatalogResults key={query} query={query} params={params} setParams={setParams}/>;
}
function CatalogResults({ query, params, setParams }: { query: string; params: URLSearchParams; setParams: (params: URLSearchParams) => void }) {
  const category = params.get('category') ?? '';
  const [data, setData] = useState<{ results: FinderResult[]; conflict: boolean } | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('relevance');
  const browse = useRemote<{ releases: Release[] }>(query ? null : '/catalog');
  const rows: FinderResult[] = data?.results ?? browse.data?.releases.map(item => ({ item, status: 'match', evidence: [] })) ?? [];
  const results = rows.filter(({ item, status }) => (!category || item.categories.some(value => value === category)) && (filter !== 'match' || status === 'match'));
  if (sort !== 'relevance') results.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'match' ? -1 : 1;
    return (a.item.amount - b.item.amount) * (sort === 'asc' ? 1 : -1);
  });
  return <>
    <div className="page-head"><div className="eyebrow"><Search size={15}/> Browse marketplace</div>
      <h1>{query ? 'Software Finder' : category || 'All software'}</h1>{query && <p>“{query}”</p>}
    </div>
    {query && <FinderFlow query={query} onResults={setData}/>}
    {!query && !browse.data && <LoadState error={browse.error} retry={browse.refresh}/>}
    {(data || browse.data) && <>
      <div className="filters">
        <label>Category<select value={category} onChange={event => {
          const next = new URLSearchParams(params);
          if (event.target.value) next.set('category', event.target.value); else next.delete('category');
          setParams(next);
        }}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        {query && <label>Evidence<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Include near matches</option><option value="match">Full matches only</option>
        </select></label>}
        <label>Sort<select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="relevance">Relevance</option><option value="asc">Price, low to high</option><option value="desc">Price, high to low</option>
        </select></label>
        <span role="status">{results.length} {results.length === 1 ? 'release' : 'releases'}</span>
      </div>
      {data && !data.results.some(row => row.status === 'match') && <p className="notice warning">No release verifies all of your mandatory requirements. Check the evidence gaps below or revise your brief.</p>}
      {results.length ? <div className="product-grid">{results.map(result => <div className="result-item" key={result.item.id}>
        <ItemCard item={result.item}/>{query && <ResultEvidence {...result}/>}
      </div>)}</div> : <section className="empty"><h2>No releases meet these filters</h2><Link className="button secondary" to="/browse">Browse all releases</Link></section>}
    </>}
  </>;
}

export function Passport({ report }: { report: Report | null }) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash && report) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [hash, report]);
  return <section className="panel passport">
    <div className="section-head"><div><div className="eyebrow"><FileCheck2 size={15}/> Release evidence</div><h2>Repo Passport</h2></div>{report?.corePassed && <span className="tag">Core workflow observed</span>}</div>
    {!report ? <p>No independent run has been recorded for this example release.</p> : <>
      <p className="muted">{new Date(report.checkedAt).toLocaleDateString('en', { dateStyle: 'long' })} · {(report.elapsedMs / 1000).toFixed(1)} seconds · {report.adapter}</p>
      <p className="environment">{report.environment}</p>
      <div className="finding-list">{report.findings.map(finding => <article id={finding.id} key={finding.id} className="finding">
        <div><strong>{capabilities[finding.capability]}</strong><p>{finding.observation}</p><a className="evidence-id" href={'#' + finding.id}>{finding.id}</a></div>
        <span className={'tag ' + (finding.status === 'pass' ? '' : finding.status === 'fail' ? 'danger' : 'neutral')}>{finding.status}</span>
      </article>)}</div>
    </>}
  </section>;
}
export function Video({ src, title, transcript }: { src: string; title: string; transcript: string }) {
  return <article className="video-card"><h3><MonitorPlay size={18}/> {title}</h3>
    {src ? (src.includes('/embed/') || src.startsWith('https://player.vimeo.com/')) ?
      <iframe src={src} title={title} allow="fullscreen; encrypted-media" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin"/> :
      <video controls preload="metadata" aria-label={title} src={src}/> : <div className="video-empty">No recording for this example</div>}
    {transcript && <details><summary>Transcript</summary><p>{transcript}</p></details>}
  </article>;
}
export function ReleaseDetail() {
  const { id = '' } = useParams();
  const { data: item, error, refresh } = useRemote<Release>('/catalog/' + encodeURIComponent(id));
  const { compared, compare } = useApp();
  if (!item) return <LoadState error={error} retry={refresh}/>;
  const selected = compared.includes(item.id);
  return <>
    <Link className="back" to="/browse"><ArrowLeft size={16}/> Browse software</Link>
    <div className="page-head release-heading"><div className="eyebrow">{item.categories.join(' / ')} · Release {item.version}</div><h1>{item.title}</h1><p>{item.summary}</p></div>
    <div className="detail-layout">
      <div className="detail-main">
        <Artwork item={item} hero/>
        <section className="panel"><h2>About this release</h2><p>{item.description}</p><p className="muted">{item.stack}</p></section>
        <section className="video-grid" aria-label="Release recordings"><Video src={item.productVideo} title="Product walkthrough" transcript={item.productTranscript}/><Video src={item.setupVideo} title="Clean install walkthrough" transcript={item.setupTranscript}/></section>
        <Passport report={exactReport(item)}/>
      </div>
      <aside className="detail-aside">
        <section className="panel purchase-card">
          <div className="eyebrow">{item.sample ? 'Public verification sample' : item.fixture ? 'Example listing' : 'Source license'}</div>
          <h2>{item.sample ? 'Free sample' : dollars(item.amount) + ' USD'}</h2><p>By {item.seller} · v{item.version}</p>
          {item.purchasable ? <Link className="button primary full" to={checkoutPath(item)}>Review license and checkout <ArrowRight size={17}/></Link> :
            item.sampleDownload ? <a className="button primary full" href={item.sampleDownload} download><ArrowDownToLine size={17}/> Download sample ZIP</a> :
            <p className="notice">{item.fixture ? 'Example listing for comparison.' : 'Seller checkout is awaiting merchant eligibility.'}</p>}
          {item.demo && <a className="button secondary full" href={item.demo} target="_blank" rel="noreferrer"><Play size={15}/> Open in browser</a>}
          <button className="button secondary full" aria-pressed={selected} disabled={!selected && compared.length === 3} onClick={() => compare(item.id)}><GitCompareArrows size={16}/> {selected ? 'Remove from comparison' : 'Add to comparison'}</button>
        </section>
        <section className="panel install-card"><h2>Setup and costs</h2><p className="preserve">{item.setup}</p><p>{item.costs}</p>
          {item.digest && <><h3>Archive SHA-256</h3><code className="digest">{item.digest}</code><button className="text-button" onClick={event => { const target = event.currentTarget; void navigator.clipboard.writeText(item.digest!).then(() => { target.textContent = 'Copied'; }); }}>Copy checksum</button></>}
        </section>
        <section className="panel"><h2>License and support</h2><p>{item.sample ? 'MIT license. The archive includes the license and file manifest.' : LICENSE_TEXT}</p><p>{item.notices}</p><p>{item.support}</p><Link to={item.sample || item.fixture ? '/support' : '/support?' + new URLSearchParams({ release: item.id })} className="text-link">Report a rights or setup issue <ArrowUpRight size={14}/></Link></section>
      </aside>
    </div>
  </>;
}
export function Compare() {
  const { compared, compare } = useApp();
  const { data, error, refresh } = useRemote<{ releases: Release[] }>('/catalog');
  if (!data) return <LoadState error={error} retry={refresh}/>;
  const items = compared.flatMap(id => data.releases.find(item => item.id === id) ?? []);
  return <><div className="page-head"><div className="eyebrow"><GitCompareArrows size={16}/> Shortlist</div><h1>Compare releases</h1><p>Review price, setup and independent observations side by side.</p></div>
    {!items.length ? <section className="empty"><h2>Your shortlist is empty</h2><p>Add up to three releases from the catalog.</p><Link to="/browse" className="button primary">Browse software</Link></section> :
      <><div className="table-wrap"><table><thead><tr><th scope="col">Release</th>{items.map(item => <th scope="col" key={item.id}><Link to={'/release/' + item.id}>{item.title}</Link><button className="text-button" onClick={() => compare(item.id)}>Remove</button></th>)}</tr></thead>
        <tbody>
          {([
            ['Price', (item: Release) => item.sample ? 'Free sample' : item.fixture ? dollars(item.amount) + ' · Example' : dollars(item.amount)],
            ['Version', (item: Release) => item.version],
            ['Runtime', (item: Release) => item.stack],
            ['Operating costs', (item: Release) => item.costs],
            ['Setup', (item: Release) => item.setup],
            ...Object.entries(capabilities).map(([key, label]) => [label, (item: Release) => {
              const finding = exactReport(item)?.findings.find(f => f.capability === key);
              const status = finding?.status === 'pass' ? 'Verified' : finding?.status === 'fail' ? 'Contradicted' : 'Not tested';
              return finding ? <Link to={'/release/' + item.id + '#' + finding.id} className={'tag ' + (finding.status === 'pass' ? '' : 'neutral')}>{status}</Link> : status;
            }] as const),
          ] as const).map(([name, render]) => <tr key={name}><th scope="row">{name}</th>{items.map(item => <td key={item.id}>{render(item)}</td>)}</tr>)}
        </tbody>
      </table></div>
      <div className="compare-decisions">{items.map(item => {
        const contextual = comparisonEvidence(item);
        return <section className="panel" key={item.id}><h2>{item.title}</h2>
          {contextual ? <ResultEvidence {...contextual}/> : <><p>{exactReport(item)?.corePassed ? 'The core workflow passed an independent clean run.' : 'Independent verification is unavailable for this release.'}</p>
            <Link className="text-link" to={'/release/' + item.id}>Inspect release evidence <ArrowRight size={16}/></Link>
            {item.purchasable && <Link className="button primary full" to={checkoutPath(item)}>Review license and checkout <ArrowRight size={16}/></Link>}</>}
        </section>;
      })}</div></>}
  </>;
}
