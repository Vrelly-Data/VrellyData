import { supabase } from '@/integrations/supabase/client';

export type AuditAction = 'unlock' | 'export' | 'role_change' | 'bulk_access' | 'secret_access' | 'save_audience';

interface LogAuditParams {
  action: AuditAction;
  entityType?: 'person' | 'company';
  entityCount?: number;
  metadata?: Record<string, any>;
}

export function useAuditLog() {
  async function logAuditEvent({
    action,
    entityType,
    entityCount = 0,
    metadata = {},
  }: LogAuditParams): Promise<{ success: boolean; error?: any }> {
    try {
      const { data, error } = await supabase.rpc('log_audit_event', {
        _action: action,
        _entity_type: entityType,
        _entity_count: entityCount,
        _metadata: metadata,
      });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error logging audit event:', error);
      return { success: false, error };
    }
  }

  return { logAuditEvent };
}
