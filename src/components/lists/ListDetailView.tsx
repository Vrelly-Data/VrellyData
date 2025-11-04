import { useState, useEffect } from 'react';
import { ArrowLeft, Download, Trash2, ChevronDown, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RecordsTable } from '@/components/records/RecordsTable';
import { useListItems, useRemoveFromList } from '@/hooks/useLists';
import { Skeleton } from '@/components/ui/skeleton';
import type { ListWithCount } from '@/types/lists';
import type { ColumnConfig } from '@/types/tableColumns';
import { PERSON_COLUMNS } from '@/config/personTableColumns';
import { COMPANY_COLUMNS } from '@/config/companyTableColumns';
import { exportPeopleToCSV, exportCompaniesToCSV } from '@/lib/csvExport';
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
import { SendContactsDialog } from '@/components/records/SendContactsDialog';
import { supabase } from '@/integrations/supabase/client';

interface ListDetailViewProps {
  list: ListWithCount;
  onBack: () => void;
}

export function ListDetailView({ list, onBack }: ListDetailViewProps) {
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const { data: listItems, isLoading } = useListItems(list.id);
  const removeFromList = useRemoveFromList();
  const [externalProjects, setExternalProjects] = useState<any[]>([]);
  const [sendDialogState, setSendDialogState] = useState<{
    open: boolean;
    projectId: string;
    projectName: string;
  }>({ open: false, projectId: '', projectName: '' });

  const loadExternalProjects = async () => {
    const { data } = await supabase
      .from('external_projects')
      .select('*')
      .eq('is_active', true);
    
    if (data) {
      setExternalProjects(data);
    }
  };

  useEffect(() => {
    loadExternalProjects();
  }, []);

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                Actions
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={selectedRecords.size === 0}
                onClick={handleRemoveSelected}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove from List {selectedRecords.size > 0 && `(${selectedRecords.size})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={selectedRecords.size === 0}>
                  <Send className="h-4 w-4 mr-2" />
                  Send {selectedRecords.size > 0 && `(${selectedRecords.size})`}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      Tools
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {externalProjects.length > 0 ? (
                        externalProjects.map((project) => (
                          <DropdownMenuItem
                            key={project.id}
                            onClick={() => setSendDialogState({
                              open: true,
                              projectId: project.id,
                              projectName: project.name,
                            })}
                          >
                            {project.name}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>
                          No projects configured
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
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
