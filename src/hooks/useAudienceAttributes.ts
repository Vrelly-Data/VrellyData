import { useState, useEffect } from 'react';
import { MOCK_ATTRIBUTES, MockAttributeOptions } from '@/lib/mockData';
import { supabase } from '@/integrations/supabase/client';

async function fetchFilterCounts(field: string, limit = 200): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_filter_counts', {
    p_field: field,
    p_search: null,
    p_limit: limit,
  });
  if (error || !data) return [];
  return data.map((row: any) => row.value).filter(Boolean);
}

export function useAudienceAttributes() {
  const [attributes, setAttributes] = useState<MockAttributeOptions>(MOCK_ATTRIBUTES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAttributes();
  }, []);

  async function fetchAttributes() {
    setLoading(true);
    setError(null);

    try {
      const [industries, cities, seniority, departments, skills, technologies, states, incomeRanges, netWorthRanges] = await Promise.all([
        fetchFilterCounts('company_industry', 300),
        fetchFilterCounts('city', 300),
        fetchFilterCounts('seniority', 20),
        fetchFilterCounts('department', 100),
        fetchFilterCounts('skills', 500),
        fetchFilterCounts('technologies', 500),
        fetchFilterCounts('state', 100),
        fetchFilterCounts('income_range', 50),
        fetchFilterCounts('net_worth', 50),
      ]);

      setAttributes({
        ...MOCK_ATTRIBUTES,
        industries: industries.length > 0 ? industries : MOCK_ATTRIBUTES.industries,
        cities: cities.length > 0 ? cities : MOCK_ATTRIBUTES.cities,
        seniority: seniority.length > 0 ? seniority : ['Cxo', 'Vp', 'Director', 'Manager', 'Staff'],
        departments: departments.length > 0 ? departments : MOCK_ATTRIBUTES.departments,
        skills: skills.length > 0 ? skills : [],
        technologies: technologies.length > 0 ? technologies : [],
        states: states.length > 0 ? states : [],
        incomeRanges: incomeRanges.length > 0 ? incomeRanges : MOCK_ATTRIBUTES.incomeRanges,
        netWorthRanges: netWorthRanges.length > 0 ? netWorthRanges : MOCK_ATTRIBUTES.netWorthRanges,
      });
    } catch (err) {
      console.error('Error fetching attributes:', err);
      setError('Failed to load filter options');
      setAttributes(MOCK_ATTRIBUTES);
    } finally {
      setLoading(false);
    }
  }

  return { attributes, loading, error, refetch: fetchAttributes };
}
