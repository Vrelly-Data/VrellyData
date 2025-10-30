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
import { generateMockPeople } from '@/lib/mockData';
import { PersonEntity } from '@/types/audience';
import { RecordsTable } from './RecordsTable';
import { RecordsFilterDropdown } from './RecordsFilterDropdown';
import { ColumnCustomizer } from './ColumnCustomizer';
import { ListManagementDialog } from './ListManagementDialog';
import { useTableColumns } from '@/hooks/useTableColumns';
import { PERSON_COLUMNS } from '@/config/personTableColumns';
import { exportPeopleToCSV } from '@/lib/csvExport';
import { useToast } from '@/hooks/use-toast';

export function PeopleRecords() {
  const [records] = useState<PersonEntity[]>(generateMockPeople(100));
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  const { toast } = useToast();
  
  const {
    columns,
    visibleColumns,
    toggleColumn,
    resetToDefaults,
    clearPreferences
  } = useTableColumns('person', PERSON_COLUMNS);

  const handleExport = () => {
    const selectedData = records.filter(record => 
      selectedRecords.has(record.id)
    );
    exportPeopleToCSV(selectedData);
    toast({
      title: "Export successful",
      description: `Exported ${selectedData.length} people records to CSV`,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b p-4 flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">People Records</h2>
          {selectedRecords.size > 0 && (
            <Badge variant="secondary">
              {selectedRecords.size} of {records.length} selected
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <RecordsFilterDropdown entityType="person" />
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
        entityType="person"
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
