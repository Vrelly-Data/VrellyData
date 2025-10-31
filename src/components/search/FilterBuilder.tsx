import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Filter, X, Search } from 'lucide-react';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';
import { useAudienceStore } from '@/stores/audienceStore';
import { FilterBuilderState } from '@/lib/filterConversion';
import { EntityType } from '@/types/audience';
import { MultiSelectDropdown } from './MultiSelectDropdown';

interface FilterBuilderProps {
  entityType: EntityType;
  onSearch: (filters: FilterBuilderState) => void;
}

export function FilterBuilder({ entityType, onSearch }: FilterBuilderProps) {
  const { attributes, loading } = useAudienceAttributes();
  const [filterState, setFilterState] = useState<FilterBuilderState>({
    segments: [],
    age: null,
    cities: [],
    gender: [],
    industries: [],
    jobTitles: [],
    seniority: [],
    departments: [],
    daysBack: 30,
    companySize: [],
    fundingStage: [],
  });

  const updateFilter = <K extends keyof FilterBuilderState>(
    key: K,
    value: FilterBuilderState[K]
  ) => {
    setFilterState(prev => ({ ...prev, [key]: value }));
  };

  const clearAllFilters = () => {
    setFilterState({
      segments: [],
      age: null,
      cities: [],
      gender: [],
      industries: [],
      jobTitles: [],
      seniority: [],
      departments: [],
      daysBack: 30,
      companySize: [],
      fundingStage: [],
    });
  };

  const removeFilter = (key: keyof FilterBuilderState) => {
    if (key === 'age') {
      updateFilter('age', null);
    } else if (Array.isArray(filterState[key])) {
      updateFilter(key as any, []);
    }
  };

  const activeFilterCount = [
    filterState.segments.length > 0,
    filterState.age !== null,
    filterState.cities.length > 0,
    filterState.gender.length > 0,
    filterState.industries.length > 0,
    filterState.jobTitles.length > 0,
    filterState.seniority.length > 0,
    filterState.departments.length > 0,
    entityType === 'company' && filterState.companySize && filterState.companySize.length > 0,
    entityType === 'company' && filterState.fundingStage && filterState.fundingStage.length > 0,
  ].filter(Boolean).length;

  const isValidSearch = filterState.segments.length > 0;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Build Your Audience
        </CardTitle>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-auto space-y-6">
        {/* Segment Selection - Required */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            Segment <span className="text-destructive">*</span>
          </Label>
          <MultiSelectDropdown
            options={attributes.segments}
            selected={filterState.segments}
            onChange={(values) => updateFilter('segments', values)}
            placeholder="Select segments..."
            loading={loading}
          />
          {filterState.segments.length === 0 && (
            <p className="text-xs text-muted-foreground">At least one segment is required</p>
          )}
        </div>

        {entityType === 'person' && (
          <>
            <Separator />

            {/* Demographics */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Demographics</h3>
              
              {/* Age Range */}
              <div className="space-y-2">
                <Label>Age Range</Label>
                <div className="pt-2">
                  <Slider
                    min={18}
                    max={80}
                    step={1}
                    value={filterState.age ? [filterState.age.min, filterState.age.max] : [25, 60]}
                    onValueChange={([min, max]) => updateFilter('age', { min, max })}
                    className="w-full"
                  />
                  <div className="flex justify-between mt-2 text-sm text-muted-foreground">
                    <span>{filterState.age?.min || 25}</span>
                    <span>{filterState.age?.max || 60}</span>
                  </div>
                </div>
              </div>

              {/* Gender */}
              <div className="space-y-2">
                <Label>Gender</Label>
                <div className="flex flex-wrap gap-3">
                  {attributes.gender.map((g) => (
                    <div key={g} className="flex items-center space-x-2">
                      <Checkbox
                        id={`gender-${g}`}
                        checked={filterState.gender.includes(g)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            updateFilter('gender', [...filterState.gender, g]);
                          } else {
                            updateFilter('gender', filterState.gender.filter(x => x !== g));
                          }
                        }}
                      />
                      <label htmlFor={`gender-${g}`} className="text-sm capitalize cursor-pointer">
                        {g}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            {/* Location */}
            <div className="space-y-2">
              <Label>Cities</Label>
              <MultiSelectDropdown
                options={attributes.cities}
                selected={filterState.cities}
                onChange={(values) => updateFilter('cities', values)}
                placeholder="Select cities..."
              />
            </div>

            <Separator />

            {/* Professional */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Professional</h3>
              
              <div className="space-y-2">
                <Label>Industries</Label>
                <MultiSelectDropdown
                  options={attributes.industries}
                  selected={filterState.industries}
                  onChange={(values) => updateFilter('industries', values)}
                  placeholder="Select industries..."
                />
              </div>

              <div className="space-y-2">
                <Label>Job Titles</Label>
                <MultiSelectDropdown
                  options={attributes.jobTitles}
                  selected={filterState.jobTitles}
                  onChange={(values) => updateFilter('jobTitles', values)}
                  placeholder="Select job titles..."
                />
              </div>

              <div className="space-y-2">
                <Label>Seniority</Label>
                <MultiSelectDropdown
                  options={attributes.seniority}
                  selected={filterState.seniority}
                  onChange={(values) => updateFilter('seniority', values)}
                  placeholder="Select seniority levels..."
                />
              </div>

              <div className="space-y-2">
                <Label>Departments</Label>
                <MultiSelectDropdown
                  options={attributes.departments}
                  selected={filterState.departments}
                  onChange={(values) => updateFilter('departments', values)}
                  placeholder="Select departments..."
                />
              </div>
            </div>
          </>
        )}

        {entityType === 'company' && (
          <>
            <Separator />

            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Company Filters</h3>
              
              <div className="space-y-2">
                <Label>Industries</Label>
                <MultiSelectDropdown
                  options={attributes.industries}
                  selected={filterState.industries}
                  onChange={(values) => updateFilter('industries', values)}
                  placeholder="Select industries..."
                />
              </div>

              <div className="space-y-2">
                <Label>Location</Label>
                <MultiSelectDropdown
                  options={attributes.cities}
                  selected={filterState.cities}
                  onChange={(values) => updateFilter('cities', values)}
                  placeholder="Select cities..."
                />
              </div>

              <div className="space-y-2">
                <Label>Company Size</Label>
                <MultiSelectDropdown
                  options={attributes.companySize}
                  selected={filterState.companySize || []}
                  onChange={(values) => updateFilter('companySize', values)}
                  placeholder="Select company sizes..."
                />
              </div>

              <div className="space-y-2">
                <Label>Funding Stage</Label>
                <MultiSelectDropdown
                  options={attributes.fundingStage}
                  selected={filterState.fundingStage || []}
                  onChange={(values) => updateFilter('fundingStage', values)}
                  placeholder="Select funding stages..."
                />
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Data Freshness */}
        <div className="space-y-2">
          <Label>Days Back</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={filterState.daysBack}
            onChange={(e) => updateFilter('daysBack', parseInt(e.target.value) || 30)}
            placeholder="30"
          />
          <p className="text-xs text-muted-foreground">How far back to search for data</p>
        </div>

        <Separator />

        {/* Active Filters */}
        {activeFilterCount > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Active Filters ({activeFilterCount})</Label>
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                Clear All
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {filterState.segments.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  Segments: {filterState.segments.length}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => removeFilter('segments')} />
                </Badge>
              )}
              {filterState.age && (
                <Badge variant="secondary" className="gap-1">
                  Age: {filterState.age.min}-{filterState.age.max}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => removeFilter('age')} />
                </Badge>
              )}
              {filterState.cities.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  Cities: {filterState.cities.length}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => removeFilter('cities')} />
                </Badge>
              )}
              {filterState.gender.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  Gender: {filterState.gender.length}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => removeFilter('gender')} />
                </Badge>
              )}
              {filterState.industries.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  Industries: {filterState.industries.length}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => removeFilter('industries')} />
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <div className="p-4 border-t">
        <Button
          className="w-full"
          size="lg"
          onClick={() => onSearch(filterState)}
          disabled={!isValidSearch}
        >
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>
      </div>
    </Card>
  );
}
