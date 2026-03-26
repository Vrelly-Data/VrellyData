import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, Download, Users, Building2, Info, ChevronDown, FolderPlus, Send, ChevronsUpDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
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
import { useFreeDataSearch, TOTAL_DISPLAY_CAP } from '@/hooks/useFreeDataSearch';
import { useToast } from '@/hooks/use-toast';
import { exportPeopleToCSV, exportCompaniesToCSV } from '@/lib/csvExport';
import { PersonEntity, CompanyEntity } from '@/types/audience';
import { FilterBuilder } from '@/components/search/FilterBuilder';
import { CreditDisplay } from '@/components/search/CreditDisplay';
import { PaginationControls } from '@/components/search/PaginationControls';
import { FilterBuilderState, getDefaultFilterBuilderState } from '@/lib/filterConversion';
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
import SearchLoadingAnimation from '@/components/search/SearchLoadingAnimation';
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
  const { hasEnoughCredits, deductCredits, getRemainingCredits } = useCreditCheck();
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
    remainingCredits: number;
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
  const [previewMode, setPreviewMode] = useState<'expanded' | 'compact'>('expanded');
  const [hasSearched, setHasSearched] = useState(false);

  const { isEstimate, setIsEstimate } = useAudienceStore();

  const handleSearch = async (filterState: FilterBuilderState) => {
    setLoading(true);
    setHasSearched(true);
    setSelectedRecords(new Set()); // Clear selection on new search
    setFilterState(filterState); // Store filter state for selection operations
    
    try {
      let response;
      
      if (currentType === 'person') {
        response = await searchPeople(filterState, currentPage, perPage);
      } else {
        response = await searchCompanies(filterState, currentPage, perPage);
      }
      
      // Apply contact filter if "net_new" is selected - exclude already unlocked contacts
      let filteredItems = response.items;
      if (filterState.contactFilter === 'net_new') {
        filteredItems = response.items.filter(item => !isUnlocked(item));
      }
      
      setResults(filteredItems);
      // If results returned < page size, we have the true total - no estimation needed
      const trueTotal = response.items.length < perPage && response.items.length > 0
        ? response.items.length
        : response.totalEstimate;
      const trueIsEstimate = response.items.length < perPage && response.items.length > 0
        ? false
        : response.isEstimate;
      setTotalEstimate(filterState.contactFilter === 'net_new' ? filteredItems.length : trueTotal);
      setIsEstimate(trueIsEstimate);
      setTotalPages(filterState.contactFilter === 'net_new' ? 1 : response.pagination.total_pages);
      
      const displayTotal = filterState.contactFilter === 'net_new'
        ? filteredItems.length
        : trueTotal;

      const formatTotal = (n: number) =>
        n >= TOTAL_DISPLAY_CAP ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+` : n.toLocaleString();

      const estimatePrefix = trueIsEstimate ? '~' : '';
      const entityLabel = currentType === 'person' ? 'people' : 'companies';
      const suffix = filterState.contactFilter === 'net_new' ? ' (net new only)' : '';

      toast({
        title: 'Search complete',
        description: displayTotal === 0
          ? 'No results found'
          : `Found ${estimatePrefix}${formatTotal(displayTotal)} ${entityLabel}${suffix}`,
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
      const remainingCredits = getRemainingCredits();
      setUnlockDialogConfig({
        totalRecords: selectedData.length,
        alreadyOwned: analysis.alreadyOwned.length,
        canUpdate: analysis.canUpdate.length,
        newRecords: analysis.newRecords.length,
        creditsRequired,
        action,
        remainingCredits,
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
      
      const currentFilterState = filterState || getDefaultFilterBuilderState();
      
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
      
      const currentFilterState = filterState || getDefaultFilterBuilderState();
      
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
    if (selectedRecords.size === 0) {
      toast({
        title: 'No records selected',
        description: 'Please select records to save',
        variant: 'destructive',
      });
      return;
    }
    
    // Get remaining credits
    const remaining = getRemainingCredits();
    setCurrentCreditsForSave(remaining);
    setShowSaveAudienceDialog(true);
  };

  const handleSaveAudienceConfirm = async (audienceName: string) => {
    try {
      setLoading(true);
      
      // Get selected records from already-loaded results
      const selectedItems = results.filter(r => selectedRecords.has(r.id));
      
      if (selectedItems.length === 0) {
        toast({
          title: 'No records selected',
          description: 'Please select records to save to the audience',
          variant: 'destructive',
        });
        return;
      }
      
      // Get remaining credits
      const remaining = getRemainingCredits();
      
      // Check if enough credits
      if (remaining < selectedItems.length) {
        toast({
          title: 'Insufficient credits',
          description: 'Not enough credits to save this audience',
          variant: 'destructive',
        });
        return;
      }

      // Deduct credits (1 credit per contact)
      const result = await deductCredits(selectedItems.length, undefined);
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
          result_count: selectedItems.length,
          created_by: user.id,
        });

      if (saveError) throw saveError;

      // Save the actual records to people_records/company_records
      await saveRecords(selectedItems, currentType, 'export');

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
      for (let i = 0; i < selectedItems.length; i += batchSize) {
        const batch = selectedItems.slice(i, i + batchSize).map(record => ({
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
        entityCount: selectedItems.length,
        metadata: { audienceName, filters: filters || {}, listId: newList.id },
      });

      setShowSaveAudienceDialog(false);
      setSelectedRecords(new Set());
      
      toast({
        title: 'Audience saved',
        description: `"${audienceName}" has been saved with ${selectedItems.length.toLocaleString()} records and added to a new list.`,
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
              <div className={cn("grid grid-cols-[380px_1fr] gap-4 h-full p-4", previewMode === 'compact' && 'items-start')}>
                {/* Left: Filter Builder */}
                <div className="h-full overflow-hidden">
                  <FilterBuilder 
                    entityType="person" 
                    onSearch={handleSearch}
                  />
                </div>
                
                <div className={cn(
                  "space-y-4 flex flex-col transition-all duration-200",
                  previewMode === 'compact' ? 'self-start max-h-[calc(100vh-180px)] overflow-hidden' : 'h-full'
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPreviewMode(prev => prev === 'expanded' ? 'compact' : 'expanded')}
                          >
                            <ChevronsUpDown className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {previewMode === 'expanded' ? 'Collapse preview' : 'Expand preview'}
                        </TooltipContent>
                      </Tooltip>
                      {selectedRecords.size > 0 && (
                        <Badge variant="secondary">
                          {selectedRecords.size.toLocaleString()} selected
                          {selectedRecords.size < totalEstimate && (
                            <span className="text-xs ml-1">
                              of {totalEstimate >= TOTAL_DISPLAY_CAP ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+` : totalEstimate.toLocaleString()}
                            </span>
                          )}
                        </Badge>
                      )}
                      {totalEstimate > 0 && (
                        <div className="text-sm text-muted-foreground">
                          Found {isEstimate ? '~' : ''}{totalEstimate >= TOTAL_DISPLAY_CAP ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+` : totalEstimate.toLocaleString()} {currentType === 'person' ? 'people' : 'companies'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CreditDisplay />
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

                  {loading && <SearchLoadingAnimation />}

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
                      {hasSearched ? 'No results found' : 'Build your filters and click Search to find people'}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="company" className="mt-0 h-full">
              <div className={cn("grid grid-cols-[380px_1fr] gap-4 h-full p-4", previewMode === 'compact' && 'items-start')}>
                {/* Left: Filter Builder */}
                <div className="h-full overflow-hidden">
                  <FilterBuilder 
                    entityType="company"
                    onSearch={handleSearch}
                  />
                </div>
                
                <div className={cn(
                  "space-y-4 flex flex-col transition-all duration-200",
                  previewMode === 'compact' ? 'self-start max-h-[calc(100vh-180px)] overflow-hidden' : 'h-full'
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setPreviewMode(prev => prev === 'expanded' ? 'compact' : 'expanded')}
                          >
                            <ChevronsUpDown className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {previewMode === 'expanded' ? 'Collapse preview' : 'Expand preview'}
                        </TooltipContent>
                      </Tooltip>
                      {selectedRecords.size > 0 && (
                        <Badge variant="secondary">
                          {selectedRecords.size.toLocaleString()} selected
                          {selectedRecords.size < totalEstimate && (
                            <span className="text-xs ml-1">
                              of {totalEstimate >= TOTAL_DISPLAY_CAP ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+` : totalEstimate.toLocaleString()}
                            </span>
                          )}
                        </Badge>
                      )}
                      {totalEstimate > 0 && (
                        <div className="text-sm text-muted-foreground">
                          Found {isEstimate ? '~' : ''}{totalEstimate >= TOTAL_DISPLAY_CAP ? `${TOTAL_DISPLAY_CAP.toLocaleString()}+` : totalEstimate.toLocaleString()} {currentType === 'person' ? 'people' : 'companies'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CreditDisplay />
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

                  {loading && <SearchLoadingAnimation />}

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
                      {hasSearched ? 'No results found' : 'Build your filters and click Search to find companies'}
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
          remainingCredits={unlockDialogConfig.remainingCredits}
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
        totalContacts={selectedRecords.size}
        currentCredits={currentCreditsForSave}
        onConfirm={handleSaveAudienceConfirm}
        onCancel={() => setShowSaveAudienceDialog(false)}
      />
    </div>
  );
}
