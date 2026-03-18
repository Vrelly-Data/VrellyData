import { RefreshCw, BarChart3, Rocket } from 'lucide-react';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

const steps = [
  {
    icon: RefreshCw,
    title: 'Connect',
    description: 'Sync your Sales Data. We capture every campaign, sequence, and result.',
  },
  {
    icon: BarChart3,
    title: 'Analyze',
    description: 'Your data is scored, compartmentalized, and cross-referenced against our proprietary sales repository.',
  },
  {
    icon: Rocket,
    title: 'Act',
    description: '1-click to improve copy, build audiences, or launch an AI sales agent — all powered by real data.',
  },
];

export const HowItWorksSection = () => {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section id="how-it-works" className="py-24 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/4 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-500/4 rounded-full blur-3xl pointer-events-none" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" ref={ref}>
        <div className={`text-center mb-20 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
            How It
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> Works</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Three steps from raw data to AI-powered sales intelligence
          </p>
        </div>

        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-12 md:gap-0">
          {/* Connecting line */}
          <div className="hidden md:block absolute top-1/2 left-[15%] right-[15%] h-0.5 -translate-y-1/2">
            <div className={`h-full bg-gradient-to-r from-primary/40 via-primary to-primary/40 transition-all duration-1000 ease-out ${isVisible ? 'w-full' : 'w-0'}`} style={{ transitionDelay: '0.4s' }} />
          </div>

          {steps.map((step, index) => (
            <div
              key={index}
              className={`relative flex flex-col items-center text-center flex-1 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${index * 200 + 300}ms` }}
            >
              <div className="relative z-10 w-20 h-20 rounded-2xl bg-primary/10 border-2 border-primary/30 flex items-center justify-center mb-6 group hover:bg-primary/20 hover:border-primary/50 transition-all duration-300">
                <step.icon className="w-8 h-8 text-primary" />
                <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                  {index + 1}
                </div>
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">{step.title}</h3>
              <p className="text-muted-foreground max-w-xs leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>

        <div className={`text-center mt-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`} style={{ transitionDelay: '1s' }}>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Even if this is your first time sending outbound messaging like email and LinkedIn, simply sign up and use our copy and audience builder to get started in <span className="text-primary font-semibold">5 minutes</span>!
          </p>
        </div>
      </div>
    </section>
  );
};
