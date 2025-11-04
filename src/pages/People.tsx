import { useState, useMemo } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PeopleRecords } from '@/components/records/PeopleRecords';
import { PeopleInsights } from '@/components/insights/PeopleInsights';
import { ListView } from '@/components/lists/ListView';
import vrellyLogo from '@/assets/vrelly-logo.png';
import { generateMockPeople } from '@/lib/mockData';
import { PersonEntity } from '@/types/audience';
import { SmartFilter } from '@/types/filterProperties';
import { evaluateSmartFilter } from '@/lib/smartFilterEvaluator';

export default function People() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<PersonEntity[]>(generateMockPeople(100));
  const [appliedFilter, setAppliedFilter] = useState<SmartFilter | null>(null);

  const filteredRecords = useMemo(() => {
    if (!appliedFilter) return records;
    return evaluateSmartFilter(records, appliedFilter);
  }, [records, appliedFilter]);

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
            <h1 className="text-lg font-semibold ml-4">People</h1>
          </header>
          <main className="flex-1 overflow-hidden">
            <Tabs defaultValue="records" className="h-full flex flex-col">
              <div className="border-b px-6">
                <TabsList>
                  <TabsTrigger value="records">Records</TabsTrigger>
                  <TabsTrigger value="insights">Insights</TabsTrigger>
                  <TabsTrigger value="lists">Lists</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="records" className="flex-1 m-0">
                <PeopleRecords 
                  records={records}
                  setRecords={setRecords}
                  appliedFilter={appliedFilter}
                  setAppliedFilter={setAppliedFilter}
                />
              </TabsContent>
              <TabsContent value="insights" className="flex-1 m-0">
                <PeopleInsights records={filteredRecords} />
              </TabsContent>
              <TabsContent value="lists" className="flex-1 m-0">
                <ListView entityType="person" />
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
