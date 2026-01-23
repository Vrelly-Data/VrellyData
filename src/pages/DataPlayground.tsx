import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { UserMenu } from '@/components/UserMenu';
import { PlaygroundDashboard } from '@/components/playground/PlaygroundDashboard';

export default function DataPlayground() {
  const navigate = useNavigate();

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
            <h1 className="text-lg font-semibold ml-4">Data Playground</h1>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-hidden">
            <Tabs defaultValue="playground" className="h-full flex flex-col">
              <div className="border-b px-6">
                <TabsList>
                  <TabsTrigger value="playground">Playground</TabsTrigger>
                  <TabsTrigger value="copy">Copy</TabsTrigger>
                  <TabsTrigger value="people">People</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="playground" className="flex-1 m-0 p-6 overflow-auto">
                <PlaygroundDashboard />
              </TabsContent>
              <TabsContent value="copy" className="flex-1 m-0 p-6">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <h2 className="text-2xl font-semibold mb-2">Email Copy & Sequences</h2>
                  <p className="text-muted-foreground max-w-md">
                    View and remix your synced email sequences with AI assistance.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="people" className="flex-1 m-0 p-6">
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <h2 className="text-2xl font-semibold mb-2">Campaign Contacts</h2>
                  <p className="text-muted-foreground max-w-md">
                    View contacts synced from your campaigns with engagement metrics.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
