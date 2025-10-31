import { useState, FormEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Filter, Search } from 'lucide-react';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';
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
    industries: [],
    cities: [],
    gender: null,
    jobTitles: [],
    companySize: null,
    netWorth: null,
    income: null,
  });

  const updateFilter = <K extends keyof FilterBuilderState>(
    key: K,
    value: FilterBuilderState[K]
  ) => {
    setFilterState(prev => ({ ...prev, [key]: value }));
  };

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
          {/* Industry */}
          <div className="space-y-2">
            <Label>Industry</Label>
            <MultiSelectDropdown
              options={attributes.industries}
              selected={filterState.industries}
              onChange={(values) => updateFilter('industries', values)}
              placeholder="Type to search industries..."
              loading={loading}
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
                <MultiSelectDropdown
                  options={attributes.jobTitles}
                  selected={filterState.jobTitles}
                  onChange={(values) => updateFilter('jobTitles', values)}
                  placeholder="Type to search job titles..."
                  loading={loading}
                />
              </div>
            </>
          )}

          {/* Location */}
          <div className="space-y-2">
            <Label>Location</Label>
            <MultiSelectDropdown
              options={attributes.cities}
              selected={filterState.cities}
              onChange={(values) => updateFilter('cities', values)}
              placeholder="Type to search locations..."
              loading={loading}
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
