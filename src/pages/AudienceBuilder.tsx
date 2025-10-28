import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Search, Save, Download, Users, Building2 } from 'lucide-react';
import { useAudienceStore } from '@/stores/audienceStore';
import { audienceLabClient } from '@/lib/audienceLabClient';
import { useToast } from '@/hooks/use-toast';
import { exportPeopleToCSV, exportCompaniesToCSV } from '@/lib/csvExport';
import { PersonEntity, CompanyEntity } from '@/types/audience';

export default function AudienceBuilder() {
  const { toast } = useToast();
  const { currentType, setCurrentType, setResults, setTotalEstimate, setLoading, loading, results, totalEstimate } = useAudienceStore();
  
  const handleSearch = async () => {
    setLoading(true);
    
    try {
      const params = {
        filters: {
          type: currentType,
          where: { field: 'all', op: 'exists' as const },
        },
      };
      
      if (currentType === 'person') {
        const response = await audienceLabClient.searchPeople(params);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
      } else {
        const response = await audienceLabClient.searchCompanies(params);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
      }
      
      toast({
        title: 'Search complete',
        description: `Found ${totalEstimate} results`,
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to search. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (results.length === 0) {
      toast({
        title: 'No data to export',
        description: 'Please run a search first',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      if (currentType === 'person') {
        exportPeopleToCSV(results as PersonEntity[]);
      } else {
        exportCompaniesToCSV(results as CompanyEntity[]);
      }
      
      toast({
        title: 'Export successful',
        description: `Exported ${results.length} ${currentType === 'person' ? 'people' : 'companies'}`,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: 'Failed to export data. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-2xl font-bold">Audience Builder</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save Audience
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={results.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs 
          value={currentType} 
          onValueChange={(value) => setCurrentType(value as 'person' | 'company')}
          className="h-full flex flex-col"
        >
          <div className="border-b px-4">
            <TabsList>
              <TabsTrigger value="person" className="gap-2">
                <Users className="h-4 w-4" />
                People
              </TabsTrigger>
              <TabsTrigger value="company" className="gap-2">
                <Building2 className="h-4 w-4" />
                Companies
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <TabsContent value="person" className="mt-0 h-full">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Button onClick={handleSearch} disabled={loading}>
                    <Search className="h-4 w-4 mr-2" />
                    {loading ? 'Searching...' : 'Search People'}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {totalEstimate > 0 && `${totalEstimate} results found`}
                  </span>
                </div>

                {results.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-3 font-medium grid grid-cols-7 gap-4 text-sm">
                      <div>Name</div>
                      <div>Title</div>
                      <div>Seniority</div>
                      <div>Department</div>
                      <div>Company</div>
                      <div>Location</div>
                      <div>Actions</div>
                    </div>
                    <div className="divide-y">
                      {results.map((person: any) => (
                        <div key={person.id} className="px-4 py-3 grid grid-cols-7 gap-4 text-sm hover:bg-muted/50">
                          <div className="font-medium">{person.name}</div>
                          <div>{person.title}</div>
                          <div>{person.seniority}</div>
                          <div>{person.department}</div>
                          <div>{person.company}</div>
                          <div>{person.location}</div>
                          <div>
                            <Button variant="ghost" size="sm">
                              View
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="company" className="mt-0 h-full">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Button onClick={handleSearch} disabled={loading}>
                    <Search className="h-4 w-4 mr-2" />
                    {loading ? 'Searching...' : 'Search Companies'}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {totalEstimate > 0 && `${totalEstimate} results found`}
                  </span>
                </div>

                {results.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-3 font-medium grid grid-cols-6 gap-4 text-sm">
                      <div>Company</div>
                      <div>Domain</div>
                      <div>Industry</div>
                      <div>Employees</div>
                      <div>Location</div>
                      <div>Actions</div>
                    </div>
                    <div className="divide-y">
                      {results.map((company: any) => (
                        <div key={company.id} className="px-4 py-3 grid grid-cols-6 gap-4 text-sm hover:bg-muted/50">
                          <div className="font-medium">{company.name}</div>
                          <div>{company.domain}</div>
                          <div>{company.industry}</div>
                          <div>{company.employeeCount}</div>
                          <div>{company.location}</div>
                          <div>
                            <Button variant="ghost" size="sm">
                              View
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
