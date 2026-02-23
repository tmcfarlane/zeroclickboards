import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuthContext } from './AuthProvider';

interface ProtectedRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isSignedIn, isLoaded } = useAuthContext();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0B0F0F]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-[#78fcd6] animate-spin" />
          <span className="text-[#A8B2B2] text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return null;
  }

  return <>{children}</>;
}
