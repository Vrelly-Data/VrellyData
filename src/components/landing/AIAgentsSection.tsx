import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import { Quote } from 'lucide-react';

const testimonials = [
  {
    quote: 'Thanks to Vrelly, our sales process has become more efficient and effective, resulting in increased revenue and growth for our business.',
    name: 'Eric Yohay',
    title: 'CEO, Next Act Ventures',
  },
  {
    quote: 'We were struggling with customer acquisition. Vrelly resulted in our first B2B clients within 30 days of launch!',
    name: 'Ines Gramegna',
    title: 'Co Founder, Skylyte',
  },
  {
    quote: 'Vrelly helped us go from Google sheets to software and automation. We have now stream lined sales, boosted productivity and revenue, and are making informed decisions.',
    name: 'Matteo Echeverry',
    title: 'Owner, Passive Apex',
  },
];

export const AIAgentsSection = () => {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section ref={ref} className="py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">
            Built by Sales Practitioners. For Sales Practitioners.
          </h2>
        </div>

        <div className={`overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)] transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '300ms' }}>
          <div className="flex gap-8 animate-scroll-left w-max">
            {[...testimonials, ...testimonials].map((t, i) => (
              <div
                key={`${t.name}-${i}`}
                className="shrink-0 w-[400px] bg-[#f8fafc] rounded-2xl p-8 border border-slate-200"
              >
                <Quote className="w-8 h-8 text-[#2563eb]/20 mb-4" />
                <blockquote className="text-base text-slate-700 leading-relaxed font-medium mb-6">
                  "{t.quote}"
                </blockquote>
                <div>
                  <div className="text-sm font-bold text-slate-900">{t.name}</div>
                  <div className="text-sm text-slate-500">{t.title}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
