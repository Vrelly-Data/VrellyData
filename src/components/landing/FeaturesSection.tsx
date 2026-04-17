import { Database, Sparkles, Bot, ArrowRight } from 'lucide-react';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

const features = [
  {
    icon: Database,
    title: '100M+ Verified Prospects',
    description: 'Filter by job title, seniority, industry, location, and company size. Export contacts instantly with triple-verified emails and direct dials.',
    link: '/features#prospects',
  },
  {
    icon: Sparkles,
    title: 'Data Playground',
    description: 'Sync your data to get insights into your campaign copy and audience, plus a birds eye view of outbound activity.',
    link: '/features#playground',
  },
  {
    icon: Bot,
    title: 'AI Sales Agent',
    description: 'Builds your outbound campaigns, adds target prospects, manages responses and follow ups.',
    link: '/features#agent',
  },
];

export const FeaturesSection = () => {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section id="features" className="py-28 bg-[#f8fafc] relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" ref={ref}>
        <div className={`text-center mb-20 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">
            Everything You Need For Real Leads Right Now
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={`group relative bg-white rounded-2xl p-8 border border-slate-200 hover:border-[#2563eb]/40 hover:shadow-xl hover:shadow-[#2563eb]/5 transition-all duration-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${index * 150 + 200}ms` }}
            >
              <div className="w-14 h-14 rounded-xl bg-[#2563eb]/10 flex items-center justify-center mb-6 group-hover:bg-[#2563eb]/20 transition-colors">
                <feature.icon className="w-7 h-7 text-[#2563eb]" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h3>
              <p className="text-slate-500 leading-relaxed mb-6">{feature.description}</p>
              <a
                href={feature.link}
                className="inline-flex items-center gap-1 text-sm font-medium text-[#2563eb] hover:text-[#2563eb]/80 transition-colors"
              >
                Learn More <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
