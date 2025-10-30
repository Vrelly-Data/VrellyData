import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanyRecords } from '@/components/records/CompanyRecords';
import { CompanyInsights } from '@/components/insights/CompanyInsights';
import vrellyLogo from '@/assets/vrelly-logo.png';

export default function Companies() {
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
              onClick={() => navigate('/')}
            />
            <h1 className="text-lg font-semibold ml-4">Companies</h1>
          </header>
          <main className="flex-1 overflow-hidden">
            <Tabs defaultValue="records" className="h-full flex flex-col">
              <div className="border-b px-6">
                <TabsList>
                  <TabsTrigger value="records">Records</TabsTrigger>
                  <TabsTrigger value="insights">Insights</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="records" className="flex-1 m-0">
                <CompanyRecords />
              </TabsContent>
              <TabsContent value="insights" className="flex-1 m-0">
                <CompanyInsights />
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
