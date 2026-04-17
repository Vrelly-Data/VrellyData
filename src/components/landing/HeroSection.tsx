import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const logos = [
  { name: 'CodeComet', src: '/logos/codecomet.png' },
  { name: 'Four Rooms', src: '/logos/four-rooms.png' },
  { name: 'Oodles', src: '/logos/oodles.png' },
  { name: 'Big Brain', src: '/logos/big-brain.png' },
  { name: 'Axiom', src: '/logos/axiom.png' },
  { name: 'Alphascend', src: '/logos/alphascend.png' },
  { name: 'Transform', src: '/logos/transform.png' },
  { name: 'Avania', src: '/logos/avania.png' },
  { name: 'SourceCo', src: '/logos/sourceco.png' },
  { name: 'TopTalentHQ', src: '/logos/toptalenthq.png' },
  { name: 'FiiT', src: '/logos/fiit.png' },
  { name: 'Chex.AI', src: '/logos/chex-ai.png' },
  { name: 'QuoteWerks', src: '/logos/quotewerks.png' },
  { name: 'PestShare', src: '/logos/pestshare.png' },
];

const rotatingWords = ['Outbound', 'Inbound'];

export const HeroSection = () => {
  const navigate = useNavigate();
  const [wordIndex, setWordIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setWordIndex((prev) => (prev + 1) % rotatingWords.length);
        setFading(false);
      }, 300);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-b from-[#0f1729] via-[#132044] to-[#1a2d5a]">
      {/* Subtle grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      {/* Glowing orbs */}
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-[#2563eb]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-[#2563eb]/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center pt-24 pb-20">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#2563eb]/15 border border-[#2563eb]/30 text-[#60a5fa] text-sm font-medium mb-10 opacity-0 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="w-2 h-2 rounded-full bg-[#60a5fa] animate-pulse" />
          AI Sales Agent Platform
        </div>

        {/* H1 */}
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-8 leading-[1.1]">
          <span className="opacity-0 animate-fade-up inline-block" style={{ animationDelay: '0.2s' }}>
            Your AI{' '}
            <span
              className="inline-block transition-opacity duration-300"
              style={{ opacity: fading ? 0 : 1 }}
            >
              {rotatingWords[wordIndex]}
            </span>{' '}
            Agent.
          </span>
          <br />
          <span className="opacity-0 animate-fade-up inline-block" style={{ animationDelay: '0.4s' }}>
            Trained on Your Data.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-slate-300 max-w-3xl mx-auto mb-12 leading-relaxed opacity-0 animate-fade-up" style={{ animationDelay: '0.6s' }}>
          Launch your outbound and inbound agent that operates like a human. Vrelly learns
          what's working, handles replies, and books more meetings — powered by your real campaign data.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 opacity-0 animate-fade-up" style={{ animationDelay: '0.8s' }}>
          <Button
            size="lg"
            onClick={() => navigate('/auth?tab=signup')}
            className="text-base px-8 py-6 bg-[#2563eb] hover:bg-[#2563eb]/90 !text-white shadow-lg shadow-[#2563eb]/25"
          >
            Get Started
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => scrollToSection('how-it-works')}
            className="text-base px-8 py-6 border-white/20 bg-transparent !text-white hover:bg-white/10 hover:border-white/30"
          >
            See How It Works
          </Button>
        </div>

        {/* Logo bar */}
        <div className="mt-20 opacity-0 animate-fade-up" style={{ animationDelay: '1s' }}>
          <p className="text-sm text-slate-500 mb-6 uppercase tracking-widest font-medium">
            Trusted by B2B sales teams
          </p>
          <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <div className="flex items-center gap-x-10 animate-scroll-left-slow w-max">
              {[...logos, ...logos].map((logo, i) => (
                <div
                  key={`${logo.name}-${i}`}
                  className="shrink-0 flex items-center justify-center rounded-lg bg-white/10 px-5 py-2"
                >
                  <img
                    src={logo.src}
                    alt={logo.name}
                    className="h-7 object-contain"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
