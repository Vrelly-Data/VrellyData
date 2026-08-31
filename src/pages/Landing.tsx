import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation, useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/landing/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { AIAgentsSection } from '@/components/landing/AIAgentsSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { SignUpSection } from '@/components/landing/SignUpSection';
import { Footer } from '@/components/landing/Footer';
import { ResourcesTeaser } from '@/components/landing/ResourcesTeaser';

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
    <div className="min-h-screen">
      <Helmet>
        <title>Vrelly | AI Sales Agent Platform &amp; B2B Prospect Data</title>
        <meta name="description" content="Vrelly is an AI-powered B2B sales agent platform. Connect HeyReach or Smartlead, let AI handle replies, and book more meetings — powered by your real campaign data." />
        <link rel="canonical" href="https://www.vrelly.com/" />
      </Helmet>
      <Navbar />
      <HeroSection />
      <HowItWorksSection />
      <FeaturesSection />
      <AIAgentsSection />
      <ResourcesTeaser />
      <PricingSection />
      <SignUpSection />
      <Footer />
    </div>
  );
};

export default Landing;
