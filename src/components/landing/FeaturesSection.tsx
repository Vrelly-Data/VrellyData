import { Database, Filter, BarChart3, Sparkles, RefreshCw, Bot } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

const features = [
  {
    icon: Database,
    title: 'Fully Verified Prospect Data',
    description: 'Triple-verified emails, skip-traced direct dials, 20+ enrichment fields. Affordable at scale.',
  },
  {
    icon: RefreshCw,
    title: 'Sync & Capture Sales Data',
    description: 'Connect your sales and marketing tools. We organize, compartmentalize, and analyze your outbound data automatically.',
  },
  {
    icon: BarChart3,
    title: 'Proprietary Sales Repository',
    description: 'Hundreds of thousands of real outbound campaigns with copy, performance metrics, and a proprietary scoring system.',
  },
  {
    icon: Sparkles,
    title: '1-Click Copy Improvement',
    description: 'AI rewrites your outreach copy using your historical performance, our sales repo, and our predictive model.',
  },
  {
    icon: Filter,
    title: '1-Click Audience Building',
    description: 'AI builds prospect audiences based on your wins, our repo intelligence, and predictive targeting.',
  },
  {
    icon: Bot,
    title: 'AI Sales Agent',
    description: '1-click setup for an AI agent trained on your live data, current sales trends, and our proprietary repository.',
  },
];

export const FeaturesSection = () => {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section id="features" className="py-24 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" ref={ref}>
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
            Everything You Need to
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> Win</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Six powerful pillars designed to transform your B2B sales intelligence
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card
              key={index}
              className={`group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
              style={{ transitionDelay: isVisible ? `${index * 100}ms` : '0ms' }}
            >
              <CardContent className="p-8">
                <div className="flex items-start gap-5">
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:animate-pulse-glow transition-colors">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2 text-foreground group-hover:text-primary transition-colors">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </CardContent>

              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
