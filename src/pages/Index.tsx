import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import AudienceBuilder from './AudienceBuilder';

const Index = () => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger className="ml-2" />
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
