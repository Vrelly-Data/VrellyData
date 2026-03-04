import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { AIAgentsSection } from '@/components/landing/AIAgentsSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { SignUpSection } from '@/components/landing/SignUpSection';
import { Footer } from '@/components/landing/Footer';

const Landing = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const section = params.get('section');
    if (section) {
      setTimeout(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      navigate('/', { replace: true });
    }
  }, [location.search, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Vrelly | AI Sales Intelligence &amp; B2B Prospect Data</title>
        <meta name="description" content="Vrelly is an AI-powered B2B sales intelligence platform. Get enriched prospect data, AI-driven outreach copy, and campaign analytics to close more deals faster." />
      </Helmet>
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
