import vrellyLogo from '@/assets/vrelly-logo.png';

export const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-12 bg-muted/30 border-t border-border/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src={vrellyLogo} alt="Vrelly" className="h-[3.75rem]" />
            <span className="text-sm text-muted-foreground">Vrelly.com</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#" rel="nofollow" className="hover:text-foreground transition-colors">
              Terms of Service
            </a>
            <a href="#" rel="nofollow" className="hover:text-foreground transition-colors">
              Privacy Policy
            </a>
            <a href="#" rel="nofollow" className="hover:text-foreground transition-colors">
              Contact
            </a>
            <a href="/resources" className="hover:text-foreground transition-colors">
              Resources
            </a>
          </div>

          <p className="text-sm text-muted-foreground">
            © {currentYear} Vrelly. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
