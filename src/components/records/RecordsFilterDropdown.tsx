import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EntityType } from '@/types/audience';
import { SmartFilterDialog } from './SmartFilterDialog';

interface RecordsFilterDropdownProps {
  entityType: EntityType;
  onFilterApply?: (filter: any) => void;
}

export function RecordsFilterDropdown({ entityType, onFilterApply }: RecordsFilterDropdownProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState<any>(null);

  const handleFilterApply = (filter: any) => {
    setAppliedFilter(filter);
    if (onFilterApply) {
      onFilterApply(filter);
    }
  };

  const getFilterSummary = () => {
    if (!appliedFilter) return null;
    
    const conditionsCount = appliedFilter.rule.conditions.length;
    if (conditionsCount === 0) return null;
    
    return `${conditionsCount} condition${conditionsCount > 1 ? 's' : ''}`;
  };

  const filterSummary = getFilterSummary();

  return (
    <>
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => setDialogOpen(true)}
      >
        <Filter className="h-4 w-4 mr-2" />
        Filters
        {filterSummary && (
          <Badge variant="secondary" className="ml-2">
            {filterSummary}
          </Badge>
        )}
      </Button>

      <SmartFilterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityType={entityType}
        onApply={handleFilterApply}
      />
    </>
  );
}
