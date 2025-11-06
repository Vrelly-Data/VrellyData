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

      // Load records from appropriate table
      const tableName = entityType === 'person' ? 'people_records' : 'company_records';
      
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('team_id', membership.team_id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Extract entity_data from each record
      const extractedRecords = (data?.map(record => record.entity_data as unknown as PersonEntity | CompanyEntity) || []);
      
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
  };
}
