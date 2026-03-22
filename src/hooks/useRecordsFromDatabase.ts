import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PersonEntity, CompanyEntity, EntityType } from '@/types/audience';
import { useToast } from '@/hooks/use-toast';

export function useRecordsFromDatabase(entityType: EntityType) {
  const [records, setRecords] = useState<(PersonEntity | CompanyEntity)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const loadRecords = async () => {
    try {
      setIsLoading(true);
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('No user found, skipping records load');
        setRecords([]);
        return;
      }

      // Get user's team
      const { data: membership } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)
        .single();

      if (!membership) {
        console.log('No team membership found');
        setRecords([]);
        return;
      }

      // Load records from appropriate table, paginating to bypass the 1000-row default
      const tableName = entityType === 'person' ? 'people_records' : 'company_records';
      const PAGE_SIZE = 1000;
      const allData: any[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .eq('team_id', membership.team_id)
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allData.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      // Extract entity_data from each record
      const extractedRecords = (allData.map(record => record.entity_data as unknown as PersonEntity | CompanyEntity) || []);
      
      console.log(`[DATABASE LOAD] Loaded ${extractedRecords.length} ${entityType} records from database`);
      
      setRecords(extractedRecords);
    } catch (error) {
      console.error('Error loading records from database:', error);
      toast({
        title: 'Error loading records',
        description: 'Failed to load records from database',
        variant: 'destructive',
      });
      setRecords([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete records from database
  const deleteRecords = async (entityIds: string[]): Promise<boolean> => {
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
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('team_id', membership.team_id)
        .in('entity_external_id', entityIds);

      if (error) throw error;

      // Update local state to remove deleted records
      setRecords(prev => prev.filter(r => !entityIds.includes(r.id)));
      
      console.log(`[DATABASE DELETE] Deleted ${entityIds.length} ${entityType} records from database`);
      
      return true;
    } catch (error) {
      console.error('Error deleting records:', error);
      return false;
    }
  };

  // Load on mount
  useEffect(() => {
    loadRecords();
  }, [entityType]);

  // Refresh function for manual reload
  const refreshRecords = () => {
    loadRecords();
  };

  return {
    records,
    setRecords,
    isLoading,
    refreshRecords,
    deleteRecords,
  };
}
