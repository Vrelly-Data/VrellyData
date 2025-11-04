import { useState, useRef, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TagInputProps {
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  maxTags?: number;
  className?: string;
}

export function TagInput({
  value = [],
  onChange,
  placeholder = 'Type and press Enter...',
  suggestions = [],
  maxTags,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.toLowerCase().includes(inputValue.toLowerCase()) &&
      !value.includes(suggestion)
  );

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;
    if (value.includes(trimmedTag)) return;
    if (maxTags && value.length >= maxTags) return;

    onChange([...value, trimmedTag]);
    setInputValue('');
    setShowSuggestions(false);
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue);
    }
    setTimeout(() => setShowSuggestions(false), 200);
  };

  const handleSuggestionClick = (suggestion: string) => {
    addTag(suggestion);
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="pl-2 pr-1 py-1 flex items-center gap-1"
          >
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:bg-muted rounded-full p-0.5 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <Input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setShowSuggestions(e.target.value.length > 0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={() => inputValue && setShowSuggestions(true)}
        placeholder={placeholder}
        disabled={maxTags ? value.length >= maxTags : false}
      />

      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-auto">
          {filteredSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSuggestionClick(suggestion);
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
