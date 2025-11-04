import { supabase } from '@/integrations/supabase/client';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';

export function usePersistRecords() {
  async function saveRecords(
    entities: (PersonEntity | CompanyEntity)[],
    entityType: EntityType,
    source: 'export' | 'list' | 'send'
  ) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) throw new Error('No team membership found');

      const tableName = entityType === 'person' ? 'people_records' : 'company_records';
      
      const records = entities.map(entity => ({
        team_id: membership.team_id,
        entity_external_id: entity.id,
        entity_data: entity as any,
        source,
      }));

      const { error } = await supabase
        .from(tableName)
        .upsert(records, {
          onConflict: 'team_id,entity_external_id',
          ignoreDuplicates: false,
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Error saving records:', error);
      return { success: false, error };
    }
  }

  return { saveRecords };
}
