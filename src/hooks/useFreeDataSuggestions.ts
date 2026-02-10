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
          const titleCase = (s: string) =>
            s.trim().split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');

          const dedup = (arr: string[]) =>
            [...new Set(arr.filter(Boolean).map(s => titleCase(s)))];

          setSuggestions({
            interests: dedup(parsed.interests || []),
            skills: dedup(parsed.skills || []),
            industries: dedup(parsed.industries || []),
            technologies: dedup(parsed.technologies || []),
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
