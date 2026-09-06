import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';

export const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const scrollToSection = (id: string) => {
    if (location.pathname === '/') {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(`/?section=${id}`);
    }
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-[#0f1729]/90 border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo. The asset is square (1000x1000), so height drives width too.
              At the desktop h-[6.75rem] (108px) it is WIDER than the space left
              beside the Log In / See Demo buttons on a ~390px phone: the nav row
              measured 421px inside a 358px content box, which pushed the layout
              viewport out to 453px. iOS then renders the whole page zoomed out,
              clipping the logo's left edge and the See Demo button — and because
              108px does not fit the h-16 (64px) bar either, the image box hung
              21px BELOW the nav's bottom border, reading as a stray outline over
              the hero. h-16 exactly fills the bar on mobile; desktop keeps h-[6.75rem]
              exactly as it was. */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-end gap-2 cursor-pointer select-none"
            aria-label="Vrelly"
          >
            <img src="/og-mark.png" alt="" className="h-8 md:h-10 w-auto" />
            <span className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#2563eb]">
              relly
            </span>
          </button>

          <div className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            {/* Use real hrefs for crawlability; enhance with smooth scroll on home */}
            <a
              href="/features"
              onClick={(e) => {
                if (location.pathname === '/') {
                  e.preventDefault();
                  scrollToSection('features');
                }
              }}
              className="hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="/#how-it-works"
              onClick={(e) => {
                if (location.pathname === '/') {
                  e.preventDefault();
                  scrollToSection('how-it-works');
                }
              }}
              className="hover:text-white transition-colors"
            >
              How It Works
            </a>
            <a
              href="/pricing"
              onClick={(e) => {
                if (location.pathname === '/') {
                  e.preventDefault();
                  scrollToSection('pricing');
                }
              }}
              className="hover:text-white transition-colors"
            >
              Pricing
            </a>
            <a href="/comparisons" className="hover:text-white transition-colors">
              Compare
            </a>
            <a href="/resources" className="hover:text-white transition-colors">
              Resources
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/auth')}
              className="text-sm text-slate-300 hover:text-white hover:bg-white/10"
            >
              Log In
            </Button>
            <a href="/demo" className="text-sm bg-[#2563eb] hover:bg-[#2563eb]/90 text-white px-4 py-2 rounded-md">
              Book a demo
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
};
