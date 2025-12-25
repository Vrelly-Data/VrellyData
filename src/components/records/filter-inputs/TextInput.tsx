import { Input } from '@/components/ui/input';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onEnterPress?: () => void;
}

export function TextInput({ value, onChange, placeholder, onEnterPress }: TextInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onEnterPress) {
      e.preventDefault();
      onEnterPress();
    }
  };

  return (
    <Input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className="w-full"
    />
  );
}
