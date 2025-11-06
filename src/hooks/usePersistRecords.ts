import { supabase } from '@/integrations/supabase/client';
import { EntityType, PersonEntity, CompanyEntity } from '@/types/audience';
import { extractCompaniesFromPeople } from '@/lib/companyExtraction';

export function usePersistRecords() {
  async function saveRecords(
    entities: (PersonEntity | CompanyEntity)[],
    entityType: EntityType,
    source: 'export' | 'list' | 'send' | 'auto-extracted' | 'update'
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

      // Auto-create companies from people records
      if (entityType === 'person') {
        const companies = extractCompaniesFromPeople(entities as PersonEntity[]);
        
        if (companies.length > 0) {
          console.log('[AUTO-COMPANY EXTRACTION]', {
            peopleCount: entities.length,
            companiesExtracted: companies.length,
            sampleCompany: companies[0],
          });
          
          const companyRecords = companies.map(company => ({
            team_id: membership.team_id,
            entity_external_id: company.id,
            entity_data: company as any,
            source: 'auto-extracted' as const,
          }));
          
          const { error: companyError } = await supabase
            .from('company_records')
            .upsert(companyRecords, {
              onConflict: 'team_id,entity_external_id',
              ignoreDuplicates: false,
            });
          
          if (companyError) {
            console.error('[AUTO-COMPANY EXTRACTION ERROR]', companyError);
            // Don't throw - people save succeeded, company extraction is bonus
          } else {
            console.log('[AUTO-COMPANY EXTRACTION SUCCESS]', {
              savedCompanies: companies.length,
            });
          }
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Error saving records:', error);
      return { success: false, error };
    }
  }

  return { saveRecords };
}
