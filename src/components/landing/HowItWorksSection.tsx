import { useEffect } from 'react';
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

  // Intentionally remove pinned/scroll-reveal behavior on md+ for reliability.
  // Show all steps by default; individual cards still fade in when scrolled
  // into view via their own observers (StepCard).
  useEffect(() => {
    // no-op; preserves previous hook signature usage
  }, []);

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

        {/* Unified reliable layout: always show all three steps */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-20">
          {steps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
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
