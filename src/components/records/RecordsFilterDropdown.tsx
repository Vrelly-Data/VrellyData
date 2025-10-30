import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EntityType } from '@/types/audience';
import { SmartFilterDialog } from './SmartFilterDialog';
import { SmartFilter } from '@/types/filterProperties';

interface RecordsFilterDropdownProps {
  entityType: EntityType;
  onFilterApply?: (filter: SmartFilter | null) => void;
}

export function RecordsFilterDropdown({ entityType, onFilterApply }: RecordsFilterDropdownProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [appliedFilter, setAppliedFilter] = useState<SmartFilter | null>(null);

  const handleFilterApply = (filter: SmartFilter) => {
    setAppliedFilter(filter);
    if (onFilterApply) {
      onFilterApply(filter);
    }
  };

  const handleClearFilter = () => {
    setAppliedFilter(null);
    if (onFilterApply) {
      onFilterApply(null);
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
      <div className="flex gap-2">
        <Button 
          variant={appliedFilter ? "default" : "outline"} 
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
        {appliedFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearFilter}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <SmartFilterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityType={entityType}
        onApply={handleFilterApply}
      />
    </>
  );
}
