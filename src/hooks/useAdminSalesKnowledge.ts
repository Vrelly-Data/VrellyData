import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export type KnowledgeCategory =
  | 'email_template'
  | 'sequence_playbook'
  | 'campaign_result'
  | 'sales_guideline'
  | 'audience_insight';

export interface SalesKnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags: string[];
  metrics: Record<string, number> | null;
  source_campaign: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SalesKnowledgeInsert {
  category: KnowledgeCategory;
  title: string;
  content: string;
  tags?: string[];
  metrics?: Record<string, number>;
  source_campaign?: string;
  is_active?: boolean;
}

const QUERY_KEY = ['admin-sales-knowledge'];

export function useAdminSalesKnowledge() {
  const queryClient = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_knowledge' as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as SalesKnowledgeEntry[];
    },
  });

  const createEntry = useMutation({
    mutationFn: async (entry: SalesKnowledgeInsert) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('sales_knowledge' as any)
        .insert({ ...entry, created_by: user.id } as any);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: 'Entry created', description: 'Knowledge entry saved successfully.' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const updateEntry = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SalesKnowledgeEntry> & { id: string }) => {
      const { error } = await supabase
        .from('sales_knowledge' as any)
        .update({ ...updates, updated_at: new Date().toISOString() } as any)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: 'Entry updated' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('sales_knowledge' as any)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: 'Entry deleted' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const bulkCreateEntries = useMutation({
    mutationFn: async (rows: SalesKnowledgeInsert[]) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const toInsert = rows.map((r) => ({ ...r, created_by: user.id }));
      const { error } = await supabase
        .from('sales_knowledge' as any)
        .insert(toInsert as any);

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: 'Import complete', description: `${variables.length} entries imported.` });
    },
    onError: (err: Error) => {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    },
  });

  const bulkDeleteEntries = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        const { error } = await supabase
          .from('sales_knowledge' as any)
          .delete()
          .in('id', batch);
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: 'Entries deleted', description: `${variables.length} entries removed.` });
    },
    onError: (err: Error) => {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    },
  });

  const analyzeCSV = async (payload: {
    headers: string[];
    sampleRows: Record<string, string>[];
    rowCount: number;
  }) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-csv-knowledge`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Analysis failed' }));
      throw new Error(err.error || 'Analysis failed');
    }

    return response.json();
  };

  return { entries, isLoading, createEntry, updateEntry, deleteEntry, bulkCreateEntries, bulkDeleteEntries, analyzeCSV };
}
