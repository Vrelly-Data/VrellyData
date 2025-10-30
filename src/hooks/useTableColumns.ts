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
        const visibleColumnIds: string[] = JSON.parse(saved);
        const updatedColumns = availableColumns.map(col => ({
          ...col,
          visible: visibleColumnIds.includes(col.id)
        }));
        setColumns(updatedColumns);
      } catch (e) {
        console.error('Failed to parse column preferences:', e);
        setColumns(availableColumns);
      }
    } else {
      setColumns(availableColumns);
    }
  }, [entityType]);

  const savePreferences = (updatedColumns: ColumnConfig<T>[]) => {
    const storageKey = `${STORAGE_KEY_PREFIX}${entityType}`;
    const visibleColumnIds = updatedColumns
      .filter(col => col.visible)
      .map(col => col.id);
    localStorage.setItem(storageKey, JSON.stringify(visibleColumnIds));
    setColumns(updatedColumns);
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
    resetToDefaults
  };
}
