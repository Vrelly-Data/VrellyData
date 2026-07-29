import { Button } from '@/components/ui/button';
import { useNavigate, useLocation } from 'react-router-dom';
import vrellyLogo from '@/assets/vrelly-logo.png';

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
          <img
            src={vrellyLogo}
            alt="Vrelly"
            className="h-16 md:h-[6.75rem] w-auto shrink-0 cursor-pointer"
            onClick={() => navigate('/')}
          />

          <div className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">
              Features
            </button>
            <button onClick={() => scrollToSection('how-it-works')} className="hover:text-white transition-colors">
              How It Works
            </button>
            <button onClick={() => scrollToSection('pricing')} className="hover:text-white transition-colors">
              Pricing
            </button>
            <button onClick={() => navigate('/comparisons')} className="hover:text-white transition-colors">
              Compare
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/auth')}
              className="text-sm text-slate-300 hover:text-white hover:bg-white/10"
            >
              Log In
            </Button>
            <Button
              onClick={() => navigate('/demo')}
              className="text-sm bg-[#2563eb] hover:bg-[#2563eb]/90 text-white"
            >
              See Demo
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
};
