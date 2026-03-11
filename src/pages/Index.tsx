import { useEffect } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import AudienceBuilder from './AudienceBuilder';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { UserMenu } from '@/components/UserMenu';
import { toast } from 'sonner';

const Index = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (searchParams.get('checkout') === 'success') {
      queryClient.invalidateQueries({ queryKey: ['user-credits'] });
      toast.success('Subscription activated! Your credits are ready.');
      setSearchParams({});
    }
  }, []);

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
            <div className="ml-auto">
              <UserMenu />
            </div>
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
