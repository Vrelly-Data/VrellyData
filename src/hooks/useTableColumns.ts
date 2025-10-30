import { useState, useEffect } from 'react';
import { ColumnConfig } from '@/types/tableColumns';
import { EntityType } from '@/types/audience';

const STORAGE_KEY_PREFIX = 'table_columns_';

export function useTableColumns<T>(
  entityType: EntityType,
  availableColumns: ColumnConfig<T>[]
) {
  const [columns, setColumns] = useState<ColumnConfig<T>[]>(availableColumns);

  useEffect(() => {
    const storageKey = `${STORAGE_KEY_PREFIX}${entityType}`;
    const saved = localStorage.getItem(storageKey);
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // Validate that parsed data is an array of strings
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'string')) {
          const visibleColumnIds = parsed as string[];
          const updatedColumns = availableColumns.map(col => ({
            ...col,
            visible: visibleColumnIds.includes(col.id)
          }));
          setColumns(updatedColumns);
        } else {
          console.warn('Invalid column preferences format, resetting to defaults');
          try {
            localStorage.removeItem(storageKey);
          } catch (e) {
            console.error('Failed to remove invalid preferences:', e);
          }
          setColumns(availableColumns.map(col => ({ ...col })));
        }
      } catch (e) {
        console.error('Failed to parse column preferences:', e);
        try {
          localStorage.removeItem(storageKey);
        } catch (removeError) {
          console.error('Failed to remove corrupted preferences:', removeError);
        }
        setColumns(availableColumns.map(col => ({ ...col })));
      }
    } else {
      setColumns(availableColumns.map(col => ({ ...col })));
    }
  }, [entityType]);

  const savePreferences = (updatedColumns: ColumnConfig<T>[]) => {
    const storageKey = `${STORAGE_KEY_PREFIX}${entityType}`;
    const visibleColumnIds = updatedColumns
      .filter(col => col.visible)
      .map(col => col.id);
    try {
      localStorage.setItem(storageKey, JSON.stringify(visibleColumnIds));
    } catch (e) {
      console.error('Failed to save column preferences:', e);
    }
    setColumns(updatedColumns);
  };

  const clearPreferences = () => {
    const storageKey = `${STORAGE_KEY_PREFIX}${entityType}`;
    try {
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to clear preferences:', e);
    }
    setColumns(availableColumns.map(col => ({ ...col })));
  };

  const toggleColumn = (columnId: string) => {
    const updated = columns.map(col =>
      col.id === columnId ? { ...col, visible: !col.visible } : col
    );
    savePreferences(updated);
  };

  const resetToDefaults = () => {
    const updated = columns.map(col => ({
      ...col,
      visible: col.defaultVisible
    }));
    savePreferences(updated);
  };

  const visibleColumns = columns.filter(col => col.visible);

  return {
    columns,
    visibleColumns,
    toggleColumn,
    resetToDefaults,
    clearPreferences
  };
}
