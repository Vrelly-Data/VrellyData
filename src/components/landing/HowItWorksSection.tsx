import { RefreshCw, BarChart3, Rocket, Inbox, MessageSquare, Users } from 'lucide-react';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

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

export const HowItWorksSection = () => {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section id="how-it-works" className="py-28 bg-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" ref={ref}>
        <div className={`text-center mb-20 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">
            Three Steps to a Smarter Sales Machine
          </h2>
        </div>

        {/* Steps row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-10 md:mb-12 relative">
          {steps.map((step, index) => (
            <div
              key={step.number}
              className={`group text-center transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${index * 180 + 100}ms` }}
            >
              <div
                className={`hiw-number text-6xl font-black text-[#2563eb]/10 mb-4 ${isVisible ? 'hiw-number-visible' : ''}`}
                style={{ transitionDelay: `${index * 180 + 80}ms` }}
              >
                {step.number}
              </div>
              <div
                className={`hiw-tile w-16 h-16 rounded-2xl bg-[#2563eb]/10 flex items-center justify-center mx-auto mb-5 ${isVisible ? 'hiw-tile-visible' : ''}`}
                style={{
                  transitionDelay: `${index * 180 + 140}ms`,
                  // CSS variable to coordinate sequential delays for icon + ring/glow
                  ['--hiw-delay' as any]: `${index * 180 + 160}ms`,
                }}
              >
                <step.icon
                  className={`hiw-icon w-8 h-8 text-[#2563eb] ${isVisible ? 'hiw-icon-animate' : ''}`}
                  style={{ animationDelay: `${index * 180 + 200}ms`, ['--hiw-delay' as any]: `${index * 180 + 200}ms` }}
                />
              </div>
              <h3
                className={`hiw-text ${isVisible ? 'hiw-text-visible' : ''} text-xl font-bold text-slate-900 mb-2`}
                style={{ transitionDelay: `${index * 180 + 220}ms` }}
              >
                {step.title}
              </h3>
              <p
                className={`hiw-text ${isVisible ? 'hiw-text-visible' : ''} text-slate-500 leading-relaxed max-w-sm mx-auto`}
                style={{ transitionDelay: `${index * 180 + 280}ms` }}
              >
                {step.description}
              </p>
            </div>
          ))}
        </div>
        {/* Thin progress/connector line under steps (fills left → right) */}
        <div
          aria-hidden="true"
          className={`hidden md:block w-full ${isVisible ? 'hiw-connector-visible' : ''}`}
        >
          <div className="hiw-connector mx-auto" style={{ maxWidth: '56rem' }}>
            <span className="hiw-connector-progress" />
            {/* Optional step dots that light up in sequence */}
            <span className="hiw-step-dot" style={{ left: '12%', ['--i' as any]: 0 }} />
            <span className="hiw-step-dot" style={{ left: '50%', ['--i' as any]: 1 }} />
            <span className="hiw-step-dot" style={{ left: '88%', ['--i' as any]: 2 }} />
          </div>
        </div>

        {/* Mock UI card */}
        <div className={`max-w-4xl mx-auto transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '720ms' }}>
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
