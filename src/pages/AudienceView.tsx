import { useEffect } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import AudienceBuilder from './AudienceBuilder';
import { useAudienceStore } from '@/stores/audienceStore';
import { EntityType } from '@/types/audience';
import vrellyLogo from '@/assets/vrelly-logo.png';

interface AudienceViewProps {
  initialTab: EntityType;
}

export default function AudienceView({ initialTab }: AudienceViewProps) {
  const { setCurrentType } = useAudienceStore();
  
  useEffect(() => {
    setCurrentType(initialTab);
  }, [initialTab, setCurrentType]);
  
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
}
