import { useEffect, useRef, useState } from 'react';
import { Bot, Lock, Shield, ServerCrash } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export const AIAgentsSection = () => {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.1 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  const bullets = [
    'Trained on your real sales data',
    'Access to proprietary sales repository',
    '1-click setup and deployment',
    'Continuous learning from new campaigns',
    'Your data never leaves your environment',
    'Custom-trained on your playbooks',
    'SOC-2 compliance standards',
    'Dedicated support & onboarding',
  ];

  return (
    <section ref={sectionRef} className="py-24 px-4">
      <div className="max-w-4xl mx-auto">
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">AI Sales Agent</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Pre-trained on your live campaign data and our proprietary sales repository
          </p>
        </div>

        <Card className={`relative overflow-hidden border-border/50 bg-card/50 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '0.3s' }}>
          <CardContent className="p-8">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
              <Bot className="w-7 h-7 text-primary" />
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
              {bullets.map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <Button onClick={() => navigate('/agents')} className="bg-primary hover:bg-primary/90">
              Learn More
            </Button>
          </CardContent>
        </Card>

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
