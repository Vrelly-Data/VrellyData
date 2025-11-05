import { useState, useCallback, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Save, Download, Users, Building2, Info } from 'lucide-react';
import { useAudienceStore } from '@/stores/audienceStore';
import { audienceLabClient } from '@/lib/audienceLabClient';
import { useToast } from '@/hooks/use-toast';
import { exportPeopleToCSV, exportCompaniesToCSV } from '@/lib/csvExport';
import { PersonEntity, CompanyEntity } from '@/types/audience';
import { FilterBuilder } from '@/components/search/FilterBuilder';
import { CreditBalance } from '@/components/search/CreditBalance';
import { PaginationControls } from '@/components/search/PaginationControls';
import { FilterBuilderState } from '@/lib/filterConversion';
import { UnlockConfirmDialog } from '@/components/search/UnlockConfirmDialog';
import { useUnlockedRecords } from '@/hooks/useUnlockedRecords';
import { useCreditCheck } from '@/hooks/useCreditCheck';
import { usePersistRecords } from '@/hooks/usePersistRecords';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PreviewTableRow } from '@/components/search/PreviewTableRow';

export default function AudienceBuilder() {
  const { toast } = useToast();
  const { 
    currentType, 
    setCurrentType, 
    setResults, 
    setTotalEstimate, 
    setLoading, 
    loading, 
    results, 
    totalEstimate,
    currentPage,
    perPage,
    totalPages,
    setCurrentPage,
    setPerPage,
    setTotalPages,
  } = useAudienceStore();

  const { isUnlocked, markAsUnlocked } = useUnlockedRecords(currentType);
  const { hasEnoughCredits, deductCredits, getCurrentCredits } = useCreditCheck();
  const { saveRecords } = usePersistRecords();
  
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockDialogConfig, setUnlockDialogConfig] = useState<{
    totalRecords: number;
    alreadyUnlocked: number;
    needUnlock: number;
    action: 'export' | 'list' | 'send';
    currentCredits: number;
  } | null>(null);

  // Debounced search for real-time preview
  const debounceTimerRef = useRef<NodeJS.Timeout>();
  
  const debouncedSearch = useCallback((filterState: FilterBuilderState) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      handleSearch(filterState);
    }, 800); // 800ms delay after user stops typing
  }, [currentType, currentPage, perPage]);
  
  const handleSearch = async (filterState: FilterBuilderState) => {
    setLoading(true);
    
    try {
      const params = {
        filters: {
          type: currentType,
          where: { field: 'all', op: 'exists' as const },
        },
        filterState,
        page: currentPage,
        perPage,
      };
      
      if (currentType === 'person') {
        const response = await audienceLabClient.searchPeople(params);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
        if (response.pagination) {
          setTotalPages(response.pagination.total_pages);
        }
      } else {
        const response = await audienceLabClient.searchCompanies(params);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
        if (response.pagination) {
          setTotalPages(response.pagination.total_pages);
        }
      }
      
      toast({
        title: 'Search complete',
        description: `Found ${totalEstimate} results`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to search. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  

  const handleExport = async () => {
    if (results.length === 0) {
      toast({
        title: 'No data to export',
        description: 'Please run a search first',
        variant: 'destructive',
      });
      return;
    }

    // Calculate unlock cost
    const alreadyUnlocked = results.filter(r => isUnlocked(r.id)).length;
    const needUnlock = results.length - alreadyUnlocked;

    if (needUnlock > 0) {
      // Fetch current credits before showing dialog
      const credits = await getCurrentCredits();
      setUnlockDialogConfig({
        totalRecords: results.length,
        alreadyUnlocked,
        needUnlock,
        action: 'export',
        currentCredits: credits,
      });
      setShowUnlockDialog(true);
    } else {
      // All already unlocked, export directly
      await performExport();
    }
  };

  const performExport = async () => {
    try {
      if (currentType === 'person') {
        exportPeopleToCSV(results as PersonEntity[]);
      } else {
        exportCompaniesToCSV(results as CompanyEntity[]);
      }

      // Save to people/company records
      await saveRecords(results, currentType, 'export');
      
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

  const handleUnlockAndExport = async () => {
    if (!unlockDialogConfig) return;

    const lockedRecords = results.filter(r => !isUnlocked(r.id));
    const { needUnlock } = unlockDialogConfig;

    // Check credits
    const enoughCredits = await hasEnoughCredits(needUnlock);
    if (!enoughCredits) {
      toast({
        title: 'Insufficient credits',
        description: `You need ${needUnlock} credits but don't have enough.`,
        variant: 'destructive',
      });
      return;
    }

    // Deduct credits
    const result = await deductCredits(needUnlock);
    if (!result.success) {
      toast({
        title: 'Error',
        description: 'Failed to deduct credits',
        variant: 'destructive',
      });
      return;
    }

    // Mark as unlocked
    await markAsUnlocked(
      lockedRecords.map(r => r.id),
      lockedRecords
    );

    setShowUnlockDialog(false);
    
    // Perform export
    await performExport();
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

          <div className="flex-1 overflow-auto">
            <TabsContent value="person" className="mt-0 h-full">
              <div className="grid grid-cols-[380px_1fr] gap-4 h-full p-4">
                {/* Left: Filter Builder */}
                <div className="h-full overflow-hidden">
                  <FilterBuilder 
                    entityType="person" 
                    onSearch={handleSearch}
                    onChange={debouncedSearch}
                  />
                </div>
                
                {/* Right: Results */}
                  <div className="space-y-4 h-full flex flex-col">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        {totalEstimate > 0 && `${totalEstimate} results found`}
                      </div>
                      <CreditBalance />
                    </div>

                    {results.length > 0 && (
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          Preview Mode: Email and LinkedIn are blurred. Export, Save to List, or Send to unlock and use credits.
                        </AlertDescription>
                      </Alert>
                    )}

                  {loading && (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-muted-foreground">Searching...</div>
                    </div>
                  )}

                  {!loading && results.length > 0 && (
                    <>
                      <div className="border rounded-lg divide-y overflow-auto flex-1 max-h-[calc(100vh-400px)]">
                        {results.map((person: any) => (
                          <PreviewTableRow
                            key={person.id}
                            entity={person}
                            entityType="person"
                            isUnlocked={isUnlocked}
                          />
                        ))}
                      </div>
                      
                      {totalPages > 1 && (
                        <PaginationControls
                          currentPage={currentPage}
                          totalPages={totalPages}
                          perPage={perPage}
                          totalResults={totalEstimate}
                          onPageChange={setCurrentPage}
                          onPerPageChange={setPerPage}
                        />
                      )}
                    </>
                  )}
                  
                  {!loading && results.length === 0 && totalEstimate === 0 && (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      Build your filters and click Search to find people
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="company" className="mt-0 h-full">
              <div className="grid grid-cols-[380px_1fr] gap-4 h-full p-4">
                {/* Left: Filter Builder */}
                <div className="h-full overflow-hidden">
                  <FilterBuilder 
                    entityType="company"
                    onSearch={handleSearch}
                    onChange={debouncedSearch}
                  />
                </div>
                
                {/* Right: Results */}
                  <div className="space-y-4 h-full flex flex-col">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        {totalEstimate > 0 && `${totalEstimate} results found`}
                      </div>
                      <CreditBalance />
                    </div>

                    {results.length > 0 && (
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          Preview Mode: Contact details are blurred. Export, Save to List, or Send to unlock and use credits.
                        </AlertDescription>
                      </Alert>
                    )}

                  {loading && (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-muted-foreground">Searching...</div>
                    </div>
                  )}

                  {!loading && results.length > 0 && (
                    <>
                      <div className="border rounded-lg divide-y overflow-auto flex-1 max-h-[calc(100vh-400px)]">
                        {results.map((company: any) => (
                          <PreviewTableRow
                            key={company.id}
                            entity={company}
                            entityType="company"
                            isUnlocked={isUnlocked}
                          />
                        ))}
                      </div>
                      
                      {totalPages > 1 && (
                        <PaginationControls
                          currentPage={currentPage}
                          totalPages={totalPages}
                          perPage={perPage}
                          totalResults={totalEstimate}
                          onPageChange={setCurrentPage}
                          onPerPageChange={setPerPage}
                        />
                      )}
                    </>
                  )}
                  
                  {!loading && results.length === 0 && totalEstimate === 0 && (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      Build your filters and click Search to find companies
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {unlockDialogConfig && (
        <UnlockConfirmDialog
          open={showUnlockDialog}
          onOpenChange={setShowUnlockDialog}
          totalRecords={unlockDialogConfig.totalRecords}
          alreadyUnlocked={unlockDialogConfig.alreadyUnlocked}
          needUnlock={unlockDialogConfig.needUnlock}
          currentCredits={unlockDialogConfig.currentCredits}
          onConfirm={handleUnlockAndExport}
          onCancel={() => setShowUnlockDialog(false)}
          action={unlockDialogConfig.action}
        />
      )}
    </div>
  );
}
