import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

const tiers = [
  { name: 'Starter', price: 75, tagline: 'For growing teams' },
  { name: 'Professional', price: 150, tagline: 'For scaling businesses', popular: true },
  { name: 'Enterprise', price: 350, tagline: 'For large organizations' },
];

export const PricingSection = () => {
  const navigate = useNavigate();
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section id="pricing" className="py-28 bg-gradient-to-b from-[#0f1729] to-[#1a2d5a] relative overflow-hidden">
      {/* Subtle glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#2563eb]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10" ref={ref}>
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
            Simple Pricing. No Surprises.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-14">
          {tiers.map((tier, index) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl p-8 text-center transition-all duration-700 ${
                tier.popular
                  ? 'bg-white/10 border-2 border-[#2563eb]/50 shadow-lg shadow-[#2563eb]/10'
                  : 'bg-white/5 border border-white/10'
              } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${index * 150 + 200}ms` }}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[#2563eb] text-white text-xs font-semibold">
                  Most Popular
                </div>
              )}
              <h3 className="text-lg font-bold text-white mb-1">{tier.name}</h3>
              <p className="text-sm text-slate-400 mb-6">{tier.tagline}</p>
              <div className="mb-6">
                <span className="text-5xl font-extrabold text-white">${tier.price}</span>
                <span className="text-slate-400">/mo</span>
              </div>
            </div>
          ))}
        </div>

        <div className={`text-center transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`} style={{ transitionDelay: '700ms' }}>
          <Button
            size="lg"
            onClick={() => navigate('/pricing')}
            className="text-base px-8 py-6 bg-[#2563eb] hover:bg-[#2563eb]/90 text-white shadow-lg shadow-[#2563eb]/25"
          >
            See Full Pricing
          </Button>
        </div>
      </div>
    </section>
  );
};
