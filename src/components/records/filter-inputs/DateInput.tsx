import { Input } from '@/components/ui/input';

interface DateInputProps {
  value: number;
  onChange: (value: number) => void;
  unit?: string;
}

export function DateInput({ value, onChange, unit = 'days ago' }: DateInputProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value || 0}
        onChange={(e) => onChange(Number(e.target.value))}
        placeholder="0"
        className="w-full"
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">{unit}</span>
    </div>
  );
}
