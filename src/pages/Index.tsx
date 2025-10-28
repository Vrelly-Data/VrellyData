import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import AudienceBuilder from './AudienceBuilder';
import vrellyLogo from '@/assets/vrelly-logo.png';

const Index = () => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <img src={vrellyLogo} alt="Vrelly Data" className="h-6" />
          </header>
          <main className="flex-1 overflow-hidden">
            <AudienceBuilder />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Index;
