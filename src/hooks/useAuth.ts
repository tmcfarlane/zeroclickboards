import { useAuthContext } from '@/components/auth/AuthProvider';
import type { User } from '@supabase/supabase-js';

interface UseAuthReturn {
  isSignedIn: boolean;
  isLoaded: boolean;
  userId: string | null;
  user: User | null;
}

export function useAuth(): UseAuthReturn {
  const { isSignedIn, isLoaded, user } = useAuthContext();

  return {
    isSignedIn,
    isLoaded,
    userId: user?.id ?? null,
    user,
  };
}

export function useIsAuthenticated(): boolean {
  const { isSignedIn, isLoaded } = useAuthContext();
  return isLoaded && isSignedIn;
}

export function useUserId(): string | null {
  const { isSignedIn, user } = useAuthContext();
  return isSignedIn ? user?.id ?? null : null;
}
