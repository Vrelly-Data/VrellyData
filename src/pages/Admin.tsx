import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataSourceTemplatesTab } from '@/components/admin/DataSourceTemplatesTab';
import { FreeDataTab } from '@/components/admin/FreeDataTab';
import { Database, FileSpreadsheet } from 'lucide-react';

export default function Admin() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-6xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold">Admin</h1>
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
    </SidebarProvider>
  );
}
