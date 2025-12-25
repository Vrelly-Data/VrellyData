import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EntityType } from '@/types/audience';
import { useSmartFilter } from '@/hooks/useSmartFilter';
import { FilterGroup } from './FilterGroup';
import { COMPANY_FILTER_PROPERTIES } from '@/config/companyFilterProperties';
import { PERSON_FILTER_PROPERTIES } from '@/config/personFilterProperties';
import { useAudienceAttributes } from '@/hooks/useAudienceAttributes';

interface SmartFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: EntityType;
  onApply: (filter: any) => void;
  onSave?: (filter: any) => void;
}

export function SmartFilterDialog({ 
  open, 
  onOpenChange, 
  entityType,
  onApply,
  onSave
}: SmartFilterDialogProps) {
  const { attributes } = useAudienceAttributes();
  const { filter, addCondition, removeCondition, updateCondition, addGroup, setFilterName, reset } = useSmartFilter(entityType);

  // Get properties based on entity type and populate with dynamic options
  const getProperties = () => {
    const baseProperties = entityType === 'company' 
      ? COMPANY_FILTER_PROPERTIES 
      : PERSON_FILTER_PROPERTIES;
    
    return baseProperties.map(prop => {
      // Populate dynamic options from attributes
      if (prop.id === 'industry' && attributes.industries) {
        return { ...prop, options: attributes.industries.map(i => ({ label: i, value: i })) };
      }
      if (prop.id === 'company_size' && attributes.companySizeRanges) {
        return { ...prop, options: attributes.companySizeRanges.map(c => ({ label: c, value: c })) };
      }
      if (prop.id === 'technologies') {
        return { ...prop, options: [
          { label: 'React', value: 'react' },
          { label: 'Node.js', value: 'nodejs' },
          { label: 'Python', value: 'python' },
        ]};
      }
      return prop;
    });
  };

  const properties = getProperties();

  const handleApply = () => {
    onApply(filter);
    onOpenChange(false);
  };

  const handleSave = () => {
    if (onSave && filter.name) {
      onSave(filter);
      onOpenChange(false);
      reset();
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New smart filter</DialogTitle>
          <DialogDescription>
            Create a custom filter to find {entityType === 'company' ? 'companies' : 'people'} that match your criteria
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Filter Name Input */}
          <div className="space-y-2">
            <Label htmlFor="filter-name">Filter Name (optional)</Label>
            <Input
              id="filter-name"
              placeholder="e.g., Tech companies in SF"
              value={filter.name}
              onChange={(e) => setFilterName(e.target.value)}
            />
          </div>

          {/* Filter Builder */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Where</span>
            </div>
            
            <FilterGroup
              rule={filter.rule}
              properties={properties}
              onAddCondition={addCondition}
              onRemoveCondition={removeCondition}
              onUpdateCondition={updateCondition}
              onApply={handleApply}
            />

            {/* Add AND Group Button */}
            {/* <Button
              variant="outline"
              size="sm"
              onClick={addGroup}
              className="mt-3"
            >
              <Plus className="h-4 w-4 mr-1" />
              And
            </Button> */}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleApply}>
            Apply
          </Button>
          {onSave && (
            <Button onClick={handleSave} disabled={!filter.name}>
              Save Filter
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
