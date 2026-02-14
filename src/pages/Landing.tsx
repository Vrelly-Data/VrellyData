import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { AIAgentsSection } from '@/components/landing/AIAgentsSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { SignUpSection } from '@/components/landing/SignUpSection';
import { Footer } from '@/components/landing/Footer';

const Landing = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <AIAgentsSection />
      <PricingSection />
      <SignUpSection />
      <Footer />
    </div>
  );
};

export default Landing;
