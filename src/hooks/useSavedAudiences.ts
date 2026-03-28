import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getDefaultFilterBuilderState, type FilterBuilderState } from '@/lib/filterConversion';

export interface AudienceFilters {
  industries: string[];
  isBtoB: boolean;
  targetTitles: string[];
  companyTypes: string[];
  companySizes: string[];
  locations: string[];
  cities?: string[];
  countries?: string[];
}

export interface SavedAudience {
  id: string;
  name: string;
  filters: AudienceFilters;
  result_count: number | null;
  preset_id: string | null;
  insights: string | null;
  created_at: string;
}

const KNOWN_COUNTRIES = new Set([
  'United States', 'United Kingdom', 'Canada', 'Australia',
  'Germany', 'France', 'India', 'Singapore', 'Netherlands',
]);

/** Map simplified AI builder filters to full FilterBuilderState for filter_presets */
function toFilterBuilderState(filters: AudienceFilters): FilterBuilderState {
  const state = getDefaultFilterBuilderState();
  state.industries = filters.industries;
  state.jobTitles = filters.targetTitles;
  state.companySize = filters.companySizes;

  // Prefer split fields; fall back to flat locations for old saved audiences
  const cities = filters.cities ||
    (filters.locations || []).filter(l => !KNOWN_COUNTRIES.has(l));
  const countries = filters.countries ||
    (filters.locations || []).filter(l => KNOWN_COUNTRIES.has(l));
  state.personCity = cities;
  state.personCountry = countries;

  state.keywords = filters.companyTypes;
  return state;
}

async function getTeamId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: membership } = await supabase
    .from('team_memberships')
    .select('team_id')
    .eq('user_id', user.id)
    .single();

  if (!membership) throw new Error('Team not found');
  return membership.team_id;
}

export function useSavedAudiences() {
  return useQuery({
    queryKey: ['saved-audiences'],
    queryFn: async (): Promise<SavedAudience[]> => {
      const { data, error } = await supabase
        .from('saved_audiences')
        .select('id, name, filters, result_count, preset_id, insights, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as SavedAudience[];
    },
  });
}

export function useSaveAudience() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      filters,
      result_count,
      insights,
      existingId,
      existingPresetId,
    }: {
      name: string;
      filters: AudienceFilters;
      result_count: number | null;
      insights?: string | null;
      existingId?: string | null;
      existingPresetId?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const teamId = await getTeamId();

      const filterBuilderState = toFilterBuilderState(filters);
      const filtersJson = JSON.parse(JSON.stringify(filterBuilderState));

      // --- filter_presets: upsert ---
      let presetId = existingPresetId;
      if (presetId) {
        const { error: updateErr } = await supabase
          .from('filter_presets')
          .update({ name, filters: filtersJson })
          .eq('id', presetId);
        if (updateErr) throw updateErr;
      } else {
        const { data: preset, error: presetErr } = await supabase
          .from('filter_presets')
          .insert({
            team_id: teamId,
            type: 'person',
            name,
            filters: filtersJson,
          })
          .select('id')
          .single();

        if (presetErr) throw presetErr;
        presetId = preset.id;
      }

      // --- saved_audiences: upsert ---
      const savedFilters = JSON.parse(JSON.stringify(filters));
      if (existingId) {
        const { error } = await supabase
          .from('saved_audiences')
          .update({
            name,
            filters: savedFilters,
            result_count,
            preset_id: presetId,
            insights: insights ?? null,
          })
          .eq('id', existingId);

        if (error) throw error;
        return { id: existingId, presetId };
      } else {
        const { data, error } = await supabase
          .from('saved_audiences')
          .insert({
            user_id: user.id,
            name,
            filters: savedFilters,
            result_count,
            preset_id: presetId,
            insights: insights ?? null,
          })
          .select('id')
          .single();

        if (error) throw error;
        return { id: data.id, presetId };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-audiences'] });
    },
  });
}

export function useDeleteSavedAudience() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, presetId }: { id: string; presetId: string | null }) => {
      const { error } = await supabase
        .from('saved_audiences')
        .delete()
        .eq('id', id);
      if (error) throw error;

      if (presetId) {
        await supabase
          .from('filter_presets')
          .delete()
          .eq('id', presetId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-audiences'] });
    },
  });
}
