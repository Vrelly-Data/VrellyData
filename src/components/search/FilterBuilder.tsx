import { useState, FormEvent, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
    seniority: null,
    department: null,
    companySize: null,
    netWorth: null,
    income: null,
    keywords: [],
    prospectData: [],
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
        seniority: null,
        department: null,
        companySize: null,
        netWorth: null,
        income: null,
        keywords: [],
        prospectData: [],
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
                <ToggleGroup
                  type="single"
                  value={filterState.seniority || ''}
                  onValueChange={(value) => updateFilter('seniority', value || null)}
                  className="flex flex-wrap gap-2 justify-start"
                >
                  {attributes.seniority.map((level) => (
                    <ToggleGroupItem 
                      key={level} 
                      value={level}
                      variant="outline"
                      className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {level}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Department */}
              <div className="space-y-2">
                <Label>Department</Label>
                <ToggleGroup
                  type="single"
                  value={filterState.department || ''}
                  onValueChange={(value) => updateFilter('department', value || null)}
                  className="flex flex-wrap gap-2 justify-start"
                >
                  {attributes.departments.map((dept) => (
                    <ToggleGroupItem 
                      key={dept} 
                      value={dept}
                      variant="outline"
                      className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {dept}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Person Location */}
              <div className="space-y-2">
                <Label>Person Location</Label>
                <TagInput
                  value={filterState.cities}
                  onChange={(values) => updateFilter('cities', values)}
                  placeholder="Type locations and press Enter..."
                  suggestions={attributes.cities}
                />
              </div>

              {/* Person Net Worth */}
              <div className="space-y-2">
                <Label>Person Net Worth</Label>
                <ToggleGroup
                  type="single"
                  value={filterState.netWorth || ''}
                  onValueChange={(value) => updateFilter('netWorth', value || null)}
                  className="flex flex-col gap-2"
                >
                  {attributes.netWorthRanges.map((range) => (
                    <ToggleGroupItem 
                      key={range} 
                      value={range}
                      variant="outline"
                      className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground justify-start"
                    >
                      {range}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Person Income */}
              <div className="space-y-2">
                <Label>Person Income</Label>
                <ToggleGroup
                  type="single"
                  value={filterState.income || ''}
                  onValueChange={(value) => updateFilter('income', value || null)}
                  className="flex flex-col gap-2"
                >
                  {attributes.incomeRanges.map((range) => (
                    <ToggleGroupItem 
                      key={range} 
                      value={range}
                      variant="outline"
                      className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground justify-start"
                    >
                      {range}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Gender */}
              <div className="space-y-3">
                <Label>Gender</Label>
                <RadioGroup
                  value={filterState.gender || ''}
                  onValueChange={(value) => updateFilter('gender', value as 'male' | 'female' | null)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="male" id="male" />
                    <Label htmlFor="male" className="font-normal cursor-pointer">Male</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="female" id="female" />
                    <Label htmlFor="female" className="font-normal cursor-pointer">Female</Label>
                  </div>
                </RadioGroup>
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
            <ToggleGroup
              type="single"
              value={filterState.companySize || ''}
              onValueChange={(value) => updateFilter('companySize', value || null)}
              className="flex flex-col gap-2"
            >
              {attributes.companySizeRanges.map((size) => (
                <ToggleGroupItem 
                  key={size} 
                  value={size}
                  variant="outline"
                  className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground justify-start"
                >
                  {size} employees
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
