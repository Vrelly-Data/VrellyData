import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Download, FolderPlus, ChevronDown, Upload, Trash2, Send } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { generateMockPeople } from '@/lib/mockData';
import { PersonEntity } from '@/types/audience';
import { RecordsTable } from './RecordsTable';
import { RecordsFilterDropdown } from './RecordsFilterDropdown';
import { ColumnCustomizer } from './ColumnCustomizer';
import { ListManagementDialog } from './ListManagementDialog';
import { CSVImportDialog } from './CSVImportDialog';
import { useTableColumns } from '@/hooks/useTableColumns';
import { PERSON_COLUMNS } from '@/config/personTableColumns';
import { exportPeopleToCSV } from '@/lib/csvExport';
import { useToast } from '@/hooks/use-toast';
import { SmartFilter } from '@/types/filterProperties';
import { evaluateSmartFilter } from '@/lib/smartFilterEvaluator';
import { SendContactsDialog } from './SendContactsDialog';
import { supabase } from '@/integrations/supabase/client';

export function PeopleRecords() {
  const [records, setRecords] = useState<PersonEntity[]>(generateMockPeople(100));
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState<SmartFilter | null>(null);
  const [externalProjects, setExternalProjects] = useState<any[]>([]);
  const [externalCampaigns, setExternalCampaigns] = useState<Record<string, any[]>>({});
  const [sendDialogState, setSendDialogState] = useState<{
    open: boolean;
    projectId: string;
    projectName: string;
  }>({ open: false, projectId: '', projectName: '' });
  const { toast } = useToast();

  // Load external projects on mount
  useMemo(() => {
    loadExternalProjects();
  }, []);

  const loadExternalProjects = async () => {
    const { data } = await supabase
      .from('external_projects')
      .select('*')
      .eq('is_active', true);
    
    if (data) {
      setExternalProjects(data);
      // Load campaigns for each project
      data.forEach(project => loadCampaigns(project.id));
    }
  };

  const loadCampaigns = async (projectId: string) => {
    const { data } = await supabase
      .from('external_campaigns')
      .select('*')
      .eq('project_id', projectId);
    
    if (data) {
      setExternalCampaigns(prev => ({ ...prev, [projectId]: data }));
    }
  };

  const filteredRecords = useMemo(() => {
    if (!appliedFilter) return records;
    return evaluateSmartFilter(records, appliedFilter);
  }, [records, appliedFilter]);
  
  const {
    columns,
    visibleColumns,
    toggleColumn,
    resetToDefaults,
    clearPreferences
  } = useTableColumns('person', PERSON_COLUMNS);

  const handleExport = () => {
    const selectedData = filteredRecords.filter(record => 
      selectedRecords.has(record.id)
    );
    exportPeopleToCSV(selectedData);
    toast({
      title: "Export successful",
      description: `Exported ${selectedData.length} people records to CSV`,
    });
  };

  const handleImportComplete = (importedRecords: PersonEntity[]) => {
    // Create a set of existing record identifiers for quick lookup
    const existingIdentifiers = new Set(
      records.map(r => `${r.name?.toLowerCase()}-${r.email?.toLowerCase() || ''}`)
    );
    
    // Filter out duplicates based on name+email combination
    const newRecords = importedRecords.filter(record => {
      const identifier = `${record.name?.toLowerCase()}-${record.email?.toLowerCase() || ''}`;
      return !existingIdentifiers.has(identifier);
    });
    
    const duplicateCount = importedRecords.length - newRecords.length;
    
    setRecords(prev => [...newRecords, ...prev]);
    setSelectedRecords(new Set());
    
    // Show appropriate feedback
    if (duplicateCount > 0) {
      toast({
        title: "Import completed with duplicates",
        description: `Imported ${newRecords.length} new records. Skipped ${duplicateCount} duplicate${duplicateCount > 1 ? 's' : ''}.`,
      });
    }
  };

  const handleDelete = () => {
    setRecords(prev => prev.filter(record => !selectedRecords.has(record.id)));
    const deletedCount = selectedRecords.size;
    setSelectedRecords(new Set());
    setIsDeleteDialogOpen(false);
    toast({
      title: "Records deleted",
      description: `Successfully deleted ${deletedCount} people record${deletedCount > 1 ? 's' : ''}`,
      variant: "default",
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b p-4 flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">People Records</h2>
          {selectedRecords.size > 0 && (
            <Badge variant="secondary">
              {selectedRecords.size} of {filteredRecords.length} selected
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <RecordsFilterDropdown 
            entityType="person" 
            onFilterApply={setAppliedFilter}
          />
          <ColumnCustomizer
            columns={columns}
            onToggleColumn={toggleColumn}
            onResetToDefaults={resetToDefaults}
            onClearPreferences={clearPreferences}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                Actions
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsImportDialogOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Import from CSV
              </DropdownMenuItem>
              <DropdownMenuItem 
                disabled={selectedRecords.size === 0}
                onClick={handleExport}
              >
                <Download className="h-4 w-4 mr-2" />
                Export {selectedRecords.size > 0 && `(${selectedRecords.size})`}
              </DropdownMenuItem>
              <DropdownMenuItem 
                disabled={selectedRecords.size === 0}
                onClick={() => setIsDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete {selectedRecords.size > 0 && `(${selectedRecords.size})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {externalProjects.length > 0 && (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={selectedRecords.size === 0}>
                      <Send className="h-4 w-4 mr-2" />
                      Send {selectedRecords.size > 0 && `(${selectedRecords.size})`}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {externalProjects.map((project) => (
                        <DropdownMenuSub key={project.id}>
                          <DropdownMenuSubTrigger>
                            {project.name}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {externalCampaigns[project.id]?.length > 0 ? (
                              externalCampaigns[project.id].map((campaign) => (
                                <DropdownMenuItem
                                  key={campaign.id}
                                  onClick={() => setSendDialogState({
                                    open: true,
                                    projectId: project.id,
                                    projectName: `${project.name} - ${campaign.campaign_name}`,
                                  })}
                                >
                                  {campaign.campaign_name}
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem disabled>
                                No campaigns available
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem 
                disabled={selectedRecords.size === 0}
                onClick={() => setIsListDialogOpen(true)}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                Add to List {selectedRecords.size > 0 && `(${selectedRecords.size})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsListDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New List
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <RecordsTable
        records={filteredRecords}
        columns={visibleColumns}
        selectedRecords={selectedRecords}
        onSelectionChange={setSelectedRecords}
      />
      
      <ListManagementDialog
        open={isListDialogOpen}
        onOpenChange={setIsListDialogOpen}
        entityType="person"
        selectedRecords={Array.from(selectedRecords)}
        records={records}
        onSuccess={() => {
          setSelectedRecords(new Set());
          setIsListDialogOpen(false);
        }}
      />

      <CSVImportDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        entityType="person"
        onImportComplete={handleImportComplete}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Records</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedRecords.size} people record{selectedRecords.size > 1 ? 's' : ''}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SendContactsDialog
        open={sendDialogState.open}
        onOpenChange={(open) => setSendDialogState(prev => ({ ...prev, open }))}
        contactIds={Array.from(selectedRecords)}
        projectId={sendDialogState.projectId}
        projectName={sendDialogState.projectName}
      />
    </div>
  );
}
