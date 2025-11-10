import { useState, useEffect } from 'react';
import { MOCK_ATTRIBUTES, MockAttributeOptions } from '@/lib/mockData';
import { audienceLabClient } from '@/lib/audienceLabClient';

const MOCK_MODE = false;

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
      if (MOCK_MODE) {
        // Return mock attributes
        await new Promise(resolve => setTimeout(resolve, 300));
        setAttributes(MOCK_ATTRIBUTES);
      } else {
        // Fetch real attributes from API
        const [segments, industries, departments, seniority] = await Promise.all([
          audienceLabClient.getAttributes('segments'),
          audienceLabClient.getAttributes('industries'),
          audienceLabClient.getAttributes('departments'),
          audienceLabClient.getAttributes('seniority'),
        ]);
        
        setAttributes({
          industries: industries || MOCK_ATTRIBUTES.industries,
          cities: MOCK_ATTRIBUTES.cities,
          jobTitles: MOCK_ATTRIBUTES.jobTitles,
          seniority: MOCK_ATTRIBUTES.seniority,
          departments: MOCK_ATTRIBUTES.departments,
          companySizeRanges: MOCK_ATTRIBUTES.companySizeRanges,
          netWorthRanges: MOCK_ATTRIBUTES.netWorthRanges,
          incomeRanges: MOCK_ATTRIBUTES.incomeRanges,
        });
      }
    } catch (err) {
      console.error('Error fetching attributes:', err);
      setError('Failed to load filter options');
      // Fall back to mock data
      setAttributes(MOCK_ATTRIBUTES);
    } finally {
      setLoading(false);
    }
  }

  return { attributes, loading, error, refetch: fetchAttributes };
}
