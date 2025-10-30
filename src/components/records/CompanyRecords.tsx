import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Download, FolderPlus, ChevronDown, Upload, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { generateMockCompanies } from '@/lib/mockData';
import { CompanyEntity } from '@/types/audience';
import { RecordsTable } from './RecordsTable';
import { RecordsFilterDropdown } from './RecordsFilterDropdown';
import { ColumnCustomizer } from './ColumnCustomizer';
import { ListManagementDialog } from './ListManagementDialog';
import { CSVImportDialog } from './CSVImportDialog';
import { useTableColumns } from '@/hooks/useTableColumns';
import { COMPANY_COLUMNS } from '@/config/companyTableColumns';
import { exportCompaniesToCSV } from '@/lib/csvExport';
import { useToast } from '@/hooks/use-toast';
import { SmartFilter } from '@/types/filterProperties';
import { evaluateSmartFilter } from '@/lib/smartFilterEvaluator';

export function CompanyRecords() {
  const [records, setRecords] = useState<CompanyEntity[]>(generateMockCompanies(100));
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState<SmartFilter | null>(null);
  const { toast } = useToast();

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
  } = useTableColumns('company', COMPANY_COLUMNS);

  const handleExport = () => {
    const selectedData = filteredRecords.filter(record => 
      selectedRecords.has(record.id)
    );
    exportCompaniesToCSV(selectedData);
    toast({
      title: "Export successful",
      description: `Exported ${selectedData.length} company records to CSV`,
    });
  };

  const handleImportComplete = (importedRecords: CompanyEntity[]) => {
    setRecords(prev => [...importedRecords, ...prev]);
    setSelectedRecords(new Set());
  };

  const handleDelete = () => {
    setRecords(prev => prev.filter(record => !selectedRecords.has(record.id)));
    const deletedCount = selectedRecords.size;
    setSelectedRecords(new Set());
    setIsDeleteDialogOpen(false);
    toast({
      title: "Records deleted",
      description: `Successfully deleted ${deletedCount} company record${deletedCount > 1 ? 's' : ''}`,
      variant: "default",
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b p-4 flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Company Records</h2>
          {selectedRecords.size > 0 && (
            <Badge variant="secondary">
              {selectedRecords.size} of {filteredRecords.length} selected
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <RecordsFilterDropdown 
            entityType="company" 
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
        entityType="company"
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
        entityType="company"
        onImportComplete={handleImportComplete}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Records</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedRecords.size} company record{selectedRecords.size > 1 ? 's' : ''}? 
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
    </div>
  );
}
