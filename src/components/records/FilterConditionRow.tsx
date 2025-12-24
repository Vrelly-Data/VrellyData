import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { FilterCondition, PropertyDefinition, OPERATOR_LABELS, OperatorType } from '@/types/filterProperties';
import { TextInput } from './filter-inputs/TextInput';
import { NumberInput } from './filter-inputs/NumberInput';
import { SelectInput } from './filter-inputs/SelectInput';
import { MultiSelectInput } from './filter-inputs/MultiSelectInput';
import { ComboMultiSelectInput } from './filter-inputs/ComboMultiSelectInput';
import { BooleanInput } from './filter-inputs/BooleanInput';
import { CurrencyInput } from './filter-inputs/CurrencyInput';
import { DateInput } from './filter-inputs/DateInput';
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterConditionRowProps {
  condition: FilterCondition;
  properties: PropertyDefinition[];
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
}

export function FilterConditionRow({ condition, properties, onUpdate, onRemove }: FilterConditionRowProps) {
  const [propertyOpen, setPropertyOpen] = useState(false);
  
  const selectedProperty = properties.find(p => p.id === condition.property);
  
  const handlePropertyChange = (propertyId: string) => {
    const property = properties.find(p => p.id === propertyId);
    if (property) {
      onUpdate({ 
        property: propertyId,
        operator: property.operators[0],
        value: property.type === 'boolean' ? false : property.type === 'multiselect' ? [] : ''
      });
    }
    setPropertyOpen(false);
  };

  const handleOperatorChange = (operator: OperatorType) => {
    onUpdate({ operator });
  };

  const handleValueChange = (value: any) => {
    onUpdate({ value });
  };

  const renderValueInput = () => {
    if (!selectedProperty) return null;

    // Operators that don't need a value input
    if (['is_empty', 'is_not_empty', 'is_known', 'is_unknown'].includes(condition.operator)) {
      return null;
    }

    switch (selectedProperty.type) {
      case 'text':
      case 'url':
        return (
          <TextInput
            value={condition.value}
            onChange={handleValueChange}
            placeholder={selectedProperty.placeholder}
          />
        );
      case 'number':
        return (
          <NumberInput
            value={condition.value}
            onChange={handleValueChange}
            placeholder={selectedProperty.placeholder}
            unit={selectedProperty.unit}
          />
        );
      case 'currency':
        return (
          <CurrencyInput
            value={condition.value}
            onChange={handleValueChange}
            placeholder={selectedProperty.placeholder}
            unit={selectedProperty.unit}
          />
        );
      case 'date':
        return (
          <DateInput
            value={condition.value}
            onChange={handleValueChange}
            unit={selectedProperty.unit}
          />
        );
      case 'select':
        return (
          <SelectInput
            value={condition.value}
            onChange={handleValueChange}
            options={selectedProperty.options || []}
            placeholder={selectedProperty.placeholder}
          />
        );
      case 'multiselect':
        return (
          <ComboMultiSelectInput
            value={condition.value}
            onChange={handleValueChange}
            options={selectedProperty.options || []}
            placeholder={selectedProperty.placeholder || 'Type or select...'}
          />
        );
      case 'boolean':
        return (
          <BooleanInput
            value={condition.value}
            onChange={handleValueChange}
          />
        );
      default:
        return null;
    }
  };

  // Group properties by category
  const categorizedProperties = properties.reduce((acc, property) => {
    const category = property.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(property);
    return acc;
  }, {} as Record<string, PropertyDefinition[]>);

  return (
    <div className="flex items-start gap-2">
      {/* Property Selector */}
      <Popover open={propertyOpen} onOpenChange={setPropertyOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={propertyOpen}
            className="w-[200px] justify-between"
          >
            {selectedProperty?.label || 'Select property...'}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-0 bg-background" align="start">
          <Command>
            <CommandInput placeholder="Search properties..." />
            <CommandList>
              <CommandEmpty>No property found.</CommandEmpty>
              {Object.entries(categorizedProperties).map(([category, props]) => (
                <CommandGroup key={category} heading={category}>
                  {props.map((property) => (
                    <CommandItem
                      key={property.id}
                      value={property.label}
                      onSelect={() => handlePropertyChange(property.id)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          condition.property === property.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {property.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Operator Selector */}
      {selectedProperty && (
        <Select value={condition.operator} onValueChange={handleOperatorChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-background">
            {selectedProperty.operators.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Value Input */}
      <div className="flex-1 min-w-[200px]">
        {renderValueInput()}
      </div>

      {/* Remove Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="shrink-0"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
