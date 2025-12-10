import { useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataSourceTemplatesTab } from '@/components/admin/DataSourceTemplatesTab';
import { FreeDataTab } from '@/components/admin/FreeDataTab';
import { Button } from '@/components/ui/button';
import { Database, Upload, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { UserMenu } from '@/components/UserMenu';

export default function Admin() {
  const navigate = useNavigate();
  const [showCreateTemplateDialog, setShowCreateTemplateDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

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
              <div className="mb-6">
                <p className="text-muted-foreground">
                  Manage data source templates and uploads
                </p>
              </div>

              <div className="flex items-center gap-3 mb-6">
                <Button onClick={() => setShowCreateTemplateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Template
                </Button>
                <Button variant="outline" onClick={() => setShowUploadDialog(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload CSV
                </Button>
              </div>

              <Tabs defaultValue="templates" className="space-y-6">
                <TabsList>
                  <TabsTrigger value="templates" className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Templates
                  </TabsTrigger>
                  <TabsTrigger value="uploads" className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Uploads
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="templates">
                  <DataSourceTemplatesTab 
                    showCreateDialog={showCreateTemplateDialog}
                    onCloseCreateDialog={() => setShowCreateTemplateDialog(false)}
                  />
                </TabsContent>

                <TabsContent value="uploads">
                  <FreeDataTab 
                    showUploadDialog={showUploadDialog}
                    onCloseUploadDialog={() => setShowUploadDialog(false)}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
