import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowLeft, ArrowRight, CircleCheck, Clock3, FileCheck2, LifeBuoy, LockKeyhole, ShoppingBag } from 'lucide-react';
import { api, message, useRemote } from './api';
import { dollars, LICENSE_TEXT, LICENSE_VERSION, type Release, type Report } from './domain';
import { RequireAccount } from './main';
import { LoadState, Passport } from './market';

type PayConfig = { configured: boolean; paused: boolean };
type PurchaseSummary = { id: string; state: string; order: string | null; approvalUrl?: string | null };
type ReceiptData = PurchaseSummary & {
  amount: number; currency: string; merchant: string; title: string; version: string; seller: string;
  releaseId: string; digest: string; licenseVersion: string; license: string; acceptedAt: number;
  capture: string | null; refund: string | null; available: boolean; setup: string; notices: string; support: string; report: Report | null;
  checkoutPaused?: boolean;
};
const labels: Record<string, string> = {
  awaiting: 'Awaiting PayPal approval', pending: 'Payment confirmation pending', complete: 'Payment verified',
  refunded: 'Payment refunded', declined: 'Payment declined', cancelled: 'Checkout cancelled', expired: 'Checkout expired',
};
export function Checkout() {
  const { id = '' } = useParams();
  const [offer] = useSearchParams();
  const remote = useRemote<Release>('/catalog/' + encodeURIComponent(id));
  if (!remote.data) return <LoadState error={remote.error} retry={remote.refresh}/>;
  const item = remote.data;
  const changed = (offer.has('digest') && offer.get('digest') !== item.digest) ||
    (offer.has('price') && offer.get('price') !== String(item.amount)) ||
    (offer.has('license') && offer.get('license') !== LICENSE_VERSION);
  return <>
    <Link className="back" to={'/release/' + item.id}><ArrowLeft size={16}/> Back to release</Link>
    <div className="page-head"><div className="eyebrow"><LockKeyhole size={16}/> PayPal Sandbox</div><h1>Review your license</h1><p>{item.title} · v{item.version}</p></div>
    {changed ? <div className="notice warning">The selected release, price or license changed. <Link to={'/release/' + item.id}>Review the current release</Link>.</div> :
      item.purchasable ? <RequireAccount><Payment item={item}/></RequireAccount> : <div className="notice">Checkout is currently unavailable for this release.</div>}
  </>;
}
function Payment({ item }: { item: Release }) {
  const config = useRemote<PayConfig>('/checkout/config');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const ready = config.data?.configured && !config.data.paused;
  async function pay() {
    if (!ready || !accepted || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const purchase = await api<PurchaseSummary>('/purchases', 'POST', { releaseId: item.id, digest: item.digest,
        amount: item.amount, licenseVersion: LICENSE_VERSION, accepted: true });
      if (purchase.state === 'awaiting' && purchase.approvalUrl) window.location.assign(purchase.approvalUrl);
      else navigate('/receipt/' + purchase.id);
    } catch (err) { setError(message(err)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="detail-layout checkout-layout">
    <section className="panel"><h2>Single end product license</h2><p className="muted">{LICENSE_VERSION}</p><p>{LICENSE_TEXT}</p><p>{item.notices}</p><p>{item.support}</p>
      <label className="check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/> I accept this license for {item.title} v{item.version}.</label>
      <h3>Archive SHA-256</h3><code className="digest">{item.digest}</code>
    </section>
    <section className="panel purchase-card"><div className="eyebrow">Sandbox total</div><h2>{dollars(item.amount)} USD</h2>
      <p>Seller {item.seller}</p>
      <p>After PayPal confirms the capture, return here to get the exact release ZIP, license and setup guide.</p>
      {config.error && <LoadState error={config.error} retry={config.refresh}/>}
      {config.data && !ready && <p className="notice">{config.data.paused ? 'New payments are paused while delivery capacity recovers. Your library and receipts are still available.' : 'The merchant configuration is unavailable.'}</p>}
      {ready && <button className="button primary full" disabled={!accepted || busy} onClick={() => void pay()}>Continue to PayPal Sandbox <ArrowRight size={16}/></button>}
      {busy && <p role="status">Opening PayPal Sandbox…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
  </div>;
}
export function Library() {
  return <><div className="page-head"><div className="eyebrow"><ShoppingBag size={16}/> Your workspace</div><h1>Library</h1><p>Receipts, licensed source and setup guides.</p></div><RequireAccount><LibraryContents/></RequireAccount></>;
}
function LibraryContents() {
  const { data, error, refresh } = useRemote<{ purchases: { id: string; title: string; version: string; state: string; amount: number }[] }>('/library');
  if (!data) return <LoadState error={error} retry={refresh}/>;
  if (!data.purchases.length) return <section className="empty"><h2>No purchases yet</h2><p>Receipts appear here once you start a Sandbox checkout.</p><Link className="button primary" to="/browse">Browse software <ArrowRight size={16}/></Link></section>;
  return <div className="stack">{data.purchases.map(item => <Link key={item.id} className="panel row-link" to={'/receipt/' + item.id}><div><h2>{item.title}</h2><p>v{item.version} · {labels[item.state]}</p></div><span>{dollars(item.amount)} <ArrowRight size={16}/></span></Link>)}</div>;
}
export function Receipt() { return <RequireAccount><ReceiptContents/></RequireAccount>; }
function ReceiptContents() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const remote = useRemote<ReceiptData>('/purchases/' + encodeURIComponent(id));
  const [result, setResult] = useState<ReceiptData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const handledReturn = useRef('');
  const [returnedWithoutPayment, setReturnedWithoutPayment] = useState(false);
  const receipt = result?.id === id ? result : remote.data;
  async function action(action: string, body: object = {}) {
    setBusy(true); setError('');
    try { setResult(await api<ReceiptData>('/purchases/' + id + '/' + action, 'POST', body)); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  const cancelled = params.get('cancelled') === '1';
  const token = params.get('token');
  useEffect(() => {
    if (!receipt || (!cancelled && !token)) return;
    const key = receipt.id + ':' + (cancelled ? 'cancelled' : token);
    if (handledReturn.current === key) return;
    handledReturn.current = key;
    setParams({}, { replace: true });
    if (cancelled) { setReturnedWithoutPayment(true); return; }
    if (!['awaiting', 'pending'].includes(receipt.state)) return;
    void action('capture', { order: token });
  }, [receipt?.id, receipt?.state, cancelled, token]);
  async function download() {
    setBusy(true); setError('');
    try {
      const { url } = await api<{ url: string }>('/library/' + id + '/download', 'POST', {});
      window.location.assign(url);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  if (!receipt) return <LoadState error={remote.error} retry={remote.refresh}/>;
  return <>
    <Link className="back" to="/library"><ArrowLeft size={16}/> Library</Link>
    <div className="page-head"><div className="eyebrow">{receipt.state === 'complete' ? <CircleCheck size={17}/> : <Clock3 size={17}/>} {labels[receipt.state]} · Sandbox</div><h1>{receipt.title}</h1><p>Receipt · Release {receipt.version}</p></div>
    <div className="detail-layout checkout-layout">
      <div className="stack"><section className="panel"><h2>Purchase details</h2>
        <dl className="facts"><dt>Seller</dt><dd>{receipt.seller}</dd><dt>Amount</dt><dd>{dollars(receipt.amount)} {receipt.currency}</dd>
          <dt>Order</dt><dd>{receipt.order ?? 'Awaiting creation'}</dd><dt>Capture</dt><dd>{receipt.capture ?? 'Awaiting confirmation'}</dd>
          {receipt.refund && <><dt>Refund</dt><dd>{receipt.refund}</dd></>}</dl>
        <h3>Archive SHA-256</h3><code className="digest">{receipt.digest}</code>
      </section><section className="panel"><h2>License and setup</h2><p>{receipt.license}</p><p className="muted">{receipt.licenseVersion}</p><p className="preserve">{receipt.setup}</p><p>{receipt.notices}</p></section>
        <Passport report={receipt.report}/></div>
      <div className="stack"><section className="panel">
        <h2>{receipt.state === 'complete' ? 'Get your source' : labels[receipt.state]}</h2>
        {receipt.checkoutPaused && <p className="notice">New capture attempts are paused while delivery capacity recovers. Completed PayPal payments are still reconciled.</p>}
        {receipt.state === 'complete' && <><p>{receipt.available ? 'You can re-download this exact release from your library.' : 'Payment is recorded. Retry the archive when storage is available.'}</p><button disabled={busy} className="button primary full" onClick={() => void download()}><ArrowDownToLine size={18}/> {receipt.available ? 'Download archive' : 'Retry download'}</button></>}
        {['pending','awaiting','complete'].includes(receipt.state) && <button disabled={busy} className="button secondary full" onClick={() => void action('refresh')}>Check PayPal status</button>}
        {['awaiting','expired','cancelled','declined'].includes(receipt.state) && <Link className="button secondary full" to={'/checkout/' + receipt.releaseId}>Return to checkout <ArrowRight size={16}/></Link>}
        {receipt.state === 'awaiting' && returnedWithoutPayment && <><p>PayPal returned you to Zcode. You can resume or cancel this checkout.</p><button disabled={busy} className="button secondary full" onClick={() => void action('cancel')}>Cancel checkout</button></>}
        {receipt.state === 'refunded' && <p>Future downloads are closed for this purchase.</p>}
        {busy && <p role="status">Checking…</p>}{error && <p className="notice error" role="alert">{error}</p>}
      </section><section className="panel"><h2>Need help?</h2><p>{receipt.support}</p><Link className="text-link" to={'/support?' + new URLSearchParams({ purchase: receipt.id })}>Open a support case <ArrowRight size={15}/></Link></section></div>
    </div>
  </>;
}
export function Support() {
  return <><div className="page-head"><div className="eyebrow"><LifeBuoy size={16}/> Help</div><h1>Support and rights reports</h1><p>Report a setup problem, ask about a license or flag unauthorized content.</p></div><RequireAccount><SupportContents/></RequireAccount></>;
}
function SupportContents() {
  const [params] = useSearchParams();
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRemote<{ cases: { id: string; message: string; resolution: string | null }[] }>('/support');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFeedback('');
    try {
      const result = await api<{ id: string }>('/support', 'POST', { message: text, purchaseId: params.get('purchase') ?? '', releaseId: params.get('release') ?? '' });
      setText(''); setFeedback('Case recorded. Reference ' + result.id); list.refresh();
    } catch (err) { setFeedback(message(err)); }
    finally { setBusy(false); }
  }
  return <div className="stack"><form className="panel form-grid" onSubmit={submit}><h2>Open a case</h2>
    {(params.get('purchase') || params.get('release')) && <p className="muted">This case will be linked to the exact release.</p>}
    <label>Describe the issue<textarea required minLength={12} maxLength={2500} rows={5} value={text} onChange={event => setText(event.target.value)} placeholder="Include the version, what you expected and what happened."/></label>
    <button className="button primary" disabled={busy}>Send to support <ArrowRight size={17}/></button>
    {feedback && <p className="notice" role="status">{feedback}</p>}
  </form>
  {list.data?.cases.map(item => <article className="panel" key={item.id}><div className="eyebrow"><FileCheck2 size={15}/> Case {item.id}</div><p>{item.message}</p><p className="muted">{item.resolution ?? 'Awaiting review'}</p></article>)}</div>;
}
