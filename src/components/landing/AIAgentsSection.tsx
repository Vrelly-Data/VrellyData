import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import { Quote } from 'lucide-react';

export const AIAgentsSection = () => {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section ref={ref} className="py-28 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">
            Built by Sales Practitioners. For Sales Practitioners.
          </h2>
        </div>

        <div className={`relative bg-[#f8fafc] rounded-2xl p-10 md:p-14 border border-slate-200 text-center transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '300ms' }}>
          <Quote className="w-10 h-10 text-[#2563eb]/20 mx-auto mb-6" />
          <blockquote className="text-xl md:text-2xl text-slate-700 leading-relaxed font-medium mb-8">
            "Vrelly is the first tool that actually learns from our campaigns. The AI drafts are better than what our reps write."
          </blockquote>
          <div>
            <div className="text-base font-bold text-slate-900">Nicolas R.</div>
            <div className="text-sm text-slate-500">Founder, SQR Studio</div>
          </div>
        </div>
      </div>
    </section>
  );
};
