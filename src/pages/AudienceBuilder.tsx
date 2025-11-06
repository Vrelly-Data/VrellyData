import { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, Download, Users, Building2, Info, ChevronDown, FolderPlus, Send } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { ListManagementDialog } from '@/components/records/ListManagementDialog';
import { SendContactsDialog } from '@/components/records/SendContactsDialog';
import { SaveAudienceDialog } from '@/components/search/SaveAudienceDialog';
import { useUnlockedRecords } from '@/hooks/useUnlockedRecords';
import { useCreditCheck } from '@/hooks/useCreditCheck';
import { usePersistRecords } from '@/hooks/usePersistRecords';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PreviewTable } from '@/components/search/PreviewTable';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';

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
    filters,
    filterState,
    setFilterState,
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
  
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  const [sendDialogState, setSendDialogState] = useState<{
    open: boolean;
    projectId: string;
    projectName: string;
  }>({ open: false, projectId: '', projectName: '' });
  const [externalProjects, setExternalProjects] = useState<any[]>([]);
  const [showSaveAudienceDialog, setShowSaveAudienceDialog] = useState(false);
  const [currentCreditsForSave, setCurrentCreditsForSave] = useState(0);
  
  const handleSearch = async (filterState: FilterBuilderState) => {
    setLoading(true);
    setSelectedRecords(new Set()); // Clear selection on new search
    setFilterState(filterState); // Store filter state for selection operations
    
    try {
      const params = {
        filters: {
          type: currentType,
          where: { field: 'all', op: 'exists' as const },
        },
        filterState,
        page: currentPage,
        perPage,
        unlockedIds: new Set<string>(), // Pass empty set for initial search (no unlocks yet)
      };
      
      let response;
      
      if (currentType === 'person') {
        response = await audienceLabClient.searchPeople(params);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
        if (response.pagination) {
          setTotalPages(response.pagination.total_pages);
        }
      } else {
        response = await audienceLabClient.searchCompanies(params);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
        if (response.pagination) {
          setTotalPages(response.pagination.total_pages);
        }
      }
      
      toast({
        title: 'Search complete',
        description: `Found ${response.totalEstimate.toLocaleString()} ${currentType === 'person' ? 'people' : 'companies'}`,
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

  // Load external projects for Send action
  useEffect(() => {
    loadExternalProjects();
  }, []);

  const loadExternalProjects = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) return;

      const { data, error } = await supabase
        .from('external_projects')
        .select('*')
        .eq('team_id', membership.team_id)
        .eq('is_active', true);

      if (error) throw error;
      setExternalProjects(data || []);
    } catch (error) {
      console.error('Error loading external projects:', error);
    }
  };

  const handleActionClick = async (action: 'export' | 'list' | 'send', projectId?: string, projectName?: string) => {
    if (selectedRecords.size === 0) {
      toast({
        title: 'No records selected',
        description: 'Please select at least one record',
        variant: 'destructive',
      });
      return;
    }

    // Get selected records data
    const selectedData = results.filter(r => selectedRecords.has(r.id));
    
    // Calculate unlock cost
    const alreadyUnlocked = selectedData.filter(r => isUnlocked(r.id)).length;
    const needUnlock = selectedData.length - alreadyUnlocked;
    
    if (needUnlock > 0) {
      // Show unlock confirmation dialog
      const credits = await getCurrentCredits();
      setUnlockDialogConfig({
        totalRecords: selectedData.length,
        alreadyUnlocked,
        needUnlock,
        action,
        currentCredits: credits,
      });
      
      // Store project info for send action
      if (action === 'send' && projectId && projectName) {
        setSendDialogState({ open: false, projectId, projectName });
      }
      
      setShowUnlockDialog(true);
    } else {
      // All already unlocked, proceed directly
      await performAction(action, projectId, projectName);
    }
  };

  const handleUnlockConfirm = async () => {
    if (!unlockDialogConfig) return;
    
    const selectedData = results.filter(r => selectedRecords.has(r.id));
    const lockedRecords = selectedData.filter(r => !isUnlocked(r.id));
    const { needUnlock, action } = unlockDialogConfig;
    
    // Check credits
    const enoughCredits = await hasEnoughCredits(needUnlock);
    if (!enoughCredits) {
      toast({ 
        title: 'Insufficient credits', 
        description: 'Please upgrade your plan to continue',
        variant: 'destructive' 
      });
      return;
    }
    
    // Deduct credits
    const result = await deductCredits(needUnlock);
    if (!result.success) {
      toast({ 
        title: 'Error deducting credits', 
        variant: 'destructive' 
      });
      return;
    }
    
    // Mark as unlocked in unlocked_records table
    await markAsUnlocked(
      lockedRecords.map(r => r.id),
      lockedRecords
    );
    
    // Save to people_records or company_records table
    await saveRecords(selectedData, currentType, action);
    
    setShowUnlockDialog(false);
    
    toast({
      title: 'Records unlocked',
      description: `${needUnlock} ${needUnlock === 1 ? 'record' : 'records'} unlocked successfully`,
    });
    
    // Perform the action
    await performAction(action, sendDialogState.projectId, sendDialogState.projectName);
  };

  const performAction = async (action: 'export' | 'list' | 'send', projectId?: string, projectName?: string) => {
    const selectedData = results.filter(r => selectedRecords.has(r.id));
    
    switch (action) {
      case 'export':
        if (currentType === 'person') {
          exportPeopleToCSV(selectedData as PersonEntity[]);
        } else {
          exportCompaniesToCSV(selectedData as CompanyEntity[]);
        }
        toast({
          title: 'Export successful',
          description: `Exported ${selectedData.length} records`,
        });
        setSelectedRecords(new Set());
        break;
        
      case 'list':
        setIsListDialogOpen(true);
        break;
        
      case 'send':
        if (projectId && projectName) {
          setSendDialogState({ open: true, projectId, projectName });
        }
        break;
    }
  };

  const handleSelectAllResults = async () => {
    // Show warning if selecting many records
    if (totalEstimate > 1000) {
      const confirmed = window.confirm(
        `You are about to select ${totalEstimate.toLocaleString()} records. This may take a moment. Continue?`
      );
      if (!confirmed) return;
    }
    
    setLoading(true);
    try {
      // Fetch ALL pages of results
      const allResults: (PersonEntity | CompanyEntity)[] = [];
      const totalPagesToFetch = Math.ceil(totalEstimate / perPage);
      
      for (let page = 1; page <= totalPagesToFetch; page++) {
        const params = {
          filters: filters || {
            type: currentType,
            where: { field: 'all', op: 'exists' as const },
          },
          filterState: filterState || {
            industries: [],
            cities: [],
            gender: null,
            jobTitles: [],
            seniority: [],
            department: [],
            companySize: [],
            netWorth: [],
            income: [],
            keywords: [],
            prospectData: [],
          },
          page,
          perPage,
          unlockedIds: new Set<string>(),
        };
        
        const response = currentType === 'person'
          ? await audienceLabClient.searchPeople(params)
          : await audienceLabClient.searchCompanies(params);
        
        allResults.push(...response.items);
      }
      
      // Deduplicate results by ID before setting state
      const uniqueResults = Array.from(
        new Map(allResults.map(r => [r.id, r])).values()
      );
      setResults(uniqueResults);
      
      // Select all unique IDs
      const allIds = new Set(uniqueResults.map(r => r.id));
      setSelectedRecords(allIds);
      
      // Update total estimate to match actual unique results found
      setTotalEstimate(allIds.size);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to select all results',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFirstN = async (count: number) => {
    setLoading(true);
    try {
      const results: (PersonEntity | CompanyEntity)[] = [];
      let fetched = 0;
      let currentPageNum = 1;
      
      // Fetch pages until we have enough records
      while (fetched < count) {
        const params = {
          filters: filters || {
            type: currentType,
            where: { field: 'all', op: 'exists' as const },
          },
          filterState: filterState || {
            industries: [],
            cities: [],
            gender: null,
            jobTitles: [],
            seniority: [],
            department: [],
            companySize: [],
            netWorth: [],
            income: [],
            keywords: [],
            prospectData: [],
          },
          page: currentPageNum,
          perPage,
          unlockedIds: new Set<string>(),
        };
        
        const response = currentType === 'person'
          ? await audienceLabClient.searchPeople(params)
          : await audienceLabClient.searchCompanies(params);
        
        results.push(...response.items);
        fetched += response.items.length;
        currentPageNum++;
        
        // Safety check: don't fetch more pages than necessary
        if (response.items.length === 0 || fetched >= count) {
          break;
        }
      }
      
      // Deduplicate results by ID before setting state
      const uniqueResults = Array.from(
        new Map(results.map(r => [r.id, r])).values()
      );
      setResults(uniqueResults);
      
      // Select first N unique IDs
      const selectedIds = new Set(uniqueResults.slice(0, count).map(r => r.id));
      setSelectedRecords(selectedIds);
      
      // Update total estimate to match actual unique results found
      setTotalEstimate(Math.max(totalEstimate, uniqueResults.length));
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to select records',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAudience = async () => {
    if (totalEstimate === 0) {
      toast({
        title: 'No audience to save',
        description: 'Please perform a search first',
        variant: 'destructive',
      });
      return;
    }
    
    // Get current credits before opening dialog
    const credits = await getCurrentCredits();
    setCurrentCreditsForSave(credits);
    setShowSaveAudienceDialog(true);
  };

  const handleSaveAudienceConfirm = async (audienceName: string) => {
    try {
      // Get current credits
      const credits = await getCurrentCredits();
      
      // Check if enough credits
      if (credits < totalEstimate) {
        toast({
          title: 'Insufficient credits',
          description: 'Please upgrade your plan to save this audience',
          variant: 'destructive',
        });
        return;
      }

      // Deduct credits (1 credit per contact)
      const result = await deductCredits(totalEstimate, undefined);
      if (!result.success) {
        toast({
          title: 'Error deducting credits',
          variant: 'destructive',
        });
        return;
      }

      // Get user and team info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team membership found');

      // Save audience to database
      const { error: saveError } = await supabase
        .from('audiences')
        .insert({
          name: audienceName,
          team_id: membership.team_id,
          type: currentType,
          filters: filters || {},
          result_count: totalEstimate,
          created_by: user.id,
        });

      if (saveError) throw saveError;

      setShowSaveAudienceDialog(false);
      
      toast({
        title: 'Audience saved',
        description: `"${audienceName}" has been saved successfully. ${totalEstimate.toLocaleString()} credits deducted.`,
      });

    } catch (error: any) {
      console.error('Error saving audience:', error);
      toast({
        title: 'Error saving audience',
        description: error.message || 'Failed to save audience',
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
            <Button variant="outline" size="sm" onClick={handleSaveAudience}>
              <Save className="h-4 w-4 mr-2" />
              Save Audience
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs 
          value={currentType} 
          onValueChange={(value) => {
            setCurrentType(value as 'person' | 'company');
            setSelectedRecords(new Set());
          }}
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
                  />
                </div>
                
                {/* Right: Results */}
                <div className="space-y-4 h-full flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {selectedRecords.size > 0 && (
                        <Badge variant="secondary">
                          {selectedRecords.size.toLocaleString()} selected
                          {selectedRecords.size < totalEstimate && (
                            <span className="text-xs ml-1">
                              of {totalEstimate.toLocaleString()}
                            </span>
                          )}
                        </Badge>
                      )}
                      {totalEstimate > 0 && (
                        <div className="text-sm text-muted-foreground">
                          Found {totalEstimate.toLocaleString()} {currentType === 'person' ? 'people' : 'companies'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CreditBalance />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            size="sm" 
                            disabled={selectedRecords.size === 0}
                          >
                            Actions ({selectedRecords.size})
                            <ChevronDown className="h-4 w-4 ml-2" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => handleActionClick('export')}>
                            <Download className="h-4 w-4 mr-2" />
                            Export Selected
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleActionClick('list')}>
                            <FolderPlus className="h-4 w-4 mr-2" />
                            Add to List
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <Send className="h-4 w-4 mr-2" />
                              Send to Tool
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {externalProjects.length === 0 ? (
                                <DropdownMenuItem disabled>
                                  No tools connected
                                </DropdownMenuItem>
                              ) : (
                                externalProjects.map((project) => (
                                  <DropdownMenuItem 
                                    key={project.id}
                                    onClick={() => handleActionClick('send', project.id, project.name)}
                                  >
                                    {project.name}
                                  </DropdownMenuItem>
                                ))
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={handleSaveAudience}>
                            <Save className="h-4 w-4 mr-2" />
                            Save Audience
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {results.length > 0 && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        Preview Mode: Email and LinkedIn are blurred. Use Actions to unlock and use credits.
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
                      <PreviewTable
                        data={results}
                        entityType="person"
                        isUnlocked={isUnlocked}
                        selectedRecords={selectedRecords}
                        onSelectionChange={setSelectedRecords}
                        totalResults={totalEstimate}
                        onSelectAllResults={handleSelectAllResults}
                        onSelectFirstN={handleSelectFirstN}
                      />
                      
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
                  />
                </div>
                
                {/* Right: Results */}
                <div className="space-y-4 h-full flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {selectedRecords.size > 0 && (
                        <Badge variant="secondary">
                          {selectedRecords.size.toLocaleString()} selected
                          {selectedRecords.size < totalEstimate && (
                            <span className="text-xs ml-1">
                              of {totalEstimate.toLocaleString()}
                            </span>
                          )}
                        </Badge>
                      )}
                      {totalEstimate > 0 && (
                        <div className="text-sm text-muted-foreground">
                          Found {totalEstimate.toLocaleString()} {currentType === 'person' ? 'people' : 'companies'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CreditBalance />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            size="sm" 
                            disabled={selectedRecords.size === 0}
                          >
                            Actions ({selectedRecords.size})
                            <ChevronDown className="h-4 w-4 ml-2" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => handleActionClick('export')}>
                            <Download className="h-4 w-4 mr-2" />
                            Export Selected
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleActionClick('list')}>
                            <FolderPlus className="h-4 w-4 mr-2" />
                            Add to List
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <Send className="h-4 w-4 mr-2" />
                              Send to Tool
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {externalProjects.length === 0 ? (
                                <DropdownMenuItem disabled>
                                  No tools connected
                                </DropdownMenuItem>
                              ) : (
                                externalProjects.map((project) => (
                                  <DropdownMenuItem 
                                    key={project.id}
                                    onClick={() => handleActionClick('send', project.id, project.name)}
                                  >
                                    {project.name}
                                  </DropdownMenuItem>
                                ))
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={handleSaveAudience}>
                            <Save className="h-4 w-4 mr-2" />
                            Save Audience
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {results.length > 0 && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        Preview Mode: Contact details are blurred. Use Actions to unlock and use credits.
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
                      <PreviewTable
                        data={results}
                        entityType="company"
                        isUnlocked={isUnlocked}
                        selectedRecords={selectedRecords}
                        onSelectionChange={setSelectedRecords}
                        totalResults={totalEstimate}
                        onSelectAllResults={handleSelectAllResults}
                        onSelectFirstN={handleSelectFirstN}
                      />
                      
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
          onConfirm={handleUnlockConfirm}
          onCancel={() => setShowUnlockDialog(false)}
          action={unlockDialogConfig.action}
        />
      )}

      <ListManagementDialog
        open={isListDialogOpen}
        onOpenChange={setIsListDialogOpen}
        entityType={currentType}
        selectedRecords={Array.from(selectedRecords)}
        records={results}
        onSuccess={() => {
          setSelectedRecords(new Set());
          setIsListDialogOpen(false);
          toast({ title: 'Added to list successfully' });
        }}
      />

      <SendContactsDialog
        open={sendDialogState.open}
        onOpenChange={(open) => {
          setSendDialogState(prev => ({ ...prev, open }));
          if (!open) setSelectedRecords(new Set());
        }}
        contactIds={Array.from(selectedRecords)}
        projectId={sendDialogState.projectId}
        projectName={sendDialogState.projectName}
      />

      <SaveAudienceDialog
        open={showSaveAudienceDialog}
        onOpenChange={setShowSaveAudienceDialog}
        totalContacts={totalEstimate}
        currentCredits={currentCreditsForSave}
        onConfirm={handleSaveAudienceConfirm}
        onCancel={() => setShowSaveAudienceDialog(false)}
      />
    </div>
  );
}
