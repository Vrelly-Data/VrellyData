import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FilterOption {
  label: string;
  value: string;
  count: number;
}

// Cache to avoid re-fetching same queries
const cache: Record<string, FilterOption[]> = {};

export function useFilterOptions(field: string, searchTerm: string = '', limit: number = 100) {
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOptions = useCallback(async () => {
    const cacheKey = `${field}:${searchTerm}:${limit}`;
    if (cache[cacheKey]) {
      setOptions(cache[cacheKey]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_filter_counts', {
        p_field: field,
        p_search: searchTerm || null,
        p_limit: limit,
      });

      if (error) throw error;

      const mapped: FilterOption[] = (data || []).map((row: any) => ({
        label: `${row.value} (${Number(row.count).toLocaleString()})`,
        value: row.value,
        count: row.count,
      }));

      cache[cacheKey] = mapped;
      setOptions(mapped);
    } catch (err) {
      console.error(`Error fetching filter options for ${field}:`, err);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [field, searchTerm, limit]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  return { options, loading };
}
