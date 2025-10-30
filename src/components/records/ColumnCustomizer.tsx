import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Columns3, RotateCcw } from 'lucide-react';
import { ColumnConfig } from '@/types/tableColumns';

interface ColumnCustomizerProps<T> {
  columns: ColumnConfig<T>[];
  onToggleColumn: (columnId: string) => void;
  onResetToDefaults: () => void;
  onClearPreferences: () => void;
}

export function ColumnCustomizer<T>({
  columns,
  onToggleColumn,
  onResetToDefaults,
  onClearPreferences,
}: ColumnCustomizerProps<T>) {
  const visibleCount = columns.filter(col => col.visible).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="h-4 w-4 mr-2" />
          Columns ({visibleCount})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Customize Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <div className="max-h-[400px] overflow-y-auto">
          {columns.map((column) => (
            <DropdownMenuItem
              key={column.id}
              className="flex items-center gap-2 cursor-pointer"
              onSelect={(e) => {
                e.preventDefault();
                onToggleColumn(column.id);
              }}
            >
              <Checkbox
                checked={column.visible}
                onCheckedChange={() => onToggleColumn(column.id)}
              />
              <span className="flex-1">{column.label}</span>
            </DropdownMenuItem>
          ))}
        </div>
        
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onResetToDefaults}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset to Default
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClearPreferences}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Clear Saved Preferences
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
