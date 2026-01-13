import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface FilterSuggestions {
  interests: string[];
  skills: string[];
  industries: string[];
  technologies: string[];
}

export function useFreeDataSuggestions() {
  const [suggestions, setSuggestions] = useState<FilterSuggestions>({
    interests: [],
    skills: [],
    industries: [],
    technologies: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const { data, error } = await supabase.rpc('get_filter_suggestions');
        
        if (error) {
          console.error('Error fetching filter suggestions:', error);
          return;
        }

        if (data) {
          const parsed = data as { interests?: string[]; skills?: string[]; industries?: string[]; technologies?: string[] };
          setSuggestions({
            interests: (parsed.interests || []).filter(Boolean),
            skills: (parsed.skills || []).filter(Boolean),
            industries: (parsed.industries || []).filter(Boolean),
            technologies: (parsed.technologies || []).filter(Boolean),
          });
        }
      } catch (err) {
        console.error('Error fetching filter suggestions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, []);

  return { suggestions, loading };
}
