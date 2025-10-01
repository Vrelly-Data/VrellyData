import { create } from 'zustand';
import { FilterDSL, PersonEntity, CompanyEntity, EntityType } from '@/types/audience';

interface AudienceState {
  currentType: EntityType;
  filters: FilterDSL | null;
  results: (PersonEntity | CompanyEntity)[];
  totalEstimate: number;
  loading: boolean;
  selectedEntity: PersonEntity | CompanyEntity | null;
  
  setCurrentType: (type: EntityType) => void;
  setFilters: (filters: FilterDSL | null) => void;
  setResults: (results: (PersonEntity | CompanyEntity)[]) => void;
  setTotalEstimate: (total: number) => void;
  setLoading: (loading: boolean) => void;
  setSelectedEntity: (entity: PersonEntity | CompanyEntity | null) => void;
  reset: () => void;
}

export const useAudienceStore = create<AudienceState>((set) => ({
  currentType: 'person',
  filters: null,
  results: [],
  totalEstimate: 0,
  loading: false,
  selectedEntity: null,
  
  setCurrentType: (type) => set({ currentType: type, results: [], totalEstimate: 0 }),
  setFilters: (filters) => set({ filters }),
  setResults: (results) => set({ results }),
  setTotalEstimate: (total) => set({ totalEstimate: total }),
  setLoading: (loading) => set({ loading }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  reset: () => set({
    filters: null,
    results: [],
    totalEstimate: 0,
    selectedEntity: null,
  }),
}));
