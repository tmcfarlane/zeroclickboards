import { useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { SignInModal } from '@/components/auth/SignInModal';

type Phase = 'loading' | 'need-auth' | 'delivering' | 'done' | 'error';

/**
 * Bridge page for the `zeroboard-mcp login` browser flow. The CLI opens this
 * page with ?port=<loopback>&state=<random>. Once the user is signed in (via the
 * app's normal Supabase auth), we POST the session tokens to the local loopback
 * the CLI is listening on, gated by the matching `state`.
 *
 * The CLI validates the session before accepting it, so if a stale cached
 * session is delivered first it is rejected and we fall back to the sign-in UI;
 * a fresh sign-in produces a new token which is then delivered and accepted.
 */
export function AuthCliPage() {
  const { isLoaded, isSignedIn, session } = useAuthContext();
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port');
  const state = params.get('state');
  const valid = !!port && !!state && /^\d+$/.test(port);

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const attemptedToken = useRef<string | null>(null);
  const succeeded = useRef(false);

  useEffect(() => {
    if (!valid || !isLoaded) return;
    if (!isSignedIn) {
      setPhase('need-auth');
      return;
    }
    if (!session || succeeded.current) return;
    // Deliver each distinct session token at most once.
    if (attemptedToken.current === session.access_token) return;
    attemptedToken.current = session.access_token;
    setPhase('delivering');
    void fetch(`http://127.0.0.1:${port}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, access_token: session.access_token, refresh_token: session.refresh_token }),
    })
      .then((r) => {
        if (r.ok) {
          succeeded.current = true;
          setPhase('done');
        } else {
          // Rejected (e.g. a stale session). Wait for a fresh sign-in; the effect
          // re-runs and re-delivers when the session token changes.
          setPhase('need-auth');
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
  }, [valid, isLoaded, isSignedIn, session, port, state]);

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111515] p-8 text-center">
        <div className="mx-auto mb-5 h-10 w-10 rounded-xl gradient-cyan" aria-hidden="true" />
        {!valid ? (
          <>
            <h1 className="text-lg font-semibold">Invalid Sign-In Link</h1>
            <p className="mt-2 text-sm text-[#A8B2B2]">
              This page is opened by the ZeroBoard CLI. Run{' '}
              <code className="text-[#78fcd6]">zeroboard-mcp login</code> in your terminal to start.
            </p>
          </>
        ) : phase === 'loading' ? (
          <p className="text-sm text-[#A8B2B2]">Loading…</p>
        ) : phase === 'need-auth' ? (
          <>
            <h1 className="text-lg font-semibold">Connect ZeroBoard to Your Terminal</h1>
            <p className="mt-2 text-sm text-[#A8B2B2]">Sign in to authorize the ZeroBoard CLI.</p>
            <SignInModal isOpen onOpenChange={() => undefined} />
          </>
        ) : phase === 'delivering' ? (
          <p className="text-sm text-[#A8B2B2]" aria-live="polite">
            Connecting your CLI…
          </p>
        ) : phase === 'done' ? (
          <>
            <h1 className="text-lg font-semibold">You&rsquo;re All Set</h1>
            <p className="mt-2 text-sm text-[#A8B2B2]">
              ZeroBoard is connected. You can close this tab and return to your terminal.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Couldn&rsquo;t Connect</h1>
            <p className="mt-2 text-sm text-red-400" role="alert">
              {error}
            </p>
            <p className="mt-2 text-sm text-[#A8B2B2]">
              Make sure <code className="text-[#78fcd6]">zeroboard-mcp login</code> is still running, then try again.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
