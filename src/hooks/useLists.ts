import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/hooks/use-toast';
import type { List, ListItem, ListWithCount } from '@/types/lists';

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  query: () => ReturnType<ReturnType<typeof supabase.from>['select']>,
  orderColumn: string,
  ascending: boolean,
): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await (query() as any)
      .order(orderColumn, { ascending })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allRows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

export function useLists(entityType: 'person' | 'company') {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ['lists', entityType, user?.id],
    queryFn: async () => {
      if (!user) throw new Error('User not authenticated');

      // Get user's team_id from team_memberships
      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team membership found');

      // Fetch lists with item counts
      const { data: lists, error } = await supabase
        .from('lists')
        .select('*, list_items(count)')
        .eq('team_id', membership.team_id)
        .eq('entity_type', entityType)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      return lists.map(list => ({
        ...list,
        item_count: list.list_items?.[0]?.count || 0,
        list_items: undefined,
      })) as ListWithCount[];
    },
    enabled: !!user,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      entityType,
    }: {
      name: string;
      description?: string;
      entityType: 'person' | 'company';
    }) => {
      if (!user) throw new Error('User not authenticated');

      // Get user's team_id
      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team membership found');

      const { data, error } = await supabase
        .from('lists')
        .insert({
          name,
          description: description || null,
          entity_type: entityType,
          team_id: membership.team_id,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as List;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lists', variables.entityType] });
      toast({
        title: 'List created',
        description: `Successfully created list "${variables.name}"`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating list',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useAddToList() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  return useMutation({
    mutationFn: async ({
      listId,
      records,
    }: {
      listId: string;
      records: Array<{ id: string; data: any }>;
    }) => {
      if (!user) throw new Error('User not authenticated');

      // Check for existing items to avoid duplicates
      const existingItems = await fetchAllRows<{ entity_external_id: string }>(
        () => supabase.from('list_items').select('entity_external_id').eq('list_id', listId),
        'added_at',
        false,
      );

      const existingIds = new Set(existingItems.map(item => item.entity_external_id));
      
      const newRecords = records.filter(record => !existingIds.has(record.id));

      if (newRecords.length === 0) {
        throw new Error('All selected records are already in this list');
      }

      const items = newRecords.map(record => ({
        list_id: listId,
        entity_external_id: record.id,
        entity_data: record.data,
        added_by: user.id,
      }));

      const { error } = await supabase.from('list_items').insert(items);

      if (error) throw error;

      return { addedCount: newRecords.length, skippedCount: records.length - newRecords.length };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      const message = result.skippedCount > 0
        ? `Added ${result.addedCount} records (${result.skippedCount} already in list)`
        : `Added ${result.addedCount} records to list`;
      
      toast({
        title: 'Records added',
        description: message,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error adding records',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useListItems(listId: string) {
  return useQuery({
    queryKey: ['list-items', listId],
    queryFn: async () => {
      return fetchAllRows<ListItem>(
        () => supabase.from('list_items').select('*').eq('list_id', listId),
        'added_at',
        false,
      );
    },
    enabled: !!listId,
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listId: string) => {
      const { error } = await supabase
        .from('lists')
        .delete()
        .eq('id', listId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast({
        title: 'List deleted',
        description: 'The list has been successfully deleted',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting list',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useRemoveFromList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      recordIds,
    }: {
      listId: string;
      recordIds: string[];
    }) => {
      const { error } = await supabase
        .from('list_items')
        .delete()
        .eq('list_id', listId)
        .in('entity_external_id', recordIds);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['list-items', variables.listId] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast({
        title: 'Items removed',
        description: 'Selected items have been removed from the list',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error removing items',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
