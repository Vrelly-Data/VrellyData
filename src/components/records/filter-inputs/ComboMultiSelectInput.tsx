import { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ComboMultiSelectInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export function ComboMultiSelectInput({ 
  value = [], 
  onChange, 
  options = [], 
  placeholder = 'Type or select...' 
}: ComboMultiSelectInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addValue(inputValue.trim());
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag on backspace if input is empty
      onChange(value.slice(0, -1));
    }
  };

  const addValue = (newValue: string) => {
    if (!value.includes(newValue)) {
      onChange([...value, newValue]);
    }
    setInputValue('');
    setOpen(false);
  };

  const removeValue = (valueToRemove: string) => {
    onChange(value.filter(v => v !== valueToRemove));
  };

  // Filter options based on input and exclude already selected
  const filteredOptions = options.filter(
    opt => 
      !value.includes(opt.value) && 
      opt.label.toLowerCase().includes(inputValue.toLowerCase())
  );

  const getLabel = (val: string) => {
    const option = options.find(o => o.value === val);
    return option ? option.label : val;
  };

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open && (filteredOptions.length > 0 || inputValue.length > 0)} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div 
            className={cn(
              "flex flex-wrap gap-1.5 min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-text"
            )}
            onClick={() => setOpen(true)}
          >
            {value.map((v) => (
              <Badge 
                key={v} 
                variant="secondary" 
                className="flex items-center gap-1 px-2 py-0.5"
              >
                {getLabel(v)}
                <X 
                  className="h-3 w-3 cursor-pointer hover:text-destructive" 
                  onClick={(e) => {
                    e.stopPropagation();
                    removeValue(v);
                  }}
                />
              </Badge>
            ))}
            <Input
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setOpen(true)}
              placeholder={value.length === 0 ? placeholder : ''}
              className="flex-1 min-w-[120px] border-0 p-0 h-6 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
            />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0 bg-background" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command>
            <CommandList>
              {inputValue.trim() && !options.some(o => o.value.toLowerCase() === inputValue.toLowerCase()) && (
                <CommandGroup heading="Add custom">
                  <CommandItem onSelect={() => addValue(inputValue.trim())}>
                    Add "{inputValue.trim()}"
                  </CommandItem>
                </CommandGroup>
              )}
              {filteredOptions.length > 0 && (
                <CommandGroup heading="Suggestions">
                  {filteredOptions.slice(0, 10).map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      onSelect={() => addValue(option.value)}
                    >
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {filteredOptions.length === 0 && !inputValue.trim() && (
                <CommandEmpty>Type to add a value</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
