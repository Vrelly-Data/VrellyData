import { Input } from '@/components/ui/input';

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  unit?: string;
}

export function CurrencyInput({ value, onChange, placeholder, unit = 'USD' }: CurrencyInputProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">$</span>
      <Input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder={placeholder}
        className="w-full"
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">{unit}</span>
    </div>
  );
}
