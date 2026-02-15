import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SUBSCRIPTION_TIERS } from '@/config/subscriptionTiers';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel';

const tiers = [
  {
    key: 'starter' as const,
    popular: false,
    features: ['10,000 credits per month', 'Advanced filters', 'Priority support', 'API access'],
    cta: 'Subscribe',
  },
  {
    key: 'professional' as const,
    popular: true,
    features: ['25,000 credits per month', 'All Starter features', 'Team collaboration', 'Custom integrations'],
    cta: 'Subscribe',
  },
  {
    key: 'enterprise' as const,
    popular: false,
    features: ['75,000 credits per month', 'All Professional features', 'Dedicated support', 'Custom solutions'],
    cta: 'Contact Sales',
  },
];

export const PricingSection = () => {
  const navigate = useNavigate();

  return (
    <section id="pricing" className="py-24 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
            Simple, Transparent
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> Pricing</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your prospecting needs. Scale as you grow.
          </p>
        </div>
        
        <Carousel
          opts={{
            align: "start",
            loop: true,
          }}
          className="w-full max-w-5xl mx-auto"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {tiers.map((tier) => {
              const tierData = SUBSCRIPTION_TIERS[tier.key];
              return (
                <CarouselItem key={tier.key} className="pl-2 md:pl-4 basis-full sm:basis-1/2 lg:basis-1/3">
                  <Card 
                    className={`relative overflow-hidden transition-all duration-300 hover:shadow-xl h-full ${
                      tier.popular 
                        ? 'border-primary shadow-lg shadow-primary/10' 
                        : 'border-border/50 hover:border-primary/30'
                    }`}
                  >
                    {tier.popular && (
                      <div className="absolute top-0 right-0 left-0">
                        <Badge className="w-full rounded-none rounded-t-lg justify-center py-1 bg-primary text-primary-foreground">
                          Most Popular
                        </Badge>
                      </div>
                    )}
                    
                    <CardHeader className={tier.popular ? 'pt-10' : ''}>
                      <CardTitle className="text-xl text-foreground">{tierData.label}</CardTitle>
                      <CardDescription className="text-muted-foreground">{tierData.description}</CardDescription>
                      <div className="mt-4">
                        <span className="text-4xl font-bold text-foreground">
                          ${tierData.price}
                        </span>
                        {tierData.price > 0 && (
                          <span className="text-muted-foreground">/month</span>
                        )}
                      </div>
                      <p className="text-sm text-primary font-medium mt-2">
                        {tierData.credits.toLocaleString()} credits
                      </p>
                    </CardHeader>
                    
                    <CardContent>
                      <ul className="space-y-3 mb-6">
                        {tier.features.map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Check className="w-4 h-4 text-primary flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      
                      <Button 
                        onClick={() => navigate('/auth')}
                        className={`w-full ${
                          tier.popular 
                            ? 'bg-primary hover:bg-primary/90' 
                            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                        }`}
                        variant={tier.popular ? 'default' : 'secondary'}
                      >
                        {tier.cta}
                      </Button>
                    </CardContent>
                  </Card>
                </CarouselItem>
              );
            })}
          </CarouselContent>
          <CarouselPrevious className="hidden sm:flex -left-12" />
          <CarouselNext className="hidden sm:flex -right-12" />
        </Carousel>
      </div>
    </section>
  );
};