import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface BooleanInputProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function BooleanInput({ value, onChange }: BooleanInputProps) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(v === 'true')}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent className="bg-background">
        <SelectItem value="true">Yes</SelectItem>
        <SelectItem value="false">No</SelectItem>
      </SelectContent>
    </Select>
  );
}
