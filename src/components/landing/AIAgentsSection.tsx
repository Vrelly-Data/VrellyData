import { useState } from 'react';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';
import { Quote, ChevronLeft, ChevronRight } from 'lucide-react';

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
  const [currentIndex, setCurrentIndex] = useState(0);

  const prev = () =>
    setCurrentIndex((i) => (i - 1 + testimonials.length) % testimonials.length);
  const next = () =>
    setCurrentIndex((i) => (i + 1) % testimonials.length);

  const t = testimonials[currentIndex];

  return (
    <section ref={ref} className="py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4">
            Built by Sales Practitioners. For Sales Practitioners.
          </h2>
        </div>

        <div
          className={`relative max-w-3xl mx-auto transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
          style={{ transitionDelay: '300ms' }}
        >
          <button
            onClick={prev}
            aria-label="Previous testimonial"
            className="absolute left-2 md:-left-16 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white border border-slate-200 hover:border-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 shadow-sm transition-colors z-10"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div
            key={currentIndex}
            className="bg-[#f8fafc] rounded-2xl p-8 md:p-12 border border-slate-200 animate-fade-in"
          >
            <Quote className="w-10 h-10 text-[#2563eb]/20 mb-4" />
            <blockquote className="text-lg md:text-xl text-slate-700 leading-relaxed font-medium mb-6">
              "{t.quote}"
            </blockquote>
            <div>
              <div className="text-base font-bold text-slate-900">{t.name}</div>
              <div className="text-sm text-slate-500">{t.title}</div>
            </div>
          </div>

          <button
            onClick={next}
            aria-label="Next testimonial"
            className="absolute right-2 md:-right-16 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white border border-slate-200 hover:border-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 shadow-sm transition-colors z-10"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
};
