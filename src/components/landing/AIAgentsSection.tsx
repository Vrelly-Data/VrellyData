import { Shield, Bot, Building2, Lock, ServerCrash } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useScrollAnimation } from '@/hooks/useScrollAnimation';

export const AIAgentsSection = () => {
  const { ref, isVisible } = useScrollAnimation();
  const navigate = useNavigate();

  return (
    <section className="py-24 bg-muted/30 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" ref={ref}>
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-6">
            <Shield className="w-4 h-4" />
            <span>Security-First AI</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">
            AI Sales Agents That Prioritize
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> Your Data</span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We build AI sales agents trained on real performance data — with enterprise-grade security and full data isolation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Vrelly Sales Agent */}
          <Card className={`relative overflow-hidden border-primary/30 bg-gradient-to-br from-card to-primary/5 transition-all duration-700 ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'}`} style={{ transitionDelay: '0.3s' }}>
            <CardContent className="p-8">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-3">Vrelly Sales Agent</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Pre-trained on your live campaign data and our proprietary repository of hundreds of thousands of real outbound campaigns. Set up in 1 click.
              </p>
              <ul className="space-y-3 mb-8">
                {['Trained on your real sales data', 'Access to proprietary sales repository', '1-click setup and deployment', 'Continuous learning from new campaigns'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button onClick={() => navigate('/auth')} className="bg-primary hover:bg-primary/90">
                Get Started Free
              </Button>
            </CardContent>
          </Card>

          {/* Custom Enterprise Agent */}
          <Card className={`relative overflow-hidden border-border/50 bg-card/50 transition-all duration-700 ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`} style={{ transitionDelay: '0.5s' }}>
            <CardContent className="p-8">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Building2 className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-3">Custom Enterprise Agent</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Built for your company, your data, your rules. Fully isolated AI sales agent with no third-party data sharing.
              </p>
              <ul className="space-y-3 mb-8">
                {['Your data never leaves your environment', 'Custom-trained on your playbooks', 'SOC-2 compliance standards', 'Dedicated support & onboarding'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button variant="outline">
                Contact Sales
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Trust signals */}
        <div className={`mt-12 flex flex-wrap items-center justify-center gap-8 text-sm text-muted-foreground transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`} style={{ transitionDelay: '0.7s' }}>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            <span>Data Isolation</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span>SOC-2 Compliance</span>
          </div>
          <div className="flex items-center gap-2">
            <ServerCrash className="w-4 h-4 text-primary" />
            <span>No Third-Party Training</span>
          </div>
        </div>
      </div>
    </section>
  );
};
