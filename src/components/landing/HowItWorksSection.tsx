import { useEffect, useRef, useState } from 'react';
import { RefreshCw, BarChart3, Rocket, Inbox, MessageSquare, Users } from 'lucide-react';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

const steps = [
  {
    number: '01',
    icon: RefreshCw,
    title: 'Connect',
    description: 'We Set Up your Outbound and Inbound Agent. We sync every campaign, sequence, and result.',
  },
  {
    number: '02',
    icon: BarChart3,
    title: 'Analyze',
    description: 'Your data is synced and scored, and benchmarked and cross-referenced against our proprietary sales repository.',
  },
  {
    number: '03',
    icon: Rocket,
    title: 'Act',
    description: 'Your AI agent handles initial outbound messages, replies, writes follow-ups, on co pilot with your dedicated account manager. Your agent learns from real results.',
  },
];

type Step = {
  number: string;
  icon: any;
  title: string;
  description: string;
};

// Mobile/stacked card: reveals per-step using its own IntersectionObserver
const StepCard = ({ step }: { step: Step }) => {
  const { ref, isVisible } = useScrollAnimation(0.2);
  return (
    <div
      ref={ref}
      className={`text-center transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      <div className="text-6xl font-black text-[#2563eb]/10 mb-4">{step.number}</div>
      <div className="w-16 h-16 rounded-2xl bg-[#2563eb]/10 flex items-center justify-center mx-auto mb-5">
        <step.icon className="w-8 h-8 text-[#2563eb]" />
      </div>
      <h3 className="text-xl font-bold text-slate-900 mb-3">{step.title}</h3>
      <p className="text-slate-500 leading-relaxed max-w-sm mx-auto">{step.description}</p>
    </div>
  );
};

export const HowItWorksSection = () => {
  // Separate observers for header and bottom card
  const { ref: headerRef, isVisible: headerVisibleRaw } = useScrollAnimation();
  const { ref: cardRef, isVisible: cardVisibleRaw } = useScrollAnimation();
  const reducedMotion = usePrefersReducedMotion();

  const headerVisible = reducedMotion ? true : headerVisibleRaw;
  const cardVisible = reducedMotion ? true : cardVisibleRaw;

  // Pinned scroll track (md+): reveal steps 01 → 02 → 03 driven by scroll progress
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isMdUp, setIsMdUp] = useState(false);
  const [visibleCount, setVisibleCount] = useState<number>(steps.length);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => setIsMdUp(mq.matches);
    onChange();
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    } else {
      // @ts-ignore legacy
      mq.addListener(onChange);
      // @ts-ignore legacy
      return () => mq.removeListener(onChange);
    }
  }, []);

  const pinnedEnabled = isMdUp && !reducedMotion;

  // Initialize visibleCount based on whether pinned behavior is active
  useEffect(() => {
    setVisibleCount(pinnedEnabled ? 0 : steps.length);
  }, [pinnedEnabled]);

  // Scroll progress → visible step count (md+ only)
  useEffect(() => {
    if (!pinnedEnabled) return;
    const el = trackRef.current;
    if (!el) return;
    let rAf = 0;
    const updateFromScroll = () => {
      if (rAf) return;
      rAf = window.requestAnimationFrame(() => {
        rAf = 0;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const totalScrollable = Math.max(rect.height - vh, 1);
        // progress 0..1 while the sticky is pinned
        const progressed = Math.min(Math.max(-rect.top, 0), totalScrollable) / totalScrollable;
        // Reveal cumulatively: in first third show step 1, then 2, then 3
        const count =
          progressed <= 0
            ? 0
            : Math.min(steps.length, Math.max(1, Math.floor(progressed * steps.length) + 0));
        setVisibleCount(count);
      });
    };
    updateFromScroll();
    window.addEventListener('scroll', updateFromScroll, { passive: true });
    window.addEventListener('resize', updateFromScroll);
    return () => {
      window.removeEventListener('scroll', updateFromScroll);
      window.removeEventListener('resize', updateFromScroll);
      if (rAf) cancelAnimationFrame(rAf);
    };
  }, [pinnedEnabled]);

  return (
    <section id="how-it-works" className="py-28 bg-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div
          ref={headerRef}
          className={`text-center mb-20 transition-all duration-700 ${
            headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">
            Three Steps to a Smarter Sales Machine
          </h2>
        </div>

        {/* Mobile: stacked with per-step observers */}
        <div className="grid grid-cols-1 gap-12 mb-20 md:hidden">
          {steps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </div>

        {/* md+: pinned track — scroll progress reveals 01 → 02 → 03 */}
        <div ref={trackRef} className="hidden md:block relative mb-20" style={{ height: '240vh' }}>
          <div className="sticky top-24">
            <div className="grid grid-cols-3 gap-12">
              {steps.map((step, index) => {
                const isShown = index < visibleCount;
                return (
                  <div
                    key={step.number}
                    className={`text-center transition-all duration-500 ${
                      isShown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                    }`}
                  >
                    <div className="text-6xl font-black text-[#2563eb]/10 mb-4">{step.number}</div>
                    <div className="w-16 h-16 rounded-2xl bg-[#2563eb]/10 flex items-center justify-center mx-auto mb-5">
                      <step.icon className="w-8 h-8 text-[#2563eb]" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-3">{step.title}</h3>
                    <p className="text-slate-500 leading-relaxed max-w-sm mx-auto">{step.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mock UI card */}
        <div
          ref={cardRef}
          className={`max-w-4xl mx-auto transition-all duration-700 ${
            cardVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <div className="rounded-2xl bg-[#0f1729] p-6 shadow-2xl border border-white/10">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
              <span className="ml-3 text-xs text-slate-500 font-mono">Agent Inbox</span>
            </div>
            <div className="flex gap-4">
              {/* Left — mock lead list */}
              <div className="w-1/3 space-y-2">
                {[
                  { name: 'Sarah Chen', badge: 'linkedin', status: 'pending' },
                  { name: 'Mike Torres', badge: 'email', status: 'replied' },
                  { name: 'Emma Liu', badge: 'linkedin', status: 'pending' },
                ].map((lead, i) => (
                  <div key={i} className={`rounded-lg p-3 ${i === 0 ? 'bg-[#2563eb]/20 border border-[#2563eb]/30' : 'bg-white/5'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white font-medium">{lead.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${lead.badge === 'linkedin' ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-500/20 text-slate-400'}`}>
                        {lead.badge}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">Thanks for reaching out...</div>
                  </div>
                ))}
              </div>
              {/* Right — mock detail */}
              <div className="flex-1 bg-white/5 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-full bg-[#2563eb]/20 flex items-center justify-center">
                    <Users className="w-4 h-4 text-[#60a5fa]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Sarah Chen</div>
                    <div className="text-xs text-slate-500">VP Sales at Meridian</div>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-3 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-3 h-3 text-slate-500" />
                    <span className="text-[11px] text-slate-500">Last reply</span>
                  </div>
                  <p className="text-xs text-slate-300">Thanks for reaching out! We're actually looking at solutions in this space. Can we set up a call next week?</p>
                </div>
                <div className="bg-[#2563eb]/10 border border-[#2563eb]/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Inbox className="w-3 h-3 text-[#60a5fa]" />
                    <span className="text-[11px] text-[#60a5fa]">AI-drafted reply</span>
                  </div>
                  <p className="text-xs text-slate-300">Great to hear, Sarah! I'd love to walk you through how we've helped teams like Meridian...</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
