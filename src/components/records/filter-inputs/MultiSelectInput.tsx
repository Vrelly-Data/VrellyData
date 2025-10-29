import { MultiSelectDropdown } from '@/components/search/MultiSelectDropdown';

interface MultiSelectInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export function MultiSelectInput({ value, onChange, options, placeholder }: MultiSelectInputProps) {
  return (
    <MultiSelectDropdown
      options={options.map(o => o.value)}
      selected={value || []}
      onChange={onChange}
      placeholder={placeholder || 'Select...'}
    />
  );
}
