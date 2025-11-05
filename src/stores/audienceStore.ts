import { create } from 'zustand';
import { FilterDSL, PersonEntity, CompanyEntity, EntityType } from '@/types/audience';
import { FilterBuilderState } from '@/lib/filterConversion';
import { MockAttributeOptions, MOCK_ATTRIBUTES } from '@/lib/mockData';

interface AudienceState {
  currentType: EntityType;
  filters: FilterDSL | null;
  results: (PersonEntity | CompanyEntity)[];
  totalEstimate: number;
  loading: boolean;
  selectedEntity: PersonEntity | CompanyEntity | null;
  
  // Filter builder state
  filterBuilderState: FilterBuilderState;
  availableAttributes: MockAttributeOptions;
  
  // Pagination
  currentPage: number;
  perPage: number;
  totalPages: number;
  
  // Cost estimation
  estimatedCost: number;
  estimatedResults: number;
  
  setCurrentType: (type: EntityType) => void;
  setFilters: (filters: FilterDSL | null) => void;
  setResults: (results: (PersonEntity | CompanyEntity)[]) => void;
  setTotalEstimate: (total: number) => void;
  setLoading: (loading: boolean) => void;
  setSelectedEntity: (entity: PersonEntity | CompanyEntity | null) => void;
  setFilterBuilderState: (state: FilterBuilderState) => void;
  setAvailableAttributes: (attributes: MockAttributeOptions) => void;
  setCurrentPage: (page: number) => void;
  setPerPage: (perPage: number) => void;
  setTotalPages: (pages: number) => void;
  setEstimatedCost: (cost: number) => void;
  setEstimatedResults: (results: number) => void;
  reset: () => void;
}

export const useAudienceStore = create<AudienceState>((set) => ({
  currentType: 'person',
  filters: null,
  results: [],
  totalEstimate: 0,
  loading: false,
  selectedEntity: null,
  
  filterBuilderState: {
    industries: [],
    cities: [],
    gender: null,
    jobTitles: [],
    seniority: null,
    department: null,
    companySize: null,
    netWorth: null,
    income: null,
    keywords: [],
    prospectData: null,
  },
  availableAttributes: MOCK_ATTRIBUTES,
  
  currentPage: 1,
  perPage: 100,
  totalPages: 1,
  
  estimatedCost: 0,
  estimatedResults: 0,
  
  setCurrentType: (type) => set({ currentType: type, results: [], totalEstimate: 0, currentPage: 1 }),
  setFilters: (filters) => set({ filters }),
  setResults: (results) => set({ results }),
  setTotalEstimate: (total) => set({ totalEstimate: total }),
  setLoading: (loading) => set({ loading }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setFilterBuilderState: (state) => set({ filterBuilderState: state }),
  setAvailableAttributes: (attributes) => set({ availableAttributes: attributes }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setPerPage: (perPage) => set({ perPage, currentPage: 1 }),
  setTotalPages: (pages) => set({ totalPages: pages }),
  setEstimatedCost: (cost) => set({ estimatedCost: cost }),
  setEstimatedResults: (results) => set({ estimatedResults: results }),
  reset: () => set({
    filters: null,
    results: [],
    totalEstimate: 0,
    selectedEntity: null,
    currentPage: 1,
    estimatedCost: 0,
    estimatedResults: 0,
  }),
}));
