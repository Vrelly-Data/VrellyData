import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// agent_activity isn't fully in the generated types; mirror the escape hatch
// used in useAgentInbox / useAgent.
const db = supabase as any;

export interface Learning {
  id: string;
  description: string;
  metadata: { learning_text?: string } | null;
  lead_id: string | null;
  created_at: string;
}

export type LearningScope = { leadId: string } | { global: true };

function scopeKey(scope: LearningScope): string {
  return 'leadId' in scope ? `lead:${scope.leadId}` : 'global';
}

// List learnings for a scope. RLS already restricts to the authed user; the
// scope filter narrows further: a lead's learnings, or global (lead_id null).
export function useLearnings(scope: LearningScope) {
  return useQuery<Learning[]>({
    queryKey: ['learnings', scopeKey(scope)],
    queryFn: async () => {
      let query = db
        .from('agent_activity')
        .select('id, description, metadata, lead_id, created_at')
        .eq('activity_type', 'learning_added')
        .order('created_at', { ascending: false });
      query = 'leadId' in scope
        ? query.eq('lead_id', scope.leadId)
        : query.is('lead_id', null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Learning[];
    },
  });
}

// Append a taught lesson as a bullet under a "## Learned from corrections"
// section in the agent_knowledge doc. Creates the section at the end if absent;
// otherwise inserts the bullet at the end of that section (before the next
// "## " heading, or at doc end). Accumulates — never overwrites existing text,
// so operators can freely edit/delete these lines afterward.
const LEARNED_HEADER = '## Learned from corrections';
export function appendLearnedBullet(doc: string | null | undefined, lesson: string): string {
  const bullet = `- ${lesson.trim()}`;
  const base = (doc ?? '').replace(/\s+$/, '');
  const m = /^## Learned from corrections[ \t]*$/m.exec(base);
  if (!m) {
    const prefix = base ? `${base}\n\n` : '';
    return `${prefix}${LEARNED_HEADER}\n\n${bullet}\n`;
  }
  // Section exists — insert at the end of it (before the next "## " heading).
  const sectionStart = m.index + m[0].length;
  const nextRel = base.slice(sectionStart).search(/\n## /);
  if (nextRel === -1) {
    return `${base}\n${bullet}\n`;
  }
  const insertAt = sectionStart + nextRel;
  return `${base.slice(0, insertAt)}\n${bullet}${base.slice(insertAt)}`;
}

// Add a learning. Writes the same text to description (NOT NULL, shown in the
// Activity feed) and metadata.learning_text (what classify-reply reads).
// user_id must equal auth.uid() to satisfy the agent_activity RLS policy.
export function useAddLearning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      text,
      leadId = null,
      leadName = null,
      leadCompany = null,
    }: {
      text: string;
      leadId?: string | null;
      leadName?: string | null;
      leadCompany?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await db.from('agent_activity').insert({
        user_id: user.id,
        lead_id: leadId,
        lead_name: leadName,
        lead_company: leadCompany,
        activity_type: 'learning_added',
        description: text,
        metadata: { learning_text: text },
      });
      if (error) throw error;

      // Additionally accumulate the lesson into the client's Agent Knowledge doc
      // under "## Learned from corrections" (the agent_activity insert above
      // still feeds classify-reply's recent-learnings section — this is purely
      // additive). Best-effort: a failure here must not fail the Teach action.
      try {
        const { data: cfg } = await db
          .from('agent_configs')
          .select('agent_knowledge')
          .eq('user_id', user.id)
          .maybeSingle();
        const next = appendLearnedBullet(cfg?.agent_knowledge ?? '', text);
        await db
          .from('agent_configs')
          .update({ agent_knowledge: next })
          .eq('user_id', user.id);
      } catch (e) {
        console.warn('[useAddLearning] agent_knowledge append failed (lesson still saved):', e);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learnings'] });
      queryClient.invalidateQueries({ queryKey: ['agent-activity'] });
      // Refresh the Agent Settings doc so the appended bullet shows up.
      queryClient.invalidateQueries({ queryKey: ['agent-config'] });
    },
  });
}

// Hard delete (agent_activity has no soft-delete column). user_id guard is
// belt-and-braces alongside the RLS DELETE policy.
export function useDeleteLearning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await db
        .from('agent_activity')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learnings'] });
      queryClient.invalidateQueries({ queryKey: ['agent-activity'] });
    },
  });
}
