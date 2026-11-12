import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, GitCompareArrows, Search, ShoppingBag, UserRound } from 'lucide-react';
import '@fontsource-variable/geist';
import './styles.css';
import './amber.css';
import { BRAND_NAME, categories } from './domain';
import { api, message, useRemote } from './api';
import { Results, Compare, ReleaseDetail } from './market';
import { Checkout, Library, Receipt, Support } from './checkout';
import { Studio, ReviewDesk } from './studio';
import { CostAdmin } from './cost-admin';
import { Landing } from './landing';
import { MagneticCursor } from './magnetic-cursor';

export type Account = { id: string; name: string; role: 'member' | 'reviewer' | 'release-reviewer' };
type Session = { account: Account | null; localDemo: boolean; githubConfigured: boolean; isCostAdmin: boolean; costAlerts?: number };
type AppState = { session: Session | null; refresh: () => void; compared: string[]; compare: (id: string) => void };
const AppContext = createContext<AppState>({ session: null, refresh: () => {}, compared: [], compare: () => {} });
export const useApp = () => useContext(AppContext);

function Wordmark() {
  return <Link to="/" className="wordmark" aria-label={BRAND_NAME + ' home'}>{BRAND_NAME}</Link>;
}
function AccountMenu() {
  const { session, refresh } = useApp();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  async function change(role?: string) {
    setError('');
    try {
      await api(role ? '/session/demo' : '/session/logout', 'POST', role ? { role } : {});
      refresh();
      if (role) navigate(role === 'seller' ? '/studio' : role === 'reviewer' ? '/review' : role === 'admin' ? '/admin/usage' : '/library');
    } catch (err) { setError(message(err)); }
  }
  if (!session?.localDemo && !session?.account && !session?.githubConfigured) return null;
  return <details className="account-menu">
    <summary><UserRound size={17}/><span>{session?.account?.name || 'Account'}</span><ChevronDown size={13}/></summary>
    <div className="account-pop">
      {session?.githubConfigured && !session.account && <a href="/api/github/login">Sign in with GitHub <ArrowUpRight size={14}/></a>}
      {session?.localDemo && <><small>Local demo accounts</small>
        {['buyer','seller','reviewer','other','admin'].map(role => <button key={role} onClick={() => void change(role)}>{role === 'other' ? 'Second buyer' : role === 'admin' ? 'Sample administrator' : 'Sample ' + role}</button>)}</>}
      {session?.account && <button onClick={() => void change()}>Sign out</button>}
      {error && <small role="alert">{error}</small>}
    </div>
  </details>;
}
export function RequireAccount({ children, reviewer = false, administrator = false }: { children: ReactNode; reviewer?: boolean; administrator?: boolean }) {
  const { session, refresh } = useApp();
  const { pathname } = useLocation();
  const [error, setError] = useState('');
  if (!session) return <p className="notice">Checking your session…</p>;
  if (!session.account) return <section className="empty">
    <h2>Sign in to continue</h2>
    {session.githubConfigured && <a className="button primary" href={'/api/github/login?' + new URLSearchParams({ return: pathname })}>Sign in with GitHub</a>}
    {session.localDemo && <button className="button primary" onClick={() => void api('/session/demo', 'POST', { role: administrator ? 'admin' : reviewer ? 'reviewer' : 'buyer' }).then(refresh).catch(err => setError(message(err)))}>Continue as sample {administrator ? 'administrator' : reviewer ? 'reviewer' : 'buyer'}</button>}
    {!session.githubConfigured && !session.localDemo && <p>GitHub sign-in is awaiting operator setup. You can still browse the catalog.</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </section>;
  if (reviewer && session.account.role === 'member') return <section className="empty"><h2>Reviewer access required</h2><p>Use the reviewer identity to open this workspace.</p></section>;
  return <>{children}</>;
}
function Header() {
  const { session, compared } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const current = new URLSearchParams(location.search).get('q') ?? '';
  const [query, setQuery] = useState(current);
  useEffect(() => setQuery(current), [current]);
  function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? '/browse?' + new URLSearchParams({ q }) : '/browse');
  }
  if (location.pathname === '/') return <header className="landing-header">
    <div className="landing-frame landing-nav">
      <Wordmark/>
      <nav aria-label="Main navigation">
        {session?.isCostAdmin && <Link to="/admin/usage">Usage</Link>}
        {session?.account && <Link to="/library">Library</Link>}
        <Link to="/studio">Seller studio</Link>
        <Link to="/browse" className="landing-cta">Browse releases</Link>
        <AccountMenu/>
      </nav>
    </div>
  </header>;
  return <header className="header">
    <div className="header-main frame">
      <Wordmark/>
      <form onSubmit={search} className="header-search" role="search">
        <Search size={17}/><input aria-label="Search marketplace" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search software, use cases, or stacks" maxLength={360}/>
        <button type="submit" aria-label="Run marketplace search"><ArrowUpRight size={17}/></button>
      </form>
      <nav className="account-nav" aria-label="Workspace">
        <NavLink to="/studio">Seller studio</NavLink>
        {session?.account && session.account.role !== 'member' && <NavLink to="/review">Review desk</NavLink>}
        {session?.isCostAdmin && <NavLink to="/admin/usage">Usage{session.costAlerts ? ' (' + session.costAlerts + ')' : ''}</NavLink>}
        <NavLink to="/library" className="library-nav"><ShoppingBag size={16}/><span>Library</span></NavLink>
        <AccountMenu/>
      </nav>
    </div>
    <div className="category-line">
      <div className="frame category-inner">
        <nav aria-label="Categories">
          <NavLink to="/browse" end className={() => location.pathname === '/browse' && !new URLSearchParams(location.search).get('category') ? 'active' : ''}>All software</NavLink>
          {categories.map(category => <Link key={category} to={'/browse?' + new URLSearchParams({ category })} className={new URLSearchParams(location.search).get('category') === category ? 'active' : ''}>{category}</Link>)}
        </nav>
        <Link to="/compare" className="compare-nav"><GitCompareArrows size={15}/> Compare{compared.length ? ' (' + compared.length + ')' : ''}</Link>
      </div>
    </div>
  </header>;
}
function App() {
  const { data: session, refresh } = useRemote<Session>('/session');
  const [compared, setCompared] = useState<string[]>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem('zcode-compare') || '[]'); return Array.isArray(saved) ? saved.filter(value => typeof value === 'string').slice(0,3) : []; }
    catch { return []; }
  });
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo({ top: 0 }); }, [pathname, hash]);
  function compare(id: string) {
    setCompared(previous => {
      const next = previous.includes(id) ? previous.filter(item => item !== id) : previous.length < 3 ? [...previous, id] : previous;
      sessionStorage.setItem('zcode-compare', JSON.stringify(next));
      return next;
    });
  }
  return <AppContext.Provider value={{ session, refresh, compared, compare }}>
    <a className="skip" href="#main">Skip to content</a>
    <Header/>
    <main id="main" className={pathname === '/' ? 'landing-main' : 'frame site-main app-page'} tabIndex={-1}>
      <Routes>
        <Route index element={<Landing/>}/><Route path="browse" element={<Results/>}/><Route path="compare" element={<Compare/>}/>
        <Route path="release/:id" element={<ReleaseDetail/>}/><Route path="checkout/:id" element={<Checkout/>}/>
        <Route path="receipt/:id" element={<Receipt/>}/><Route path="library" element={<Library/>}/>
        <Route path="studio" element={<Studio/>}/><Route path="review" element={<ReviewDesk/>}/>
        <Route path="admin/usage" element={<CostAdmin/>}/>
        <Route path="support" element={<Support/>}/>
        <Route path="*" element={<section className="empty"><h1>Page not found</h1><Link to="/" className="button">Back to marketplace</Link></section>}/>
      </Routes>
    </main>
    <footer className="footer"><div className="frame"><Wordmark/><p>Software you can run. Evidence you can inspect.</p><Link to="/library">Library</Link><Link to="/support">Support and rights reports <ArrowUpRight size={14}/></Link></div></footer>
    <MagneticCursor/>
  </AppContext.Provider>;
}
document.title = BRAND_NAME + ' · Software marketplace';
createRoot(document.getElementById('root')!).render(<BrowserRouter><App/></BrowserRouter>);
