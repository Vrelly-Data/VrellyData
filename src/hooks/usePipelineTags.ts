import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PipelineTag {
  id: string;
  name: string;
  color: string;
}

// Fixed color palette — auto-assigned on create by cycling through it (matches
// the pipeline stage-dot family). No user color picker.
export const TAG_PALETTE = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#22c55e', // green
  '#f59e0b', // amber
  '#f97316', // orange
  '#f43f5e', // rose
  '#ef4444', // red
  '#64748b', // slate
];

// The current agent's (client's) tag definitions. RLS scopes to auth.uid().
export function usePipelineTags() {
  return useQuery({
    queryKey: ['pipeline-tags'],
    queryFn: async (): Promise<PipelineTag[]> => {
      const { data, error } = await supabase
        .from('pipeline_tags')
        .select('id, name, color')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PipelineTag[];
    },
  });
}

// Tags currently applied to one lead.
export function useLeadTags(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ['lead-tags', leadId],
    queryFn: async (): Promise<PipelineTag[]> => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from('agent_lead_tags')
        .select('pipeline_tags ( id, name, color )')
        .eq('lead_id', leadId);
      if (error) throw error;
      return (data ?? [])
        .map((r) => (r as { pipeline_tags: PipelineTag | null }).pipeline_tags)
        .filter((t): t is PipelineTag => !!t)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!leadId,
  });
}

// Create a tag (auto color) OR return the existing one with the same name
// (case-insensitive — matches the unique index), then optionally apply it.
export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<PipelineTag> => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Tag name required');
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error('Not signed in');

      // Reuse an existing same-name tag (case-insensitive) rather than erroring
      // on the unique index.
      const { data: existing } = await supabase
        .from('pipeline_tags')
        .select('id, name, color')
        .ilike('name', trimmed)
        .maybeSingle();
      if (existing) return existing as PipelineTag;

      const { count } = await supabase
        .from('pipeline_tags')
        .select('id', { count: 'exact', head: true });
      const color = TAG_PALETTE[(count ?? 0) % TAG_PALETTE.length];

      const { data, error } = await supabase
        .from('pipeline_tags')
        .insert({ user_id: userId, name: trimmed, color })
        .select('id, name, color')
        .single();
      if (error) throw new Error(error.message);
      return data as PipelineTag;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pipeline-tags'] }),
  });
}

export function useApplyTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      const { error } = await supabase
        .from('agent_lead_tags')
        .upsert({ lead_id: leadId, tag_id: tagId }, { onConflict: 'lead_id,tag_id' });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead-tags', leadId] });
      qc.invalidateQueries({ queryKey: ['agent-inbox'] });
    },
  });
}

export function useRemoveTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, tagId }: { leadId: string; tagId: string }) => {
      const { error } = await supabase
        .from('agent_lead_tags')
        .delete()
        .eq('lead_id', leadId)
        .eq('tag_id', tagId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, { leadId }) => {
      qc.invalidateQueries({ queryKey: ['lead-tags', leadId] });
      qc.invalidateQueries({ queryKey: ['agent-inbox'] });
    },
  });
}
