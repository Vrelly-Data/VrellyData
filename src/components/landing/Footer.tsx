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
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-8">
          <div>
            <img src={vrellyLogo} alt="Vrelly" className="h-10 mb-2" />
            <p className="text-sm text-slate-500">AI-powered B2B sales intelligence</p>
          </div>

          {/* This row of 6 links measured 436px unwrapped — wider than a 390px
              phone. Because nothing clipped it, it pushed the LAYOUT VIEWPORT
              to 453px, so iOS rendered the whole page zoomed out: that is what
              cropped the header logo and the See Demo button up in the hero.
              flex-wrap + a tighter mobile gap keeps it inside the viewport; on
              md+ there is ample room, so gap-8 on one line is unchanged. */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 md:gap-8 text-sm text-slate-400">
            <a
              href="/features"
              onClick={(e) => {
                if (window.location.pathname === '/') {
                  e.preventDefault();
                  scrollToSection('features');
                }
              }}
              className="hover:text-white transition-colors"
            >
              Features
            </a>
            <a
              href="/pricing"
              onClick={(e) => {
                if (window.location.pathname === '/') {
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
              Blog
            </a>
            <a href="/demo" className="hover:text-white transition-colors">
              Demo
            </a>
            <a href="/privacy" className="hover:text-white transition-colors">
              Privacy
            </a>
            <a href="/terms" className="hover:text-white transition-colors">
              Terms
            </a>
            <a
              href="https://www.linkedin.com/company/109149450/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              LinkedIn
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
