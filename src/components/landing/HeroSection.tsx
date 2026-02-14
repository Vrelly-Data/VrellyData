import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { useEffect, useState } from 'react';

const particles = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 100}%`,
  size: Math.random() * 4 + 2,
  delay: Math.random() * 5,
  duration: Math.random() * 3 + 3,
}));

const AnimatedCounter = ({ target, label }: { target: number; label: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let frame: number;
    const duration = 2000;
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      setCount(Math.floor(progress * target));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
      <span className="font-semibold text-foreground">{count.toLocaleString()}+</span>
      <span>{label}</span>
    </div>
  );
};

export const HeroSection = () => {
  const navigate = useNavigate();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
      {/* Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />

      {/* Floating particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-primary/20 animate-float"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}

      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse delay-1000" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center pt-20">
        <div className="flex justify-center mb-0">
          <img src={vrellyLogo} alt="Vrelly - AI Sales Intelligence" className="h-80 md:h-96 animate-fade-in" />
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-8 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          <Sparkles className="w-4 h-4" />
          <span>AI-Powered Sales Intelligence Platform</span>
        </div>

        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
          <span className="inline-block opacity-0 animate-fade-up" style={{ animationDelay: '0.3s' }}>
            <span className="text-foreground">Your Sales Data.</span>
          </span>
          <br />
          <span className="inline-block opacity-0 animate-fade-up" style={{ animationDelay: '0.5s' }}>
            <span className="text-foreground">Your AI Agent.</span>
          </span>
          <br />
          <span className="inline-block opacity-0 animate-fade-up" style={{ animationDelay: '0.7s' }}>
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Your Competitive Edge.
            </span>
          </span>
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-10 opacity-0 animate-fade-up" style={{ animationDelay: '0.9s' }}>
          Enriched prospect data at scale. AI-powered sales intelligence from your real campaign data.
          1-click AI sales agents trained on your performance.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 opacity-0 animate-fade-up" style={{ animationDelay: '1.1s' }}>
          <Button
            size="lg"
            onClick={() => navigate('/auth')}
            className="text-base px-8 py-6 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25"
          >
            Start Free
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => scrollToSection('pricing')}
            className="text-base px-8 py-6"
          >
            View Pricing
          </Button>
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground opacity-0 animate-fade-up" style={{ animationDelay: '1.3s' }}>
          <AnimatedCounter target={200000} label="campaigns analyzed" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span>25 free credits</span>
          </div>
        </div>
      </div>
    </section>
  );
};
