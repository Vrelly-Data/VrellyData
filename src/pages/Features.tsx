import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { Database, Sparkles, Bot, ArrowRight, Check } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { Button } from '@/components/ui/button';

const pillars = [
  {
    id: 'prospects',
    icon: Database,
    title: '100M+ Verified Prospects',
    tagline: 'The data layer beneath every campaign',
    description:
      'Filter by job title, seniority, industry, location, and company size. Export contacts instantly with triple-verified emails and direct dials.',
    bullets: [
      'Triple-verified emails — bounce rates under 3%',
      'Direct dials, not switchboards',
      'Filter across 20+ firmographic and role attributes',
      'Continuously refreshed, never stale',
    ],
  },
  {
    id: 'playground',
    icon: Sparkles,
    title: 'Data Playground',
    tagline: 'See what\'s working, stop guessing',
    description:
      'Sync your data to get insights into your campaign copy and audience, plus a birds eye view of outbound activity.',
    bullets: [
      'Correlate copy patterns to reply rates',
      'Audience segments ranked by actual performance',
      'Campaign-level attribution across channels',
      'One-click exports for your team',
    ],
  },
  {
    id: 'agent',
    icon: Bot,
    title: 'AI Sales Agent',
    tagline: 'An SDR that works 24/7 and learns from every reply',
    description:
      'Builds your outbound campaigns, adds target prospects, manages responses and follow ups.',
    bullets: [
      'Writes and sends personalized first-touch emails',
      'Handles replies like a human — qualifies, books, follows up',
      'Learns from your closed-won history to prioritize prospects',
      'Full activity log — you always know what the agent did and why',
    ],
  },
];

const Features = () => {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <Helmet>
        <title>Features — Vrelly</title>
        <meta
          name="description"
          content="Everything you need to scale outbound sales: 100M+ verified prospects, data-driven insights, and an AI sales agent that learns from your campaigns."
        />
      </Helmet>

      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden bg-gradient-to-b from-[#0f1729] via-[#132044] to-[#1a2d5a]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-[#2563eb]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#2563eb]/15 border border-[#2563eb]/30 text-[#60a5fa] text-sm font-medium mb-10">
            <div className="w-2 h-2 rounded-full bg-[#60a5fa] animate-pulse" />
            Platform Features
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-8 leading-[1.1]">
            Everything You Need<br />
            To Scale Outbound.
          </h1>

          <p className="text-lg md:text-xl text-slate-300 max-w-3xl mx-auto mb-12 leading-relaxed">
            Data, insights, and an AI agent working together in one platform —
            so you can stop cobbling tools and start booking meetings.
          </p>

          {/* Pillar preview cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {pillars.map((pillar) => (
              <a
                key={pillar.id}
                href={`#${pillar.id}`}
                className="group bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 text-left hover:bg-white/10 hover:border-[#2563eb]/40 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-[#2563eb]/20 flex items-center justify-center mb-4 group-hover:bg-[#2563eb]/30 transition-colors">
                  <pillar.icon className="w-6 h-6 text-[#60a5fa]" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">{pillar.title}</h3>
                <p className="text-sm text-slate-400">{pillar.tagline}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed pillar sections */}
      {pillars.map((pillar, index) => (
        <section
          key={pillar.id}
          id={pillar.id}
          className={`py-28 scroll-mt-20 ${index % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]'}`}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-16 items-center ${index % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
              {/* Copy */}
              <div>
                <div className="w-14 h-14 rounded-xl bg-[#2563eb]/10 flex items-center justify-center mb-6">
                  <pillar.icon className="w-7 h-7 text-[#2563eb]" />
                </div>
                <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
                  {pillar.title}
                </h2>
                <p className="text-lg text-[#2563eb] font-medium mb-6">{pillar.tagline}</p>
                <p className="text-base text-slate-600 leading-relaxed mb-8">
                  {pillar.description}
                </p>
                <ul className="space-y-3">
                  {pillar.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-3 text-slate-700">
                      <Check className="w-5 h-5 text-[#2563eb] flex-shrink-0 mt-0.5" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual placeholder — product screenshot goes here next iteration */}
              <div className="relative aspect-[4/3] rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200 flex items-center justify-center overflow-hidden">
                <pillar.icon className="w-32 h-32 text-[#2563eb]/20" />
                <div className="absolute bottom-4 right-4 text-xs text-slate-400 uppercase tracking-widest">
                  Preview
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* Bottom CTA */}
      <section className="py-24 bg-gradient-to-b from-[#0f1729] to-[#1a2d5a]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight">
            Ready to stop cobbling tools?
          </h2>
          <p className="text-lg text-slate-300 mb-10 max-w-2xl mx-auto">
            Start your free trial. No credit card required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
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
              onClick={() => navigate('/pricing')}
              className="text-base px-8 py-6 border-white/20 bg-transparent !text-white hover:bg-white/10 hover:border-white/30"
            >
              See Pricing
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
};

export default Features;
