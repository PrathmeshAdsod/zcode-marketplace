import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Landing() {
  return <>
    <section className="amber-hero" aria-labelledby="landing-title">
      <div className="landing-frame landing-grid">
        <h1 id="landing-title"><span>Find it.</span><span>Check it.</span><span>Run it.</span></h1>
        <p>Source releases with evidence for the exact version you download.</p>
      </div>
    </section>
    <nav className="landing-frame landing-links" aria-label="Explore Zcode">
      <Link to="/browse"><span>Browse releases</span><ArrowRight aria-hidden="true" strokeWidth={1.8}/></Link>
      <Link to="/release/acorn-trail"><span>See a tested release</span><ArrowRight aria-hidden="true" strokeWidth={1.8}/></Link>
    </nav>
  </>;
}
