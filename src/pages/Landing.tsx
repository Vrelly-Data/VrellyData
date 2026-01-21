import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { SignUpSection } from '@/components/landing/SignUpSection';
import { Footer } from '@/components/landing/Footer';

const Landing = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <PricingSection />
      <SignUpSection />
      <Footer />
    </div>
  );
};

export default Landing;
