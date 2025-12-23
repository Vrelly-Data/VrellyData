import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { useFreeDataSearch } from '@/hooks/useFreeDataSearch';
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
import { useDeduplication } from '@/hooks/useDeduplication';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PreviewTable } from '@/components/search/PreviewTable';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';

export default function AudienceBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
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
  const { hasEnoughCredits, deductCredits, getRemainingCreditsToday } = useCreditCheck();
  const { saveRecords } = usePersistRecords();
  const { analyzeRecords } = useDeduplication(currentType);
  const { logAuditEvent } = useAuditLog();
  const { searchPeople, searchCompanies } = useFreeDataSearch();
  
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockDialogConfig, setUnlockDialogConfig] = useState<{
    totalRecords: number;
    alreadyOwned: number;
    canUpdate: number;
    newRecords: number;
    creditsRequired: number;
    action: 'export' | 'list' | 'send';
    remainingCreditsToday: number;
  } | null>(null);
  const [deduplicationAnalysis, setDeduplicationAnalysis] = useState<{
    alreadyOwned: Array<{ id: string; data: any }>;
    canUpdate: Array<{ id: string; current: any; new: any; changes: string[]; newHash: string }>;
    newRecords: Array<{ id: string; data: any; hash: string }>;
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
      let response;
      
      if (currentType === 'person') {
        response = await searchPeople(filterState, currentPage, perPage);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
        setTotalPages(response.pagination.total_pages);
      } else {
        response = await searchCompanies(filterState, currentPage, perPage);
        setResults(response.items);
        setTotalEstimate(response.totalEstimate);
        setTotalPages(response.pagination.total_pages);
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
    
    // Analyze for deduplication (check against database records)
    const analysis = await analyzeRecords(selectedData);
    setDeduplicationAnalysis(analysis);
    
    // Calculate credits required:
    // - New records cost 1 credit each
    // - Updated records cost 1 credit each  
    // - Already owned (same data) cost 0 credits
    const creditsRequired = analysis.newRecords.length + analysis.canUpdate.length;
    
    if (creditsRequired > 0) {
      // Show unlock confirmation dialog with detailed breakdown
      const remainingToday = await getRemainingCreditsToday();
      setUnlockDialogConfig({
        totalRecords: selectedData.length,
        alreadyOwned: analysis.alreadyOwned.length,
        canUpdate: analysis.canUpdate.length,
        newRecords: analysis.newRecords.length,
        creditsRequired,
        action,
        remainingCreditsToday: remainingToday,
      });
      
      // Store project info for send action
      if (action === 'send' && projectId && projectName) {
        setSendDialogState({ open: false, projectId, projectName });
      }
      
      setShowUnlockDialog(true);
    } else {
      // All already owned/unlocked, proceed directly
      // Show notification about duplicates
      if (analysis.alreadyOwned.length > 0) {
        toast({
          title: 'Duplicates Skipped',
          description: `${analysis.alreadyOwned.length} contacts already in your database`,
        });
      }
      await performAction(action, projectId, projectName);
    }
  };

  const handleUnlockConfirm = async () => {
    if (!unlockDialogConfig || !deduplicationAnalysis) return;
    
    const selectedData = results.filter(r => selectedRecords.has(r.id));
    const { creditsRequired, action } = unlockDialogConfig;
    
    // ONLY deduct credits for NEW records (not in database)
    if (creditsRequired > 0) {
      // Check credits
      const enoughCredits = await hasEnoughCredits(creditsRequired);
      if (!enoughCredits) {
        toast({ 
          title: 'Insufficient credits', 
          description: 'Please upgrade your plan to continue',
          variant: 'destructive' 
        });
        return;
      }
      
      // Deduct credits ONLY for new records
      const result = await deductCredits(creditsRequired);
      if (!result.success) {
        toast({ 
          title: 'Error deducting credits', 
          variant: 'destructive' 
        });
        return;
      }
    }
    
    // Mark ONLY new records as unlocked in unlocked_records table
    if (deduplicationAnalysis.newRecords.length > 0) {
      await markAsUnlocked(
        deduplicationAnalysis.newRecords.map(r => r.id),
        deduplicationAnalysis.newRecords.map(r => r.data)
      );
      
      // Log audit event for unlock
      await logAuditEvent({
        action: 'unlock',
        entityType: currentType,
        entityCount: deduplicationAnalysis.newRecords.length,
        metadata: {
          creditsDeducted: creditsRequired,
          source: 'audience_builder',
        },
      });
    }
    
    // Update existing records with new data (free - no credit charge)
    if (deduplicationAnalysis.canUpdate.length > 0) {
      await saveRecords(
        deduplicationAnalysis.canUpdate.map(r => r.new),
        currentType,
        'update'
      );
    }
    
    // Save all NEW records to people_records or company_records table
    if (deduplicationAnalysis.newRecords.length > 0) {
      const saveResult = await saveRecords(
        deduplicationAnalysis.newRecords.map(r => r.data),
        currentType,
        action
      );

      // Verification: Log first record to ensure full data is saved
      if (deduplicationAnalysis.newRecords.length > 0) {
        console.log('[UNLOCK VERIFICATION]', {
          action,
          totalRecords: deduplicationAnalysis.newRecords.length,
          sampleRecord: deduplicationAnalysis.newRecords[0].data,
          hasEmail: 'email' in deduplicationAnalysis.newRecords[0].data,
          hasPhone: 'phone' in deduplicationAnalysis.newRecords[0].data,
          saveSuccess: saveResult.success,
        });
      }
    }
    
    setShowUnlockDialog(false);
    
    // Show summary toast notifications
    const messages: string[] = [];
    
    if (deduplicationAnalysis.alreadyOwned.length > 0) {
      messages.push(`${deduplicationAnalysis.alreadyOwned.length} already in database`);
    }
    
    if (deduplicationAnalysis.canUpdate.length > 0) {
      messages.push(`${deduplicationAnalysis.canUpdate.length} updated`);
    }
    
    if (deduplicationAnalysis.newRecords.length > 0) {
      messages.push(`${deduplicationAnalysis.newRecords.length} new contacts unlocked`);
    }
    
    toast({
      title: 'Action Complete',
      description: messages.join(' • '),
    });
    
    // Perform the action with ALL selected records (owned + updated + new)
    await performAction(action, sendDialogState.projectId, sendDialogState.projectName);
  };

  const performAction = async (action: 'export' | 'list' | 'send', projectId?: string, projectName?: string) => {
    const selectedData = results.filter(r => selectedRecords.has(r.id));
    
    switch (action) {
      case 'export':
        // Verification: Log what we're about to export
        console.log('[PRE-EXPORT VERIFICATION]', {
          selectedCount: selectedRecords.size,
          foundInResults: selectedData.length,
          entityType: currentType,
          allUnlocked: selectedData.every(r => 'isUnlocked' in r ? r.isUnlocked : false),
          sampleRecord: selectedData[0],
        });
        
        if (currentType === 'person') {
          exportPeopleToCSV(selectedData as PersonEntity[]);
        } else {
          exportCompaniesToCSV(selectedData as CompanyEntity[]);
        }
        
        // Log audit event for export
        await logAuditEvent({
          action: 'export',
          entityType: currentType,
          entityCount: selectedData.length,
          metadata: {
            format: 'csv',
            source: 'audience_builder',
          },
        });
        
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
      
      const currentFilterState = filterState || {
        industries: [],
        cities: [],
        gender: null,
        jobTitles: [],
        seniority: [],
        department: [],
        companySize: [],
        companyRevenue: [],
        netWorth: [],
        income: [],
        keywords: [],
        prospectData: [],
        personCity: [],
        personCountry: [],
        companyCity: [],
        companyCountry: [],
        personInterests: [],
        personSkills: [],
      };
      
      for (let page = 1; page <= totalPagesToFetch; page++) {
        const response = currentType === 'person'
          ? await searchPeople(currentFilterState, page, perPage)
          : await searchCompanies(currentFilterState, page, perPage);
        
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
      
      const currentFilterState = filterState || {
        industries: [],
        cities: [],
        gender: null,
        jobTitles: [],
        seniority: [],
        department: [],
        companySize: [],
        companyRevenue: [],
        netWorth: [],
        income: [],
        keywords: [],
        prospectData: [],
        personCity: [],
        personCountry: [],
        companyCity: [],
        companyCountry: [],
        personInterests: [],
        personSkills: [],
      };
      
      // Fetch pages until we have enough records
      while (fetched < count) {
        const response = currentType === 'person'
          ? await searchPeople(currentFilterState, currentPageNum, perPage)
          : await searchCompanies(currentFilterState, currentPageNum, perPage);
        
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
      
      // Clamp count to actual available results
      const actualCount = Math.min(count, uniqueResults.length);
      
      // Select first N unique IDs
      const selectedIds = new Set(uniqueResults.slice(0, actualCount).map(r => r.id));
      setSelectedRecords(selectedIds);
      
      // Show info if user requested more than available
      if (count > uniqueResults.length) {
        toast({
          title: 'Info',
          description: `Only ${uniqueResults.length} unique results available; selected all of them.`,
        });
      }
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
    
    // Get remaining credits for today
    const remaining = await getRemainingCreditsToday();
    setCurrentCreditsForSave(remaining);
    setShowSaveAudienceDialog(true);
  };

  const handleSaveAudienceConfirm = async (audienceName: string) => {
    try {
      setLoading(true);
      
      // Get remaining credits for today
      const remaining = await getRemainingCreditsToday();
      
      // Check if enough credits
      if (remaining < totalEstimate) {
        toast({
          title: 'Insufficient credits',
          description: 'You have reached your daily credit limit. Please try again tomorrow.',
          variant: 'destructive',
        });
        return;
      }

      // Fetch ALL results to save
      const allResults: (PersonEntity | CompanyEntity)[] = [];
      const totalPagesToFetch = Math.ceil(totalEstimate / perPage);
      
      const currentFilterState = filterState || {
        industries: [],
        cities: [],
        gender: null,
        jobTitles: [],
        seniority: [],
        department: [],
        companySize: [],
        companyRevenue: [],
        netWorth: [],
        income: [],
        keywords: [],
        prospectData: [],
        personCity: [],
        personCountry: [],
        companyCity: [],
        companyCountry: [],
        personInterests: [],
        personSkills: [],
      };
      
      for (let page = 1; page <= totalPagesToFetch; page++) {
        const response = currentType === 'person'
          ? await searchPeople(currentFilterState, page, perPage)
          : await searchCompanies(currentFilterState, page, perPage);
        
        allResults.push(...response.items);
      }
      
      // Deduplicate results by ID
      const uniqueResults = Array.from(
        new Map(allResults.map(r => [r.id, r])).values()
      );

      // Deduct credits (1 credit per contact)
      const result = await deductCredits(uniqueResults.length, undefined);
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

      // Save audience metadata to database
      const { error: saveError } = await supabase
        .from('audiences')
        .insert({
          name: audienceName,
          team_id: membership.team_id,
          type: currentType,
          filters: filters || {},
          result_count: uniqueResults.length,
          created_by: user.id,
        });

      if (saveError) throw saveError;

      // Save the actual records to people_records/company_records
      await saveRecords(uniqueResults, currentType, 'export');

      // Create a list for this audience
      const { data: newList, error: listError } = await supabase
        .from('lists')
        .insert({
          name: audienceName,
          description: `Auto-generated from audience "${audienceName}"`,
          entity_type: currentType,
          team_id: membership.team_id,
          created_by: user.id,
        })
        .select()
        .single();

      if (listError) throw listError;

      // Add all records to the list in batches
      const batchSize = 500;
      for (let i = 0; i < uniqueResults.length; i += batchSize) {
        const batch = uniqueResults.slice(i, i + batchSize).map(record => ({
          list_id: newList.id,
          entity_external_id: record.id,
          entity_data: JSON.parse(JSON.stringify(record)),
          added_by: user.id,
        }));
        
        const { error: itemsError } = await supabase
          .from('list_items')
          .insert(batch);
        
        if (itemsError) throw itemsError;
      }

      // Invalidate lists cache to refresh UI
      queryClient.invalidateQueries({ queryKey: ['lists', currentType] });

      // Log audit event
      await logAuditEvent({
        action: 'save_audience',
        entityType: currentType,
        entityCount: uniqueResults.length,
        metadata: { audienceName, filters: filters || {}, listId: newList.id },
      });

      setShowSaveAudienceDialog(false);
      
      toast({
        title: 'Audience saved',
        description: `"${audienceName}" has been saved with ${uniqueResults.length.toLocaleString()} records and added to a new list.`,
      });

    } catch (error: any) {
      console.error('Error saving audience:', error);
      toast({
        title: 'Error saving audience',
        description: error.message || 'Failed to save audience',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
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
          alreadyOwned={unlockDialogConfig.alreadyOwned}
          canUpdate={unlockDialogConfig.canUpdate}
          newRecords={unlockDialogConfig.newRecords}
          creditsRequired={unlockDialogConfig.creditsRequired}
          remainingCreditsToday={unlockDialogConfig.remainingCreditsToday}
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
