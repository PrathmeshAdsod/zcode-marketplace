import { useEffect, useState } from 'react';
import { Activity, Bell, Pause, Play, RefreshCw } from 'lucide-react';
import { api, message, useRemote } from './api';
import { RequireAccount, useApp } from './main';
import { LoadState } from './market';

type Operation = 'ai' | 'verification' | 'checkout';
type Metric = { key: string; label: string; unit: string; period: 'day'|'rolling'|'stored'; allowance: number; allocation: number; used: number; threshold: number };
type Usage = {
  asOf: string;
  metrics: Metric[];
  operations: { operation: Operation; manual: { paused: number; reason: string } | null; limits: string[]; storageMissing: boolean; paymentsMissing: boolean }[];
  alerts: { label: string; reason: string; created_at: number }[];
  verification: { active: number; concurrency: number; seconds: number; archiveBytes: number };
  gemini?: { model: string; day: string; admission: { rpm: number; tpm: number; rpd: number } | null;
    usage: { requests: number; measured: number; inputTokens: number; outputTokens: number; validated: number } };
};
const names: Record<Operation, string> = { ai: 'AI inference', verification: 'New verification jobs', checkout: 'New orders and captures' };
const groups = [
  ['API and database', ['api', 'dbRead', 'dbWrite']],
  ['Private storage', ['r2Bytes', 'r2A', 'r2B']],
  ['AI', ['aiRequests','aiInput','aiOutput']],
  ['Verification', ['verifyJobs','verifyTime']],
] as const;

export function CostAdmin() {
  return <>
    <div className="page-head"><div className="eyebrow"><Activity size={16}/> Administration</div>
      <h1>Usage and cost controls</h1><p>Check Zcode’s usage and protect capacity for existing buyers.</p>
    </div>
    <RequireAccount administrator><UsageDashboard/></RequireAccount>
  </>;
}
function count(value: number, metric: Metric) {
  return metric.unit === 'bytes' ? new Intl.NumberFormat('en', { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 3 }).format(value / 1_000_000_000) :
    new Intl.NumberFormat().format(value);
}
function UsageDashboard() {
  const { session } = useApp();
  const permitted = session?.isCostAdmin;
  const remote = useRemote<Usage>(permitted ? '/admin/cost' : null);
  const [reasons, setReasons] = useState<Partial<Record<Operation, string>>>({});
  const [update, setUpdate] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState('');
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (!permitted) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void api<Usage>('/admin/cost').then(setUpdate).catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [permitted]);
  if (!permitted) return <section className="empty"><h2>Administrator access required</h2><p>Sign in with an authorized GitHub account.</p></section>;
  const data = update ?? remote.data;
  if (!data) return <LoadState error={remote.error} retry={remote.refresh}/>;
  async function refresh() {
    try { setUpdate(await api<Usage>('/admin/cost')); setError(''); }
    catch (err) { setError(message(err)); }
  }
  async function toggle(operation: Operation, paused: boolean) {
    setBusy(operation); setError('');
    try {
      setUpdate(await api<Usage>('/admin/cost/pause', 'POST', { operation, paused, reason: reasons[operation] }));
      setReasons(previous => ({ ...previous, [operation]: '' }));
    } catch (err) { setError(message(err)); }
    finally { setBusy(null); }
  }
  async function recover() {
    setRecovering(true); setRecovery('');
    try {
      const result = await api<{ released: number }>('/admin/cost/storage-recovery', 'POST', {});
      setRecovery(result.released ? 'Released ' + result.released + ' unused storage reservations.' : 'No unused storage reservations found.');
      await refresh();
    } catch (err) { setRecovery(message(err)); }
    finally { setRecovering(false); }
  }
  const label = (key: string) => data!.metrics.find(metric => metric.key === key)?.label ?? key;
  return <div className="stack cost-dashboard">
    {data.gemini && <section className="panel">
      <h2>Gemini project usage</h2>
      <p>{data.gemini.model} · {data.gemini.day} (Pacific)</p>
      {data.gemini.admission ? <p>{data.gemini.usage.requests} reserved calls today. Project admission limits are {data.gemini.admission.rpm} calls and {data.gemini.admission.tpm.toLocaleString()} input tokens per minute, and {data.gemini.admission.rpd} calls per day.</p> : <p>Gemini project limits are unconfigured.</p>}
      <p>Provider-reported usage from {data.gemini.usage.measured} responses: {data.gemini.usage.inputTokens.toLocaleString()} input tokens and {data.gemini.usage.outputTokens.toLocaleString()} output and thinking tokens. {data.gemini.usage.validated} validated interpretations.</p>
    </section>}
    <section className="panel">
      <div className="section-head"><div><h2>Service status</h2><p>Updated {new Date(data.asOf).toLocaleString()}</p></div>
        <button className="button secondary" onClick={() => void refresh()}><RefreshCw size={15}/> Refresh usage</button></div>
      <p className="notice">New work pauses at 80% of Zcode’s allocation. Existing receipts, payment reconciliation and owned downloads retain reserved capacity.</p>
      <div className="stack">{data.operations.map(item => {
        const paused = Boolean(item.manual?.paused || item.limits.length || item.storageMissing || item.paymentsMissing);
        return <div className="cost-operation" key={item.operation}>
          <div><h3>{names[item.operation]}</h3><span className={'tag' + (paused ? ' neutral' : '')}>{paused ? 'Paused' : 'Available'}</span>
            {item.manual?.paused && <p>{item.manual.reason}</p>}
            {item.storageMissing && <p>Private storage is unavailable.</p>}
            {item.paymentsMissing && <p>PayPal Sandbox setup is pending.</p>}
            {!!item.limits.length && <p>Usage threshold reached for {item.limits.map(label).join(', ')}.</p>}
          </div>
          <form className="cost-form" onSubmit={event => { event.preventDefault(); void toggle(item.operation, !item.manual?.paused); }}>
            <label htmlFor={'reason-' + item.operation}>Reason</label>
            <input id={'reason-' + item.operation} value={reasons[item.operation] ?? ''} onChange={event =>
              setReasons(previous => ({ ...previous, [item.operation]: event.target.value }))} required minLength={8} maxLength={240}/>
            <button className="button secondary" disabled={busy === item.operation}>
              {item.manual?.paused ? <><Play size={15}/> Clear manual pause</> : <><Pause size={15}/> Pause</>}
            </button>
          </form>
        </div>;
      })}</div>
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
    <div className="cost-grid">{groups.map(([group, keys]) => <section className="panel" key={group}><h2>{group}</h2>
      {data.metrics.filter(metric => keys.some(key => key === metric.key)).map(metric => <div className="cost-meter" key={metric.key}>
        <div className="section-head"><strong>{metric.label}</strong><span>{count(metric.used, metric)} / {count(metric.allocation, metric)}</span></div>
        <progress aria-label={metric.label} max={metric.allocation} value={Math.min(metric.used, metric.allocation)}/>
        <p>{metric.unit === 'bytes' ? 'Conservative retained bytes' : metric.unit} · {metric.period === 'day' ? 'UTC day' : metric.period === 'rolling' ? 'Rolling 31 days' : 'No automatic reset'}</p>
        <p>Pause threshold {count(metric.threshold, metric)}{['api','dbRead','dbWrite','r2Bytes','r2A','r2B','aiNeurons'].includes(metric.key) && <>
          {' · Provider free allowance '}{metric.key === 'r2Bytes' ? '10 GB-month' : count(metric.allowance, metric)}</>}</p>
      </div>)}
      {group === 'Verification' && <p>{data.verification.active} / {data.verification.concurrency} active · {data.verification.seconds}s execution · {data.verification.archiveBytes / (1024 ** 2)} MiB per archive</p>}
      {group === 'Private storage' && <>
        <button className="button secondary" type="button" disabled={recovering} onClick={() => void recover()}>Check unused reservations</button>
        <p className="muted">Releases capacity only for old, unreferenced reservations with no object in R2.</p>
        {recovery && <p role="status">{recovery}</p>}
      </>}
    </section>)}</div>
    <section className="panel"><h2><Bell size={19}/> Administrator alerts</h2>
      {data.alerts.length ? <ul>{data.alerts.map((alert, index) => <li key={alert.created_at + ':' + index}>
        <strong>{alert.label}</strong> · {alert.reason} <span className="muted">{new Date(alert.created_at * 1000).toLocaleString()}</span></li>)}</ul>
        : <p>No budget alerts recorded.</p>}
      <p className="muted">These are Zcode’s usage counters and estimates. Check the <a className="text-link" href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">Cloudflare dashboard</a> for account-wide billing and usage.</p>
    </section>
  </div>;
}
