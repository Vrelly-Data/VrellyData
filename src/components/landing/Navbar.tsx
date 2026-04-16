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
          <img
            src={vrellyLogo}
            alt="Vrelly"
            className="h-[6.75rem] cursor-pointer"
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
              onClick={() => navigate('/auth?tab=signup')}
              className="text-sm bg-[#2563eb] hover:bg-[#2563eb]/90 text-white"
            >
              Get Started
            </Button>
            <Button
              variant="outline"
              onClick={() => scrollToSection('how-it-works')}
              className="text-sm border-white/20 bg-transparent !text-white hover:bg-white/10 hover:border-white/30"
            >
              See Demo
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
};
