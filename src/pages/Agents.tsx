import { useEffect, useRef, useState } from 'react';
import { Bot, Brain, Database, MessageSquare, Shield, Zap, Lock, TrendingUp, ArrowRight, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

const features = [
  {
    icon: Brain,
    title: 'Multi-Channel Agent Trained on Your Data',
    description: 'Your agent gets smarter with every campaign. Real results feed back into the model — improving reply rates, booking rates, and conversion over time.',
    delay: '0ms',
  },
  {
    icon: Database,
    title: 'Proprietary Sales Repository',
    description: 'Built on millions of email, LinkedIn, and Direct Message campaigns. Your agent draws from a knowledge base that took years to build.',
    delay: '100ms',
  },
  {
    icon: MessageSquare,
    title: 'Accurate Prospect Database',
    description: 'Immediate access to verified contact information — emails, direct dials, and LinkedIn profiles for the exact people you want to reach.',
    delay: '200ms',
  },
  {
    icon: Zap,
    title: 'Built Specifically for You',
    description: 'Not a generic template. A custom agent that understands your ICP, your tone, your offer, and your goals from day one.',
    delay: '300ms',
  },
  {
    icon: Shield,
    title: 'Custom Security & Guardrails',
    description: 'Security measures, guardrails, and skills are all custom built for your business and implemented into your agent. Your data stays yours.',
    delay: '400ms',
  },
  {
    icon: TrendingUp,
    title: 'Continuous Learning',
    description: 'As your campaigns run, your agent refines its approach automatically — getting sharper every week without any manual work from your team.',
    delay: '500ms',
  },
];

const stats = [
  { value: '100M+', label: 'Prospects in database' },
  { value: '1M+', label: 'Outbound campaigns analyzed' },
  { value: '3x', label: 'Average reply rate lift' },
  { value: '< 48h', label: 'Agent deployment time' },
];

function AnimatedGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0" style={{
        backgroundImage: `linear-gradient(rgba(99,102,241,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.06) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }} />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
    </div>
  );
}

function TypewriterText({ texts }: { texts: string[] }) {
  const [currentText, setCurrentText] = useState('');
  const [textIndex, setTextIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const target = texts[textIndex];
    const timeout = setTimeout(() => {
      if (!deleting) {
        if (charIndex < target.length) {
          setCurrentText(target.slice(0, charIndex + 1));
          setCharIndex(c => c + 1);
        } else {
          setTimeout(() => setDeleting(true), 2000);
        }
      } else {
        if (charIndex > 0) {
          setCurrentText(target.slice(0, charIndex - 1));
          setCharIndex(c => c - 1);
        } else {
          setDeleting(false);
          setTextIndex(i => (i + 1) % texts.length);
        }
      }
    }, deleting ? 40 : 80);
    return () => clearTimeout(timeout);
  }, [charIndex, deleting, textIndex, texts]);

  return (
    <span className="text-primary">
      {currentText}
      <span className="animate-pulse">|</span>
    </span>
  );
}

export default function Agents() {
  const navigate = useNavigate();
  const heroRef = useInView(0.1);
  const statsRef = useInView(0.1);
  const featuresRef = useInView(0.1);
  const ctaRef = useInView(0.1);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 overflow-hidden">
        <AnimatedGrid />
        <div ref={heroRef.ref} className={`relative max-w-4xl mx-auto text-center transition-all duration-1000 ${heroRef.inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5 text-primary text-sm font-medium mb-8">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Now deploying AI agents for B2B sales teams
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
            Your AI Sales Agent<br />
            that{' '}
            <TypewriterText texts={['books more meetings', 'learns from every reply', 'never sleeps', 'grows your pipeline']} />
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            A multi-channel agent trained on your data, powered by our proprietary sales repository, and built to grow your business on autopilot.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button onClick={() => navigate('/auth?tab=signup')} size="lg" className="bg-primary hover:bg-primary/90 gap-2">
              Get Started <ArrowRight className="w-4 h-4" />
            </Button>
            <Button onClick={() => navigate('/')} size="lg" variant="outline">
              Back to Home
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-4 border-y border-border/50 bg-card/30">
        <div ref={statsRef.ref} className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className={`text-center transition-all duration-700 ${statsRef.inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className="text-3xl md:text-4xl font-bold text-primary mb-2">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div ref={featuresRef.ref} className="max-w-6xl mx-auto">
          <div className={`text-center mb-16 transition-all duration-700 ${featuresRef.inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Everything your agent needs to win</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every component is purpose-built for B2B sales — not adapted from a generic AI tool.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className={`group p-6 rounded-xl border border-border/50 bg-card/50 hover:border-primary/30 hover:bg-card transition-all duration-500 ${featuresRef.inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
                style={{ transitionDelay: feature.delay }}
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-3">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                <div className="mt-4 flex items-center gap-1 text-primary text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4 bg-card/30 border-y border-border/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-foreground text-center mb-16">How it works</h2>
          <div className="space-y-0">
            {[
              { step: '01', title: 'We learn your business', desc: 'We onboard your playbooks, your ICP, your past campaigns, and your tone. Your agent knows your business before sending a single message.' },
              { step: '02', title: 'Your agent goes live', desc: 'Within 48 hours, your agent is deployed across email, LinkedIn, and direct message — reaching your ideal prospects at scale.' },
              { step: '03', title: 'It learns and improves', desc: 'Every reply, every meeting booked, every deal closed feeds back into the model. Your agent gets better every week automatically.' },
            ].map((item, i) => (
              <div key={item.step} className="flex gap-8 items-start py-8 border-b border-border/50 last:border-0">
                <div className="text-5xl font-bold text-primary/20 w-16 shrink-0">{item.step}</div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 px-4 overflow-hidden">
        <AnimatedGrid />
        <div ref={ctaRef.ref} className={`relative max-w-2xl mx-auto text-center transition-all duration-700 ${ctaRef.inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="flex items-center justify-center gap-6 mb-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><Lock className="w-4 h-4 text-primary" /><span>Data Isolation</span></div>
            <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /><span>SOC-2 Compliance</span></div>
            <div className="flex items-center gap-2"><Bot className="w-4 h-4 text-primary" /><span>Custom Built</span></div>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Ready to deploy your agent?</h2>
          <p className="text-muted-foreground mb-8 text-lg">Get started today and have your AI sales agent running within 48 hours.</p>
          <Button onClick={() => navigate('/auth?tab=signup')} size="lg" className="bg-primary hover:bg-primary/90 gap-2">
            Get Started <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
