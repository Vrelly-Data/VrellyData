import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { UserMenu } from '@/components/UserMenu';
import { useAgentAccess, useAgentConfig } from '@/hooks/useAgent';
import { AgentOnboarding } from '@/components/agent/AgentOnboarding';
import { AgentWorkspace } from '@/components/agent/AgentWorkspace';
import { Loader2 } from 'lucide-react';
import vrellyLogo from '@/assets/vrelly-logo.png';

export default function Agent() {
  const navigate = useNavigate();
  const { hasAccess, isLoading: accessLoading } = useAgentAccess();
  const { data: config, isLoading: configLoading } = useAgentConfig();

  useEffect(() => {
    if (!accessLoading && !hasAccess) {
      navigate('/dashboard');
    }
  }, [hasAccess, accessLoading, navigate]);

  if (accessLoading || configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasAccess) return null;

  const showOnboarding = !config || !config.onboarding_complete;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center gap-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
            <SidebarTrigger />
            <img
              src={vrellyLogo}
              alt="Vrelly Data"
              className="h-[4.5rem] cursor-pointer"
              onClick={() => navigate('/dashboard')}
            />
            <h1 className="text-lg font-semibold ml-4">Agent</h1>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {showOnboarding ? <AgentOnboarding /> : <AgentWorkspace />}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
