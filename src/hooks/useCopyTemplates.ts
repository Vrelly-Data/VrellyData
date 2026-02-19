import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CopyGroup {
  groupId: string;
  name: string;
  stepCount: number;
  channels: string[];
  createdAt: string;
  rows: CopyTemplateRow[];
}

export interface CopyTemplateRow {
  id: string;
  name: string;
  subject: string | null;
  body_text: string | null;
  tags: string[] | null;
  created_at: string;
}

export function useAICopyGroups() {
  return useQuery({
    queryKey: ['copy-templates', 'ai-groups'],
    queryFn: async (): Promise<CopyGroup[]> => {
      const { data, error } = await supabase
        .from('copy_templates')
        .select('id, name, subject, body_text, tags, created_at')
        .contains('tags', ['ai-generated'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!data) return [];

      // Group by the group:{uuid} tag
      const groups: Record<string, CopyTemplateRow[]> = {};
      for (const row of data) {
        const groupTag = (row.tags || []).find((t: string) => t.startsWith('group:'));
        if (!groupTag) continue;
        const groupId = groupTag.replace('group:', '');
        if (!groups[groupId]) groups[groupId] = [];
        groups[groupId].push(row as CopyTemplateRow);
      }

      return Object.entries(groups).map(([groupId, rows]) => {
        // Sort rows by step number extracted from name
        const sorted = [...rows].sort((a, b) => {
          const stepA = parseInt(a.name.match(/Step (\d+)/i)?.[1] || '1');
          const stepB = parseInt(b.name.match(/Step (\d+)/i)?.[1] || '1');
          return stepA - stepB;
        });

        // Extract base name (strip " — Step N (Channel)" suffix)
        const baseName = sorted[0]?.name.replace(/\s*[—–-]\s*Step\s*\d+.*$/i, '').trim() || 'Untitled Copy';

        // Extract channels from name patterns like "Step 1 (Email)"
        const channels = sorted
          .map(r => r.name.match(/\(([^)]+)\)/)?.[1])
          .filter((c): c is string => !!c);

        return {
          groupId,
          name: baseName,
          stepCount: sorted.length,
          channels: [...new Set(channels)],
          createdAt: sorted[0]?.created_at || new Date().toISOString(),
          rows: sorted,
        };
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
  });
}

interface SaveCopyInput {
  templateName: string;
  steps: { step: number; day: number; channel?: string; subject?: string | null; body: string }[];
}

export function useSaveCopyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateName, steps }: SaveCopyInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: membership, error: membershipError } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (membershipError || !membership) throw new Error('Team not found');

      const groupId = crypto.randomUUID();
      const groupTag = `group:${groupId}`;

      const rows = steps.map((s) => ({
        name: `${templateName} — Step ${s.step} (${s.channel || 'Email'})`,
        subject: s.subject || null,
        body_text: s.body,
        tags: ['ai-generated', groupTag],
        team_id: membership.team_id,
        created_by: user.id,
      }));

      const { error } = await supabase.from('copy_templates').insert(rows);
      if (error) throw error;

      return groupId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-templates', 'ai-groups'] });
    },
  });
}

export function useDeleteCopyGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string) => {
      const groupTag = `group:${groupId}`;
      // Fetch IDs of all rows in this group then delete
      const { data, error: fetchError } = await supabase
        .from('copy_templates')
        .select('id')
        .contains('tags', [groupTag]);

      if (fetchError) throw fetchError;
      if (!data || data.length === 0) return;

      const ids = data.map((r: any) => r.id);
      const { error } = await supabase.from('copy_templates').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-templates', 'ai-groups'] });
    },
  });
}
