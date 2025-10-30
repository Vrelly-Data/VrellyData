import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLists, useCreateList, useAddToList } from '@/hooks/useLists';
import { Loader2, FolderPlus, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ListManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: 'person' | 'company';
  selectedRecords: string[];
  records: any[];
  onSuccess?: () => void;
}

export function ListManagementDialog({
  open,
  onOpenChange,
  entityType,
  selectedRecords,
  records,
  onSuccess,
}: ListManagementDialogProps) {
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');
  const [activeTab, setActiveTab] = useState<'existing' | 'new'>(
    selectedRecords.length > 0 ? 'existing' : 'new'
  );

  const { data: lists, isLoading: listsLoading } = useLists(entityType);
  const createList = useCreateList();
  const addToList = useAddToList();

  const handleCreateList = async () => {
    if (!newListName.trim()) return;

    const result = await createList.mutateAsync({
      name: newListName,
      description: newListDescription,
      entityType,
    });

    // If records are selected, add them to the new list
    if (selectedRecords.length > 0) {
      const recordsToAdd = records
        .filter(r => selectedRecords.includes(r.id))
        .map(r => ({ id: r.id, data: r }));

      await addToList.mutateAsync({
        listId: result.id,
        records: recordsToAdd,
      });
    }

    setNewListName('');
    setNewListDescription('');
    onSuccess?.();
  };

  const handleAddToExistingList = async (listId: string) => {
    const recordsToAdd = records
      .filter(r => selectedRecords.includes(r.id))
      .map(r => ({ id: r.id, data: r }));

    await addToList.mutateAsync({
      listId,
      records: recordsToAdd,
    });

    onSuccess?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {selectedRecords.length > 0
              ? `Add ${selectedRecords.length} ${entityType === 'person' ? 'People' : 'Companies'} to List`
              : 'Create New List'}
          </DialogTitle>
          <DialogDescription>
            {selectedRecords.length > 0
              ? 'Choose an existing list or create a new one'
              : 'Create a new list to organize your contacts'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'existing' | 'new')}>
          {selectedRecords.length > 0 && (
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="existing">Add to Existing</TabsTrigger>
              <TabsTrigger value="new">Create New</TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="existing" className="space-y-4">
            {listsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : lists && lists.length > 0 ? (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-2">
                  {lists.map((list) => (
                    <div
                      key={list.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium truncate">{list.name}</h4>
                          <Badge variant="secondary" className="shrink-0">
                            {list.item_count}
                          </Badge>
                        </div>
                        {list.description && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {list.description}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleAddToExistingList(list.id)}
                        disabled={addToList.isPending}
                        className="ml-3 shrink-0"
                      >
                        {addToList.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-1" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FolderPlus className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No lists yet. Create your first list!</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="new" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="list-name">List Name</Label>
              <Input
                id="list-name"
                placeholder="e.g., Enterprise Prospects"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="list-description">Description (Optional)</Label>
              <Textarea
                id="list-description"
                placeholder="What's this list for?"
                value={newListDescription}
                onChange={(e) => setNewListDescription(e.target.value)}
                rows={3}
              />
            </div>

            <Button
              onClick={handleCreateList}
              disabled={!newListName.trim() || createList.isPending || addToList.isPending}
              className="w-full"
            >
              {createList.isPending || addToList.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {selectedRecords.length > 0 ? 'Create & Add' : 'Create List'}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
