import { useState } from 'react';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RecordsTable } from '@/components/records/RecordsTable';
import { useListItems, useRemoveFromList } from '@/hooks/useLists';
import { Skeleton } from '@/components/ui/skeleton';
import type { ListWithCount } from '@/types/lists';
import type { ColumnConfig } from '@/types/tableColumns';
import { PERSON_COLUMNS } from '@/config/personTableColumns';
import { COMPANY_COLUMNS } from '@/config/companyTableColumns';
import { exportPeopleToCSV, exportCompaniesToCSV } from '@/lib/csvExport';

interface ListDetailViewProps {
  list: ListWithCount;
  onBack: () => void;
}

export function ListDetailView({ list, onBack }: ListDetailViewProps) {
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const { data: listItems, isLoading } = useListItems(list.id);
  const removeFromList = useRemoveFromList();

  const columns: ColumnConfig<any>[] =
    list.entity_type === 'person' ? PERSON_COLUMNS : COMPANY_COLUMNS;

  const records = listItems?.map((item) => ({
    id: item.entity_external_id,
    ...item.entity_data,
  })) || [];

  const handleRemoveSelected = async () => {
    await removeFromList.mutateAsync({
      listId: list.id,
      recordIds: Array.from(selectedRecords),
    });
    setSelectedRecords(new Set());
  };

  const handleExport = () => {
    if (list.entity_type === 'person') {
      exportPeopleToCSV(records);
    } else {
      exportCompaniesToCSV(records);
    }
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{list.name}</h2>
          {list.description && (
            <p className="text-muted-foreground">{list.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {selectedRecords.size > 0 && (
            <Button
              variant="destructive"
              onClick={handleRemoveSelected}
              disabled={removeFromList.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove {selectedRecords.size} items
            </Button>
          )}
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <RecordsTable
            columns={columns}
            records={records}
            selectedRecords={selectedRecords}
            onSelectionChange={setSelectedRecords}
          />
        </div>
      )}
    </div>
  );
}
