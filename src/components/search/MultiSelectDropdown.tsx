import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';

interface MultiSelectDropdownProps {
  options: Array<{ label: string; value: string }> | string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  loading?: boolean;
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = 'Select options...',
  loading = false,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);

  // Normalize options to always have label/value structure
  const normalizedOptions = Array.isArray(options)
    ? options.map(opt => 
        typeof opt === 'string' 
          ? { label: opt, value: opt }
          : opt
      )
    : [];

  const handleSelect = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  // Get display label for a value
  const getLabel = (value: string) => {
    const option = normalizedOptions.find(opt => opt.value === value);
    return option ? option.label : value;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={loading}
        >
          {selected.length > 0 ? (
            <div className="flex gap-1 flex-wrap">
              {selected.slice(0, 2).map((value) => (
                <Badge key={value} variant="secondary" className="text-xs">
                  {getLabel(value)}
                </Badge>
              ))}
              {selected.length > 2 && (
                <Badge variant="secondary" className="text-xs">
                  +{selected.length - 2} more
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {normalizedOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => handleSelect(option.value)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      selected.includes(option.value) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
