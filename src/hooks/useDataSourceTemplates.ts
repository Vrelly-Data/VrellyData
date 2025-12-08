import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export interface ColumnMapping {
  csvHeader: string;
  systemField: string | null;
  customFieldName?: string;
}

export interface DataSourceTemplate {
  id: string;
  name: string;
  entity_type: 'person' | 'company';
  column_mappings: ColumnMapping[];
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useDataSourceTemplates() {
  const [templates, setTemplates] = useState<DataSourceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_source_templates')
        .select('*')
        .order('name');

      if (error) throw error;
      
      // Type assertion since column_mappings comes as Json
      setTemplates((data || []).map(t => ({
        ...t,
        column_mappings: t.column_mappings as unknown as ColumnMapping[]
      })));
    } catch (error: any) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to load data source templates');
    } finally {
      setLoading(false);
    }
  };

  const createTemplate = async (
    name: string,
    entityType: 'person' | 'company',
    columnMappings: ColumnMapping[],
    description?: string
  ) => {
    if (!user) return null;

    try {
      const { data, error } = await supabase
        .from('data_source_templates')
        .insert([{
          name,
          entity_type: entityType,
          column_mappings: JSON.parse(JSON.stringify(columnMappings)),
          description: description || null,
          created_by: user.id
        }])
        .select()
        .single();

      if (error) throw error;

      await fetchTemplates();
      toast.success('Template created successfully');
      return data;
    } catch (error: any) {
      console.error('Error creating template:', error);
      toast.error(error.message || 'Failed to create template');
      return null;
    }
  };

  const updateTemplate = async (
    id: string,
    updates: Partial<Pick<DataSourceTemplate, 'name' | 'column_mappings' | 'description'>>
  ) => {
    try {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.column_mappings !== undefined) dbUpdates.column_mappings = updates.column_mappings;

      const { error } = await supabase
        .from('data_source_templates')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;

      await fetchTemplates();
      toast.success('Template updated successfully');
      return true;
    } catch (error: any) {
      console.error('Error updating template:', error);
      toast.error(error.message || 'Failed to update template');
      return false;
    }
  };

  const deleteTemplate = async (id: string) => {
    try {
      const { error } = await supabase
        .from('data_source_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchTemplates();
      toast.success('Template deleted successfully');
      return true;
    } catch (error: any) {
      console.error('Error deleting template:', error);
      toast.error(error.message || 'Failed to delete template');
      return false;
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  return {
    templates,
    loading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    refetch: fetchTemplates
  };
}
