import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { authSignInWithOAuth, authSignInWithPassword, authSignUp, supabase } from '@/lib/supabase';
import { useBoardStore } from '@/store/useBoardStore';
import { advanceAuthSessionRevision, getAuthSessionRevision } from '@/lib/auth-session';

export interface AuthContextValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  session: Session | null;
  user: User | null;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuthContext must be used within <AuthProvider />');
  return value;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let mounted = true;
    let authRevision = 0;
    let acceptedSession: Session | null | undefined;
    let receivedAuthEvent = false;
    let receivedNonInitialEvent = false;
    let validationRevision: number | undefined;
    let validationTimer: number | undefined;
    const acceptSession = (nextSession: Session | null) => {
      if (acceptedSession === undefined || acceptedSession?.user.id !== nextSession?.user.id ||
        acceptedSession?.access_token !== nextSession?.access_token) {
        authRevision++;
        advanceAuthSessionRevision();
      }
      acceptedSession = nextSession;
      // Board jobs outlive the board route. Clear the old account's coordinator
      // before publishing authentication changes, including on Account pages.
      useBoardStore.getState().setCurrentUserId(nextSession?.user.id ?? null);
      setSession(nextSession);
      setIsLoaded(true);
    };
    const validateSession = async (revision: number) => {
      if (!mounted || revision !== authRevision || !acceptedSession || validationRevision === revision) return;
      validationRevision = revision;
      const attemptRevision = getAuthSessionRevision();
      const { error } = await supabase.auth.getUser();
      if (!mounted || revision !== authRevision || attemptRevision !== getAuthSessionRevision()) return;
      if (error) await supabase.auth.signOut({ scope: 'local' });
    };

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!mounted) return;
      if (!receivedAuthEvent) acceptSession(error ? null : data.session);
      // Validate the cached session with the server. If the JWT references a
      // session_id that no longer exists (revoked, signed out elsewhere, etc.),
      // getUser() errors and Supabase JS clears the stale storage for us —
      // then sign out locally so the UI returns to the login state.
      await validateSession(authRevision);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      // A delayed initial notification cannot replace a newer sign-in/out.
      if (event === 'INITIAL_SESSION' && receivedNonInitialEvent) return;
      receivedAuthEvent = true;
      if (event !== 'INITIAL_SESSION') receivedNonInitialEvent = true;
      acceptSession(nextSession);
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        // SIGNED_IN can also describe a locally recovered cached session. Start
        // validation after the callback releases Supabase's authentication lock.
        window.clearTimeout(validationTimer);
        const revision = authRevision;
        validationTimer = window.setTimeout(() => { void validateSession(revision); }, 0);
      }
    });

    return () => {
      mounted = false;
      window.clearTimeout(validationTimer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;

    return {
      isLoaded,
      isSignedIn: !!user,
      session,
      user,
      signInWithGoogle: async () => {
        advanceAuthSessionRevision();
        try {
          const { error } = await authSignInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.href },
          });
          return { error: error?.message ?? null };
        } catch {
          return { error: 'Could not start sign-in. Try again.' };
        }
      },
      signInWithEmail: async (email, password) => {
        advanceAuthSessionRevision();
        try {
          const { error } = await authSignInWithPassword({ email, password });
          return { error: error?.message ?? null };
        } catch {
          return { error: 'Could not sign in. Try again.' };
        }
      },
      signUpWithEmail: async (email, password) => {
        advanceAuthSessionRevision();
        try {
          const { data, error } = await authSignUp({ email, password });
          // Signup can succeed without a session when email confirmation is required.
          return { error: error?.message ?? null, needsEmailConfirmation: !error && !data?.session };
        } catch {
          return { error: 'Could not sign up. Try again.', needsEmailConfirmation: false };
        }
      },
      signOut: async () => {
        advanceAuthSessionRevision();
        // Local scope only: a routine sign-out should not revoke the user's
        // sessions on their other devices (the default 'global' scope would).
        try {
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          return { error: error?.message ?? null };
        } catch {
          return { error: 'Could not sign out. Try again.' };
        }
      },
    };
  }, [isLoaded, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
