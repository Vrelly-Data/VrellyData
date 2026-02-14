import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import vrellyLogo from '@/assets/vrelly-logo.png';

export const Navbar = () => {
  const navigate = useNavigate();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <img
            src={vrellyLogo}
            alt="Vrelly"
            className="h-[4.5rem] cursor-pointer"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          />

          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <button onClick={() => scrollToSection('features')} className="hover:text-foreground transition-colors">
              Features
            </button>
            <button onClick={() => scrollToSection('how-it-works')} className="hover:text-foreground transition-colors">
              How It Works
            </button>
            <button onClick={() => scrollToSection('pricing')} className="hover:text-foreground transition-colors">
              Pricing
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/auth')}
              className="text-sm"
            >
              Log In
            </Button>
            <Button
              onClick={() => navigate('/auth')}
              className="text-sm bg-primary hover:bg-primary/90"
            >
              Get Started
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
};
