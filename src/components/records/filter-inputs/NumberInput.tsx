import { Input } from '@/components/ui/input';

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  unit?: string;
}

export function NumberInput({ value, onChange, placeholder, unit }: NumberInputProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder={placeholder}
        className="w-full"
      />
      {unit && <span className="text-sm text-muted-foreground whitespace-nowrap">{unit}</span>}
    </div>
  );
}
