import { useState } from 'react';
import { Plus, Trash2, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLists, useCreateList, useDeleteList } from '@/hooks/useLists';
import { ListDetailView } from './ListDetailView';
import { Skeleton } from '@/components/ui/skeleton';
import type { ListWithCount } from '@/types/lists';

interface ListViewProps {
  entityType: 'person' | 'company';
}

export function ListView({ entityType }: ListViewProps) {
  const [selectedList, setSelectedList] = useState<ListWithCount | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDescription, setNewListDescription] = useState('');

  const { data: lists, isLoading } = useLists(entityType);
  const createList = useCreateList();
  const deleteList = useDeleteList();

  const handleCreateList = async () => {
    await createList.mutateAsync({
      name: newListName,
      description: newListDescription,
      entityType,
    });
    setIsCreateDialogOpen(false);
    setNewListName('');
    setNewListDescription('');
  };

  const handleDeleteList = async (listId: string) => {
    await deleteList.mutateAsync(listId);
  };

  if (selectedList) {
    return (
      <ListDetailView
        list={selectedList}
        onBack={() => setSelectedList(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">
            {entityType === 'person' ? 'People' : 'Company'} Lists
          </h2>
          <p className="text-muted-foreground">
            Manage your saved lists of {entityType === 'person' ? 'people' : 'companies'}
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create List
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : lists && lists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => (
            <Card
              key={list.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="flex-1" onClick={() => setSelectedList(list)}>
                  <CardTitle className="text-lg">{list.name}</CardTitle>
                  {list.description && (
                    <CardDescription className="mt-1.5">
                      {list.description}
                    </CardDescription>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => handleDeleteList(list.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent onClick={() => setSelectedList(list)}>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{list.item_count} items</span>
                  <span>•</span>
                  <span>
                    Updated {new Date(list.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">No lists yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first list to get started
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create List
            </Button>
          </div>
        </div>
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New List</DialogTitle>
            <DialogDescription>
              Create a new list to organize your {entityType === 'person' ? 'people' : 'companies'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                placeholder="Enter list name"
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={newListDescription}
                onChange={(e) => setNewListDescription(e.target.value)}
                placeholder="Enter description"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateList}
              disabled={!newListName.trim() || createList.isPending}
            >
              {createList.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
