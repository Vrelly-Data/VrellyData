import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Clock, Target, Sparkles } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

const CALENDLY_EMBED_URL =
  'https://calendly.com/myall-vrelly/30min?embed_domain=vrelly.com&embed_type=Inline';

const expectations = [
  {
    icon: Clock,
    title: '30 minutes, no filler',
    description: 'Tight walkthrough of the platform — no slides, no fluff. Your time is the constraint.',
  },
  {
    icon: Target,
    title: 'Tailored to your use case',
    description: "Bring your campaigns, ICP, or existing stack. We'll map exactly how Vrelly plugs in.",
  },
  {
    icon: Sparkles,
    title: 'Custom implementation plan',
    description: "Walk out with a concrete next step — sample audiences, pilot campaign, or trial account.",
  },
];

const Demo = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <Helmet>
        <title>Book a Demo — Vrelly</title>
        <meta
          name="description"
          content="See Vrelly in action. Book a 30-minute demo with the team to see how the AI sales agent plugs into your outbound."
        />
      </Helmet>

      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-16 overflow-hidden bg-gradient-to-b from-[#0f1729] via-[#132044] to-[#1a2d5a]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-[#2563eb]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#2563eb]/15 border border-[#2563eb]/30 text-[#60a5fa] text-sm font-medium mb-10">
            <div className="w-2 h-2 rounded-full bg-[#60a5fa] animate-pulse" />
            Book a Demo
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-white mb-8 leading-[1.1]">
            See How Vrelly<br />
            Books Meetings.
          </h1>

          <p className="text-lg md:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
            A 30-minute walkthrough with the team. Bring your use case —
            we'll show you exactly how Vrelly would plug in.
          </p>
        </div>
      </section>

      {/* What to expect */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {expectations.map((item) => (
              <div
                key={item.title}
                className="bg-[#f8fafc] rounded-2xl p-8 border border-slate-200"
              >
                <div className="w-12 h-12 rounded-xl bg-[#2563eb]/10 flex items-center justify-center mb-5">
                  <item.icon className="w-6 h-6 text-[#2563eb]" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cal.com embed */}
      <section id="schedule" className="pb-28 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3 tracking-tight">
              Pick a Time
            </h2>
            <p className="text-base text-slate-500">
              All meetings are via Google Meet. Calendar invite sent on confirmation.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 shadow-xl overflow-hidden bg-white">
            <iframe
              src={CALENDLY_EMBED_URL}
              title="Schedule a demo with Vrelly"
              width="100%"
              height="700"
              frameBorder="0"
              className="rounded-lg"
              loading="lazy"
            />
          </div>

          <p className="text-xs text-slate-400 text-center mt-4">
            Scheduling powered by Calendly
          </p>
        </div>
      </section>

      <Footer />
    </>
  );
};

export default Demo;
