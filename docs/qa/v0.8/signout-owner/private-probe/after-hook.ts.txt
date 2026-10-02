import { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuthContext } from '@/components/auth/AuthProvider';

export function useSignOutAction() {
  const { user, signOut } = useAuthContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const mountedRef = useRef(false);
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;
  const attemptRef = useRef<{ accountId: string } | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; attemptRef.current = null; };
  }, []);

  useLayoutEffect(() => {
    attemptRef.current = null;
    setIsSigningOut(false);
  }, [user?.id]);

  const runSignOut = async () => {
    if (!user?.id || attemptRef.current) return;
    const attempt = { accountId: user.id };
    attemptRef.current = attempt;
    setIsSigningOut(true);
    const isCurrent = () => mountedRef.current && attemptRef.current === attempt && accountRef.current === attempt.accountId;
    try {
      const { error } = await signOut();
      if (error && isCurrent()) toast.error('Could not sign out. Try again.');
    } catch {
      if (isCurrent()) toast.error('Could not sign out. Try again.');
    } finally {
      if (isCurrent()) {
        attemptRef.current = null;
        setIsSigningOut(false);
      }
    }
  };

  return { isSigningOut, runSignOut };
}
