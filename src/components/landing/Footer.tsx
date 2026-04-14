import vrellyLogo from '@/assets/vrelly-logo.png';
import { useNavigate } from 'react-router-dom';

export const Footer = () => {
  const currentYear = new Date().getFullYear();
  const navigate = useNavigate();

  const scrollToSection = (id: string) => {
    if (window.location.pathname === '/') {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(`/?section=${id}`);
    }
  };

  return (
    <footer className="bg-[#0b1120] py-16 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8">
          <div>
            <img src={vrellyLogo} alt="Vrelly" className="h-[4.5rem] mb-2" />
            <p className="text-sm text-slate-500">AI-powered B2B sales intelligence</p>
          </div>

          <div className="flex items-center gap-8 text-sm text-slate-400">
            <button onClick={() => scrollToSection('features')} className="hover:text-white transition-colors">
              Features
            </button>
            <button onClick={() => scrollToSection('pricing')} className="hover:text-white transition-colors">
              Pricing
            </button>
            <a href="/comparisons" className="hover:text-white transition-colors">
              Compare
            </a>
            <a href="/resources" className="hover:text-white transition-colors">
              Blog
            </a>
            <a href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </a>
            <a href="/terms" className="hover:text-white transition-colors">
              Terms
            </a>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 text-center">
          <p className="text-sm text-slate-500">
            &copy; {currentYear} Vrelly. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
