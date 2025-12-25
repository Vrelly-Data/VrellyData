import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterRule, PropertyDefinition } from '@/types/filterProperties';
import { FilterConditionRow } from './FilterConditionRow';

interface FilterGroupProps {
  rule: FilterRule;
  properties: PropertyDefinition[];
  onAddCondition: (groupId: string) => void;
  onRemoveCondition: (conditionId: string) => void;
  onUpdateCondition: (conditionId: string, updates: any) => void;
  onApply?: () => void;
}

export function FilterGroup({ 
  rule, 
  properties, 
  onAddCondition, 
  onRemoveCondition, 
  onUpdateCondition,
  onApply
}: FilterGroupProps) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="space-y-3">
        {rule.conditions.map((condition, index) => (
          <div key={condition.id}>
            {index > 0 && (
              <div className="flex items-center gap-2 my-2">
                <div className="h-px bg-border flex-1" />
                <span className="text-xs text-muted-foreground uppercase font-medium px-2">
                  Or
                </span>
                <div className="h-px bg-border flex-1" />
              </div>
            )}
            <FilterConditionRow
              condition={condition}
              properties={properties}
              onUpdate={(updates) => onUpdateCondition(condition.id, updates)}
              onRemove={() => onRemoveCondition(condition.id)}
              onApply={onApply}
            />
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddCondition(rule.id)}
        className="text-muted-foreground"
      >
        <Plus className="h-4 w-4 mr-1" />
        Or
      </Button>

      {rule.groups && Array.isArray(rule.groups) && rule.groups.map((group) => (
        <div key={group.id} className="ml-4 mt-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px bg-border flex-1" />
            <span className="text-xs text-muted-foreground uppercase font-medium px-2">
              And
            </span>
            <div className="h-px bg-border flex-1" />
          </div>
          <FilterGroup
            rule={group}
            properties={properties}
            onAddCondition={onAddCondition}
            onRemoveCondition={onRemoveCondition}
            onUpdateCondition={onUpdateCondition}
            onApply={onApply}
          />
        </div>
      ))}
    </div>
  );
}
