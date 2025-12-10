import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Loader2 } from 'lucide-react';

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, userRoles } = useAuthStore();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      if (loading) return;
      
      if (!user) {
        navigate('/auth');
        return;
      }

      // Check if user is admin (without team context for global admin)
      const adminAccess = isAdmin();
      setHasAccess(adminAccess);
      setChecking(false);

      if (!adminAccess) {
        navigate('/');
      }
    };

    checkAccess();
  }, [user, loading, navigate, isAdmin, userRoles]);

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasAccess) {
    return null;
  }

  return <>{children}</>;
}
