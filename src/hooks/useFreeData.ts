import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export interface FreeDataRecord {
  id: string;
  entity_type: 'person' | 'company';
  entity_data: Record<string, any>;
  entity_external_id: string;
  source_template_id: string | null;
  uploaded_by: string;
  created_at: string;
}

export function useFreeData(entityType?: 'person' | 'company') {
  const [records, setRecords] = useState<FreeDataRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const { user } = useAuthStore();

  const fetchRecords = async (page = 1, pageSize = 50) => {
    setLoading(true);
    try {
      let query = supabase
        .from('free_data')
        .select('*', { count: 'exact' });

      if (entityType) {
        query = query.eq('entity_type', entityType);
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (error) throw error;
      
      setRecords((data || []) as FreeDataRecord[]);
      setTotalCount(count || 0);
    } catch (error: any) {
      console.error('Error fetching free data:', error);
      toast.error('Failed to load free data');
    } finally {
      setLoading(false);
    }
  };

  const uploadFreeData = async (
    records: Array<{
      entity_type: 'person' | 'company';
      entity_data: Record<string, any>;
      entity_external_id: string;
      source_template_id?: string;
    }>
  ) => {
    if (!user) return { success: false, count: 0 };

    try {
      const recordsWithUser = records.map(r => ({
        ...r,
        uploaded_by: user.id
      }));

      const { data, error } = await supabase
        .from('free_data')
        .upsert(recordsWithUser, {
          onConflict: 'entity_type,entity_external_id',
          ignoreDuplicates: false
        })
        .select();

      if (error) throw error;

      await fetchRecords();
      toast.success(`Uploaded ${data?.length || 0} records`);
      return { success: true, count: data?.length || 0 };
    } catch (error: any) {
      console.error('Error uploading free data:', error);
      toast.error(error.message || 'Failed to upload free data');
      return { success: false, count: 0 };
    }
  };

  const deleteFreeData = async (ids: string[]) => {
    try {
      const { error } = await supabase
        .from('free_data')
        .delete()
        .in('id', ids);

      if (error) throw error;

      await fetchRecords();
      toast.success(`Deleted ${ids.length} records`);
      return true;
    } catch (error: any) {
      console.error('Error deleting free data:', error);
      toast.error(error.message || 'Failed to delete free data');
      return false;
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [entityType]);

  return {
    records,
    loading,
    totalCount,
    uploadFreeData,
    deleteFreeData,
    refetch: fetchRecords
  };
}
