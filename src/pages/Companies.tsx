import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanyRecords } from '@/components/records/CompanyRecords';
import { CompanyInsights } from '@/components/insights/CompanyInsights';
import { ListView } from '@/components/lists/ListView';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { useRecordsFromDatabase } from '@/hooks/useRecordsFromDatabase';
import { Loader2 } from 'lucide-react';
import { UserMenu } from '@/components/UserMenu';
import { CompanyEntity } from '@/types/audience';

export default function Companies() {
  const navigate = useNavigate();
  const { records, isLoading } = useRecordsFromDatabase('company');

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
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Loading records...</p>
                </div>
              </div>
            ) : (
              <Tabs defaultValue="records" className="h-full flex flex-col">
                <div className="border-b px-6">
                  <TabsList>
                    <TabsTrigger value="records">Records</TabsTrigger>
                    <TabsTrigger value="insights">Insights</TabsTrigger>
                    <TabsTrigger value="lists">Lists</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="records" className="flex-1 m-0">
                  <CompanyRecords />
                </TabsContent>
                <TabsContent value="insights" className="flex-1 m-0">
                  <CompanyInsights records={records as CompanyEntity[]} />
                </TabsContent>
                <TabsContent value="lists" className="flex-1 m-0">
                  <ListView entityType="company" />
                </TabsContent>
              </Tabs>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
