import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Shield, Zap, Clock } from 'lucide-react';

export const SignUpSection = () => {
  const navigate = useNavigate();

  return (
    <section className="py-24 bg-gradient-to-br from-primary/5 via-background to-primary/10 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
      
      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-6 text-foreground">
          Ready to Transform Your
          <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent"> Prospecting?</span>
        </h2>
        
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
          Join thousands of sales teams using Vrelly to find and connect with their ideal customers. 
          Start with 25 free credits today.
        </p>
        
        <Button 
          size="lg" 
          onClick={() => navigate('/auth')}
          className="text-lg px-10 py-7 bg-primary hover:bg-primary/90 shadow-xl shadow-primary/25"
        >
          Sign Up Now
          <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
        
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm">Enterprise-grade security</span>
          </div>
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm">No credit card required</span>
          </div>
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <span className="text-sm">Setup in 2 minutes</span>
          </div>
        </div>
      </div>
    </section>
  );
};
