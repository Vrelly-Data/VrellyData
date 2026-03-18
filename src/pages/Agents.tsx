import { Bot, Brain, Database, MessageSquare, Shield, Zap, Lock, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

const features = [
  {
    icon: Brain,
    title: 'Multi Channel Agent Trained on Your Data',
    description: 'Your agent will get smarter based on real results and grow as it grows your business. Every campaign, every reply, every conversion feeds back into making your agent more effective.',
  },
  {
    icon: Database,
    title: 'Immediate Access to Sales Repository',
    description: 'Built on millions of email, LinkedIn, and Direct Message campaigns. Your agent draws from a proprietary knowledge base that took years to build.',
  },
  {
    icon: MessageSquare,
    title: 'Accurate Prospect Contact Database',
    description: 'Immediate access to accurate prospect contact information. Your agent reaches the right people with verified emails, direct dials, and LinkedIn profiles.',
  },
  {
    icon: Zap,
    title: 'Built Specifically for You',
    description: 'Agents are built specifically for your business. Not a generic template — a custom agent that understands your ICP, your tone, your offer, and your goals.',
  },
  {
    icon: Shield,
    title: 'Custom Security & Guardrails',
    description: 'Security measures, guardrails, and skills are all custom built for your business and implemented into your agent. Your data stays yours.',
  },
  {
    icon: TrendingUp,
    title: 'Continuous Learning',
    description: 'Your agent learns from every interaction. As your campaigns run, it refines its approach — improving reply rates, booking rates, and conversion over time.',
  },
];

export default function Agents() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="py-24 px-4 text-center border-b border-border/50">
        <div className="max-w-3xl mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Bot className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6">
            AI Sales Agent
          </h1>
          <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
            A multi-channel sales agent trained on your data, powered by our proprietary sales repository, and built to grow your business on autopilot.
          </p>
          <div className="flex gap-4 justify-center">
            <Button onClick={() => navigate('/auth?tab=signup')} size="lg" className="bg-primary hover:bg-primary/90">
              Get Started
            </Button>
            <Button onClick={() => navigate('/')} size="lg" variant="outline">
              Back to Home
            </Button>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature) => (
              <div key={feature.title} className="p-6 rounded-xl border border-border/50 bg-card/50">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-3">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-24 px-4 border-t border-border/50 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-6 mb-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-primary" />
              <span>Data Isolation</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span>SOC-2 Compliance</span>
            </div>
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-4">Ready to deploy your agent?</h2>
          <p className="text-muted-foreground mb-8">Get started today and have your AI sales agent running within days.</p>
          <Button onClick={() => navigate('/auth?tab=signup')} size="lg" className="bg-primary hover:bg-primary/90">
            Get Started
          </Button>
        </div>
      </div>
    </div>
  );
}
