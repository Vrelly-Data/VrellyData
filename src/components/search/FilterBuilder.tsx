import { useState, FormEvent, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Filter, Search } from 'lucide-react';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';
import { FilterBuilderState } from '@/lib/filterConversion';
import { EntityType } from '@/types/audience';
import { TagInput } from '@/components/ui/tag-input';
import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';

interface FilterBuilderProps {
  entityType: EntityType;
  onSearch: (filters: FilterBuilderState) => void;
}

export function FilterBuilder({ entityType, onSearch }: FilterBuilderProps) {
  const { attributes, loading } = useAudienceAttributes();
  const [filterState, setFilterState] = useState<FilterBuilderState>({
    industries: [],
    cities: [],
    gender: null,
    jobTitles: [],
    seniority: [],
    department: [],
    companySize: [],
    companyRevenue: [],
    netWorth: [],
    income: [],
    keywords: [],
    prospectData: [],
    personCity: [],
    personCountry: [],
    companyCity: [],
    companyCountry: [],
    personInterests: [],
    personSkills: [],
  });

  const updateFilter = <K extends keyof FilterBuilderState>(
    key: K,
    value: FilterBuilderState[K]
  ) => {
    setFilterState(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    // Reset filters when entity type changes
      setFilterState({
        industries: [],
        cities: [],
        gender: null,
        jobTitles: [],
        seniority: [],
        department: [],
        companySize: [],
        companyRevenue: [],
        netWorth: [],
        income: [],
        keywords: [],
        prospectData: [],
        personCity: [],
        personCountry: [],
        companyCity: [],
        companyCountry: [],
        personInterests: [],
        personSkills: [],
      });
  }, [entityType]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSearch(filterState);
  };

  const handleSearchClick = () => {
    onSearch(filterState);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Build Your Audience
        </CardTitle>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-auto">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Keywords */}
          <div className="space-y-2">
            <Label>Keywords</Label>
            <TagInput
              value={filterState.keywords}
              onChange={(values) => updateFilter('keywords', values)}
              placeholder="Type keywords and press Enter..."
              suggestions={[]}
            />
            <p className="text-xs text-muted-foreground">
              Add keywords to search in company descriptions, job titles, and other text fields
            </p>
          </div>

          {/* People-only filters */}
          {entityType === 'person' && (
            <>
              {/* Job Titles */}
              <div className="space-y-2">
                <Label>Job Titles</Label>
                <TagInput
                  value={filterState.jobTitles}
                  onChange={(values) => updateFilter('jobTitles', values)}
                  placeholder="Type job titles and press Enter..."
                  suggestions={attributes.jobTitles}
                />
              </div>

          {/* Seniority */}
          <div className="space-y-2">
            <Label>Seniority</Label>
            <MultiSelectDropdown
              options={attributes.seniority}
              selected={filterState.seniority}
              onChange={(values) => updateFilter('seniority', values)}
              placeholder="Select seniority levels..."
            />
          </div>

          {/* Department */}
          <div className="space-y-2">
            <Label>Department</Label>
            <MultiSelectDropdown
              options={attributes.departments}
              selected={filterState.department}
              onChange={(values) => updateFilter('department', values)}
              placeholder="Select departments..."
            />
          </div>

              {/* Person City */}
              <div className="space-y-2">
                <Label>Person City</Label>
                <TagInput
                  value={filterState.personCity}
                  onChange={(values) => updateFilter('personCity', values)}
                  placeholder="Type cities and press Enter..."
                  suggestions={attributes.cities}
                />
              </div>

              {/* Person Country */}
              <div className="space-y-2">
                <Label>Person Country</Label>
                <TagInput
                  value={filterState.personCountry}
                  onChange={(values) => updateFilter('personCountry', values)}
                  placeholder="Type countries and press Enter..."
                  suggestions={[]}
                />
              </div>

              {/* Person Address */}
              <div className="space-y-2">
                <Label>Person Address</Label>
                <TagInput
                  value={filterState.cities}
                  onChange={(values) => updateFilter('cities', values)}
                  placeholder="Type addresses and press Enter..."
                  suggestions={attributes.cities}
                />
              </div>

              {/* Person Net Worth */}
              <div className="space-y-2">
                <Label>Person Net Worth</Label>
                <MultiSelectDropdown
                  options={attributes.netWorthRanges}
                  selected={filterState.netWorth}
                  onChange={(values) => updateFilter('netWorth', values)}
                  placeholder="Select net worth ranges..."
                />
              </div>

              {/* Person Income */}
              <div className="space-y-2">
                <Label>Person Income</Label>
                <MultiSelectDropdown
                  options={attributes.incomeRanges}
                  selected={filterState.income}
                  onChange={(values) => updateFilter('income', values)}
                  placeholder="Select income ranges..."
                />
              </div>

              {/* Person Interest */}
              <div className="space-y-2">
                <Label>Person Interest</Label>
                <TagInput
                  value={filterState.personInterests}
                  onChange={(values) => updateFilter('personInterests', values)}
                  placeholder="Type interests and press Enter..."
                  suggestions={[]}
                />
              </div>

              {/* Person Skill */}
              <div className="space-y-2">
                <Label>Person Skill</Label>
                <TagInput
                  value={filterState.personSkills}
                  onChange={(values) => updateFilter('personSkills', values)}
                  placeholder="Type skills and press Enter..."
                  suggestions={[]}
                />
              </div>

              {/* Gender */}
              <div className="space-y-3">
                <Label>Gender</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={filterState.gender === 'male' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateFilter('gender', filterState.gender === 'male' ? null : 'male')}
                  >
                    Male
                  </Button>
                  <Button
                    type="button"
                    variant={filterState.gender === 'female' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateFilter('gender', filterState.gender === 'female' ? null : 'female')}
                  >
                    Female
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Industry */}
          <div className="space-y-2">
            <Label>Industry</Label>
            <TagInput
              value={filterState.industries}
              onChange={(values) => updateFilter('industries', values)}
              placeholder="Type industries and press Enter..."
              suggestions={attributes.industries}
            />
          </div>

          {/* Company Size */}
          <div className="space-y-2">
            <Label>Company Size</Label>
            <MultiSelectDropdown
              options={attributes.companySizeRanges.map(range => ({
                label: `${range} employees`,
                value: range
              }))}
              selected={filterState.companySize}
              onChange={(values) => updateFilter('companySize', values)}
              placeholder="Select company sizes..."
            />
          </div>

          {/* Company Revenue */}
          <div className="space-y-2">
            <Label>Company Revenue</Label>
            <MultiSelectDropdown
              options={attributes.companyRevenueRanges.map(range => ({
                label: range,
                value: range
              }))}
              selected={filterState.companyRevenue}
              onChange={(values) => updateFilter('companyRevenue', values)}
              placeholder="Select revenue ranges..."
            />
          </div>

          {/* Company City */}
          <div className="space-y-2">
            <Label>Company City</Label>
            <TagInput
              value={filterState.companyCity}
              onChange={(values) => updateFilter('companyCity', values)}
              placeholder="Type cities and press Enter..."
              suggestions={attributes.cities}
            />
          </div>

          {/* Company Country */}
          <div className="space-y-2">
            <Label>Company Country</Label>
            <TagInput
              value={filterState.companyCountry}
              onChange={(values) => updateFilter('companyCountry', values)}
              placeholder="Type countries and press Enter..."
              suggestions={[]}
            />
          </div>

          {/* Prospect Data - Person only, at the bottom */}
          {entityType === 'person' && (
            <div className="space-y-2">
              <Label>Prospect Data</Label>
              <MultiSelectDropdown
                options={[
                  { label: 'Personal Email', value: 'personal_email' },
                  { label: 'Business Email', value: 'business_email' },
                  { label: 'Direct Mobile', value: 'direct_mobile' },
                  { label: 'Personal LinkedIn', value: 'personal_linkedin' },
                  { label: 'Personal Facebook', value: 'personal_facebook' },
                  { label: 'Personal Twitter', value: 'personal_twitter' },
                ]}
                selected={filterState.prospectData || []}
                onChange={(values) => updateFilter('prospectData', values)}
                placeholder="Select data types..."
              />
              <p className="text-xs text-muted-foreground">
                Only show contacts with these data types available
              </p>
            </div>
          )}

          {/* Hidden submit button for Enter key support */}
          <button type="submit" className="hidden" />
        </form>
      </CardContent>

      <div className="p-4 border-t">
        <Button
          className="w-full"
          size="lg"
          onClick={handleSearchClick}
        >
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>
      </div>
    </Card>
  );
}
