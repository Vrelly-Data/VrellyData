import { useState } from 'react';
import { ChevronDown, Save, Trash2, RotateCcw } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SavePresetDialog } from './SavePresetDialog';
import { useFilterPresets } from '@/hooks/useFilterPresets';
import type { FilterBuilderState } from '@/lib/filterConversion';

interface FilterPresetsDropdownProps {
  entityType: 'person' | 'company';
  currentFilters: FilterBuilderState;
  onLoadPreset: (filters: FilterBuilderState) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  variant?: 'ghost' | 'primary';
}

export function FilterPresetsDropdown({
  entityType,
  currentFilters,
  onLoadPreset,
  onClearFilters,
  hasActiveFilters,
  variant = 'ghost',
}: FilterPresetsDropdownProps) {
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { presets, savePreset, deletePreset } = useFilterPresets(entityType);

  const handleSavePreset = async (name: string) => {
    setSaving(true);
    await savePreset(name, currentFilters);
    setSaving(false);
  };

  const handleDeletePreset = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deletePreset(id);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant={variant === 'primary' ? 'default' : 'ghost'} 
            size={variant === 'primary' ? 'lg' : 'sm'} 
            className={variant === 'primary' ? 'rounded-l-none px-3 border-l border-primary-foreground/20' : 'h-8 w-8 p-0'}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={() => setSaveDialogOpen(true)}
            disabled={!hasActiveFilters}
          >
            <Save className="mr-2 h-4 w-4" />
            Save Current Search...
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          {presets.length > 0 ? (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Saved Searches
              </DropdownMenuLabel>
              {presets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => onLoadPreset(preset.filters)}
                  className="flex items-center justify-between group"
                >
                  <span className="truncate flex-1">{preset.name}</span>
                  <button
                    onClick={(e) => handleDeletePreset(e, preset.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-opacity"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              <DropdownMenuItem disabled className="text-muted-foreground text-sm">
                No saved searches yet
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          
          <DropdownMenuItem
            onClick={onClearFilters}
            disabled={!hasActiveFilters}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Clear All Filters
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SavePresetDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={handleSavePreset}
        loading={saving}
      />
    </>
  );
}
