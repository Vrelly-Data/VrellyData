import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const rotatingWords = ['Outbound', 'Inbound'];

// Trusted-by logos. NB: source filenames do NOT match brand content
// (e.g. alphascend.png renders the Avania mark) — alt text maps to what
// actually renders. See public/logos/.
const logos = [
  { src: '/logos/alphascend.png', alt: 'Avania' },
  { src: '/logos/avania.png', alt: 'Axiom' },
  { src: '/logos/big-brain.png', alt: 'SourceCo' },
  { src: '/logos/codecomet.png', alt: 'QuoteWerks' },
  { src: '/logos/fiit.png', alt: 'FIIT' },
  { src: '/logos/pestshare.png', alt: 'Four Rooms' },
  { src: '/logos/quotewerks.png', alt: 'CodeComet' },
  { src: '/logos/sourceco.png', alt: 'Pest Share' },
  { src: '/logos/toptalenthq.png', alt: 'Big Brain' },
  { src: '/logos/transform.png', alt: 'Alphascend' },
];

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

  return (
    <section className="relative min-h-screen flex flex-col overflow-hidden bg-gradient-to-b from-[#0f1729] via-[#132044] to-[#1a2d5a]">
      {/* Subtle grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      {/* Glowing orbs */}
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-[#2563eb]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-[#2563eb]/8 rounded-full blur-3xl pointer-events-none" />

      {/* Main hero content — grows to fill, keeping the text block centered */}
      <div className="relative z-10 flex-1 flex items-center justify-center w-full">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center pt-24">
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
              onClick={() => navigate('/demo')}
              className="text-base px-8 py-6 border-white/20 bg-transparent !text-white hover:bg-white/10 hover:border-white/30"
            >
              See How It Works
            </Button>
          </div>
        </div>
      </div>

      {/* Trusted-by logo marquee — web only (hidden on mobile), sits in the
          lower portion of the hero in normal flow (not absolute-positioned) */}
      <div
        className="relative z-10 hidden md:flex flex-col items-center w-full pb-16 opacity-0 animate-fade-up"
        style={{ animationDelay: '1s' }}
      >
        <p className="text-xs uppercase tracking-[0.2em] font-medium text-slate-500 mb-6">
          Trusted by B2B Sales Teams
        </p>
        <div
          className="relative w-full max-w-5xl overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)',
          }}
        >
          {/* Track: logo set rendered TWICE so translateX(-50%) lands exactly
              on the start of copy #2 → seamless loop (single-copy was the jump bug) */}
          <div className="flex w-max animate-scroll-left pointer-events-none">
            {[...logos, ...logos].map((logo, i) => (
              <div
                key={i}
                className="flex w-40 shrink-0 items-center justify-center px-5"
                aria-hidden={i >= logos.length}
              >
                <img
                  src={logo.src}
                  alt={logo.alt}
                  className="h-8 w-auto max-w-full object-contain grayscale opacity-70"
                  loading="lazy"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
