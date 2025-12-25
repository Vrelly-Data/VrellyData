import { TagInput } from '@/components/ui/tag-input';

interface TagsInputProps {
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export function TagsInput({ value, onChange, placeholder }: TagsInputProps) {
  // Ensure value is always an array
  const safeValue = Array.isArray(value) ? value : [];

  return (
    <TagInput
      value={safeValue}
      onChange={onChange}
      placeholder={placeholder || 'Type and press Enter...'}
    />
  );
}
