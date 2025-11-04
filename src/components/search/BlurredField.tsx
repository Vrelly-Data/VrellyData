import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BlurredFieldProps {
  value: string;
  isUnlocked: boolean;
  className?: string;
}

export function BlurredField({ value, isUnlocked, className }: BlurredFieldProps) {
  if (isUnlocked) {
    return <span className={className}>{value}</span>;
  }

  return (
    <div className={cn("relative inline-flex items-center gap-1", className)}>
      <span className="blur-sm select-none pointer-events-none">
        {value || 'email@example.com'}
      </span>
      <Lock className="h-3 w-3 text-muted-foreground absolute right-0" />
    </div>
  );
}
