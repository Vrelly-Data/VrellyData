import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-24">
        <h1 className="text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-12">Last updated: March 17, 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">1. Information We Collect</h2>
            <p>We collect information you provide directly to us, including name, email address, company information, and payment details when you register for an account. We also collect usage data, log data, and analytics information when you use the Platform.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">2. How We Use Your Information</h2>
            <p>We use the information we collect to provide, maintain, and improve the Platform, process transactions, send transactional and promotional communications, and comply with legal obligations. We do not sell your personal information to third parties.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">3. Prospect Data</h2>
            <p>The prospect contact data available through the Platform is sourced from publicly available sources and licensed third-party providers. This data is provided for legitimate B2B sales and marketing purposes only. You are responsible for using this data in compliance with applicable privacy laws.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">4. Data Sharing</h2>
            <p>We may share your information with service providers who assist us in operating the Platform, such as payment processors and cloud infrastructure providers. These providers are contractually obligated to protect your information and use it only for the services they provide to us.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">5. Data Security</h2>
            <p>We implement industry-standard security measures to protect your information, including encryption in transit and at rest, access controls, and regular security audits. However, no method of transmission over the internet is 100% secure.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">6. Data Retention</h2>
            <p>We retain your account information for as long as your account is active or as needed to provide services. You may request deletion of your account and associated data by contacting us at privacy@vrelly.com.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">7. Cookies</h2>
            <p>We use cookies and similar tracking technologies to enhance your experience on the Platform, analyze usage patterns, and deliver relevant content. You can control cookie settings through your browser preferences.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">8. Your Rights</h2>
            <p>Depending on your location, you may have rights to access, correct, delete, or export your personal data. To exercise these rights, contact us at privacy@vrelly.com. We will respond to requests within 30 days.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">9. GDPR</h2>
            <p>If you are located in the European Economic Area, you have additional rights under GDPR including the right to data portability and the right to lodge a complaint with your local data protection authority.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">10. CCPA</h2>
            <p>If you are a California resident, you have the right to know what personal information we collect, the right to delete your personal information, and the right to opt out of the sale of your personal information. We do not sell personal information.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">11. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of significant changes via email or through the Platform. Your continued use after changes constitutes acceptance of the updated policy.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">12. Contact Us</h2>
            <p>For privacy-related questions or requests, contact us at privacy@vrelly.com</p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}
