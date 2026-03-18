import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-24">
        <h1 className="text-4xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-12">Last updated: March 17, 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using Vrelly ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Platform.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. Description of Service</h2>
            <p>Vrelly is a B2B sales intelligence platform that provides access to prospect data, AI-powered copy generation, audience building tools, and sales analytics. Services are provided on a subscription basis.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Account Responsibilities</h2>
            <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to notify us immediately of any unauthorized use of your account.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Acceptable Use</h2>
            <p>You agree to use the Platform only for lawful purposes and in accordance with applicable laws, including but not limited to CAN-SPAM, GDPR, and CCPA. You may not use the Platform to send unsolicited bulk messages, engage in fraudulent activity, or violate any applicable laws or regulations.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Data and Privacy</h2>
            <p>Your use of prospect data accessed through the Platform must comply with all applicable privacy laws. You are solely responsible for ensuring your outreach activities comply with relevant regulations in your jurisdiction.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Subscription and Billing</h2>
            <p>Subscriptions are billed on a monthly or annual basis. All fees are non-refundable except as required by law. We reserve the right to modify pricing with 30 days notice. Failure to pay may result in suspension or termination of your account.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Credits</h2>
            <p>Credits are consumed when accessing prospect contact information. Unused credits do not roll over between billing periods unless otherwise specified in your plan. Credits have no cash value and are non-transferable.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Intellectual Property</h2>
            <p>All content, features, and functionality of the Platform — including but not limited to the sales repository, AI models, and scoring systems — are owned by Vrelly and protected by applicable intellectual property laws.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. Limitation of Liability</h2>
            <p>Vrelly shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the Platform. Our total liability shall not exceed the amount paid by you in the three months preceding the claim.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. Termination</h2>
            <p>We reserve the right to suspend or terminate your account at any time for violation of these terms. You may cancel your subscription at any time through your account settings.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Changes to Terms</h2>
            <p>We may update these terms from time to time. We will notify you of significant changes via email. Continued use of the Platform after changes constitutes acceptance of the updated terms.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">12. Contact</h2>
            <p>For questions about these terms, please contact us at legal@vrelly.com</p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}
