import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataSourceTemplatesTab } from '@/components/admin/DataSourceTemplatesTab';
import { FreeDataTab } from '@/components/admin/FreeDataTab';
import { Database, FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { UserMenu } from '@/components/UserMenu';

export default function Admin() {
  const navigate = useNavigate();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
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
            <h1 className="text-lg font-semibold ml-4">Admin</h1>
            <div className="ml-auto">
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            <div className="max-w-6xl mx-auto">
              <div className="mb-8">
                <p className="text-muted-foreground mt-2">
                  Manage data source templates and free data
                </p>
              </div>

            <Tabs defaultValue="templates" className="space-y-6">
              <TabsList>
                <TabsTrigger value="templates" className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Data Source Templates
                </TabsTrigger>
                <TabsTrigger value="free-data" className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Free Data
                </TabsTrigger>
              </TabsList>

              <TabsContent value="templates">
                <DataSourceTemplatesTab />
              </TabsContent>

              <TabsContent value="free-data">
                <FreeDataTab />
              </TabsContent>
            </Tabs>
          </div>
        </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
