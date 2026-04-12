import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface AuthRedirectProps {
  children: ReactNode;
  requireAuth?: boolean;
}

export function AuthRedirect({ children, requireAuth }: AuthRedirectProps) {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl gradient-cyan animate-pulse" />
          <span className="text-[#A8B2B2] text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // If auth is required and user is not signed in, redirect to landing
  if (requireAuth && !isSignedIn) {
    return <Navigate to="/" replace />;
  }

  // If user is signed in and at landing page, redirect to app
  if (!requireAuth && isSignedIn) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
