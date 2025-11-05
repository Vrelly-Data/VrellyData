import { useState, FormEvent, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Filter, Search } from 'lucide-react';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';
import { FilterBuilderState } from '@/lib/filterConversion';
import { EntityType } from '@/types/audience';
import { TagInput } from '@/components/ui/tag-input';

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
            <Select
              value={filterState.companySize || ''}
              onValueChange={(value) => updateFilter('companySize', value || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select company size..." />
              </SelectTrigger>
              <SelectContent>
                {attributes.companySizeRanges.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size} employees
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* People-only filters */}
          {entityType === 'person' && (
            <>
              {/* Person Net Worth */}
              <div className="space-y-2">
                <Label>Person Net Worth</Label>
                <Select
                  value={filterState.netWorth || ''}
                  onValueChange={(value) => updateFilter('netWorth', value || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select net worth range..." />
                  </SelectTrigger>
                  <SelectContent>
                    {attributes.netWorthRanges.map((range) => (
                      <SelectItem key={range} value={range}>
                        {range}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Person Income */}
              <div className="space-y-2">
                <Label>Person Income</Label>
                <Select
                  value={filterState.income || ''}
                  onValueChange={(value) => updateFilter('income', value || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select income range..." />
                  </SelectTrigger>
                  <SelectContent>
                    {attributes.incomeRanges.map((range) => (
                      <SelectItem key={range} value={range}>
                        {range}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Select
                  value={filterState.seniority || ''}
                  onValueChange={(value) => updateFilter('seniority', value || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select seniority level..." />
                  </SelectTrigger>
                  <SelectContent>
                    {attributes.seniority.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Department */}
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={filterState.department || ''}
                  onValueChange={(value) => updateFilter('department', value || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department..." />
                  </SelectTrigger>
                  <SelectContent>
                    {attributes.departments.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Location */}
          <div className="space-y-2">
            <Label>{entityType === 'person' ? 'Person Location' : 'Company Location'}</Label>
            <TagInput
              value={filterState.cities}
              onChange={(values) => updateFilter('cities', values)}
              placeholder="Type locations and press Enter..."
              suggestions={attributes.cities}
            />
          </div>

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
