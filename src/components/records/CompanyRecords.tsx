import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Download, FolderPlus, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { generateMockCompanies } from '@/lib/mockData';
import { CompanyEntity } from '@/types/audience';
import { RecordsTable } from './RecordsTable';
import { RecordsFilterDropdown } from './RecordsFilterDropdown';
import { ColumnCustomizer } from './ColumnCustomizer';
import { ListManagementDialog } from './ListManagementDialog';
import { useTableColumns } from '@/hooks/useTableColumns';
import { COMPANY_COLUMNS } from '@/config/companyTableColumns';

export function CompanyRecords() {
  const [records] = useState<CompanyEntity[]>(generateMockCompanies(100));
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  
  const {
    columns,
    visibleColumns,
    toggleColumn,
    resetToDefaults,
    clearPreferences
  } = useTableColumns('company', COMPANY_COLUMNS);

  const handleExport = () => {
    console.log('Export selected records:', selectedRecords);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b p-4 flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Company Records</h2>
          {selectedRecords.size > 0 && (
            <Badge variant="secondary">
              {selectedRecords.size} of {records.length} selected
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <RecordsFilterDropdown entityType="company" />
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
              <DropdownMenuItem 
                disabled={selectedRecords.size === 0}
                onClick={handleExport}
              >
                <Download className="h-4 w-4 mr-2" />
                Export {selectedRecords.size > 0 && `(${selectedRecords.size})`}
              </DropdownMenuItem>
              <DropdownMenuItem 
                disabled={selectedRecords.size === 0}
                onClick={() => setIsListDialogOpen(true)}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                Add to List {selectedRecords.size > 0 && `(${selectedRecords.size})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsListDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New List
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      <RecordsTable
        records={records}
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
    </div>
  );
}
