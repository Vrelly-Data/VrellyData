import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AdminUser {
  id: string;
  name: string | null;
  credits: number;
  plan: string | null;
  subscription_status: string | null;
  subscription_tier: string | null;
  created_at: string;
  is_admin: boolean;
}

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_all_profiles_admin');

      if (error) {
        console.error('Error fetching users:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to fetch users',
          variant: 'destructive',
        });
        return;
      }

      setUsers(data || []);
    } catch (err) {
      console.error('Unexpected error fetching users:', err);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const deleteUser = useCallback(async (userId: string) => {
    setIsDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast({
          title: 'Error',
          description: 'You must be logged in to perform this action',
          variant: 'destructive',
        });
        return false;
      }

      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId },
      });

      if (error) {
        console.error('Error deleting user:', error);
        toast({
          title: 'Error',
          description: error.message || 'Failed to delete user',
          variant: 'destructive',
        });
        return false;
      }

      if (data?.error) {
        toast({
          title: 'Error',
          description: data.error,
          variant: 'destructive',
        });
        return false;
      }

      toast({
        title: 'Success',
        description: 'User deleted successfully',
      });

      // Refresh the users list
      await fetchUsers();
      return true;
    } catch (err) {
      console.error('Unexpected error deleting user:', err);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsDeleting(false);
    }
  }, [fetchUsers, toast]);

  return {
    users,
    isLoading,
    isDeleting,
    fetchUsers,
    deleteUser,
  };
}
