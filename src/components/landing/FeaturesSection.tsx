import { Database, Filter, BarChart3, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    icon: Database,
    title: 'Fully Enriched Data',
    description: 'Complete B2B profiles with 20+ data points per contact. Skip trace wireless phone numbers, triple verified email addresses.',
  },
  {
    icon: Filter,
    title: 'Easy Filters',
    description: 'Easily unlock and create audiences for B2B outreach with easy export.',
  },
  {
    icon: BarChart3,
    title: 'Visual Insights',
    description: 'Interactive dashboards to understand your audience. Analyze demographics, industries, and company sizes at a glance.',
  },
  {
    icon: Sparkles,
    title: 'Prospecting Playground',
    description: 'Build and filter audiences with our intuitive builder. Combine multiple criteria to find your perfect-fit prospects.',
  },
];

export const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
            Everything You Need to
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> Win</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Powerful features designed to supercharge your B2B prospecting workflow
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, index) => (
            <Card 
              key={index}
              className="group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
            >
              <CardContent className="p-8">
                <div className="flex items-start gap-5">
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
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
              
              {/* Subtle gradient overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
