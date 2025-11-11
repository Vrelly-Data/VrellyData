import { useState } from 'react';
import { FilterCondition, FilterRule, SmartFilter } from '@/types/filterProperties';
import { EntityType } from '@/types/audience';

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function useSmartFilter(entityType: EntityType, initialFilter?: SmartFilter) {
  const [filter, setFilter] = useState<SmartFilter>(
    initialFilter || {
      name: '',
      entityType,
      rule: {
        id: generateId(),
        logic: 'and',
        conditions: [{
          id: generateId(),
          property: 'added_on',
          operator: 'less_than',
          value: 0
        }]
      }
    }
  );

  const addCondition = (groupId: string, logic: 'and' | 'or' = 'or') => {
    const newCondition: FilterCondition = {
      id: generateId(),
      property: 'added_on',
      operator: 'less_than',
      value: 0
    };

    setFilter(prev => {
      const updateGroup = (rule: FilterRule): FilterRule => {
        if (rule.id === groupId) {
          return {
            ...rule,
            conditions: [...rule.conditions, newCondition]
          };
        }
        if (rule.groups) {
          return {
            ...rule,
            groups: rule.groups.map(updateGroup)
          };
        }
        return rule;
      };

      return {
        ...prev,
        rule: updateGroup(prev.rule)
      };
    });
  };

  const removeCondition = (conditionId: string) => {
    setFilter(prev => {
      const updateGroup = (rule: FilterRule): FilterRule => {
        return {
          ...rule,
          conditions: rule.conditions.filter(c => c.id !== conditionId),
          groups: rule.groups ? rule.groups.map(updateGroup) : undefined
        };
      };

      return {
        ...prev,
        rule: updateGroup(prev.rule)
      };
    });
  };

  const updateCondition = (conditionId: string, updates: Partial<FilterCondition>) => {
    setFilter(prev => {
      const updateGroup = (rule: FilterRule): FilterRule => {
        return {
          ...rule,
          conditions: rule.conditions.map(c => 
            c.id === conditionId ? { ...c, ...updates } : c
          ),
          groups: rule.groups ? rule.groups.map(updateGroup) : undefined
        };
      };

      return {
        ...prev,
        rule: updateGroup(prev.rule)
      };
    });
  };

  const addGroup = () => {
    const newGroup: FilterRule = {
      id: generateId(),
      logic: 'and',
      conditions: [{
        id: generateId(),
        property: 'added_on',
        operator: 'less_than',
        value: 0
      }]
    };

    setFilter(prev => ({
      ...prev,
      rule: {
        ...prev.rule,
        groups: [...(prev.rule.groups || []), newGroup]
      }
    }));
  };

  const setFilterName = (name: string) => {
    setFilter(prev => ({ ...prev, name }));
  };

  const reset = () => {
    setFilter({
      name: '',
      entityType,
      rule: {
        id: generateId(),
        logic: 'and',
        conditions: [{
          id: generateId(),
          property: 'added_on',
          operator: 'less_than',
          value: 0
        }]
      }
    });
  };

  return { 
    filter, 
    addCondition, 
    removeCondition, 
    updateCondition, 
    addGroup, 
    setFilterName,
    reset
  };
}
