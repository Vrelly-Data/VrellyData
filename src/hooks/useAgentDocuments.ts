import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Cast to any until types are regenerated after the agent_documents migration.
const db = supabase as any;

const BUCKET = 'client-documents';

export interface AgentDocument {
  id: string;
  user_id: string;
  team_id: string | null;
  title: string;
  description: string | null;
  storage_path: string;
  file_name: string | null;
  public_url: string | null;
  created_at: string;
  updated_at: string;
}

// Keep object keys safe + collision-free: "<user_id>/<time>-<slug>.<ext>".
// The first path segment MUST be user_id to satisfy the storage RLS policies.
function buildStoragePath(userId: string, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > -1 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'pdf';
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${userId}/${stamp}.${ext || 'pdf'}`;
}

export function useAgentDocuments() {
  return useQuery<AgentDocument[]>({
    queryKey: ['agent-documents'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await db
        .from('agent_documents')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentDocument[];
    },
  });
}

export function useUploadAgentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      title,
      description,
    }: {
      file: File;
      title: string;
      description?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const storagePath = buildStoragePath(user.id, file.name);

      // 1. Upload the file to the public bucket.
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || 'application/pdf',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      // 2. Resolve the public URL (bucket is public).
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const publicUrl = pub?.publicUrl ?? null;

      // 3. Create the row. If this fails, best-effort clean up the orphan object.
      const { data, error } = await db
        .from('agent_documents')
        .insert({
          user_id: user.id,
          title: title.trim(),
          description: description?.trim() || null,
          storage_path: storagePath,
          file_name: file.name,
          public_url: publicUrl,
        })
        .select()
        .single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
        throw error;
      }
      return data as AgentDocument;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-documents'] }),
  });
}

export function useUpdateAgentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      title,
      description,
    }: {
      id: string;
      title: string;
      description?: string | null;
    }) => {
      const { error } = await db
        .from('agent_documents')
        .update({
          title: title.trim(),
          description: description?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-documents'] }),
  });
}

export function useDeleteAgentDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: AgentDocument) => {
      // Remove the storage object first (best-effort), then the row.
      await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {});
      const { error } = await db.from('agent_documents').delete().eq('id', doc.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-documents'] }),
  });
}
