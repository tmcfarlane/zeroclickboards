import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthContext } from './AuthProvider';

export function ChatGPTSignInSettings() {
  const { isChatGPTSignInEnabled, isSignedIn, user, linkChatGPTIdentity } = useAuthContext();
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const attemptRef = useRef<object | null>(null);
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;
  const enabledRef = useRef(isChatGPTSignInEnabled);
  enabledRef.current = isChatGPTSignInEnabled;

  useEffect(() => () => { attemptRef.current = null; }, []);

  const linked = user?.identities?.some((identity) => identity.provider === 'custom:chatgpt') ?? false;
  if (!isChatGPTSignInEnabled || !isSignedIn || !user) return null;

  const handleLink = async () => {
    if (attemptRef.current || linked || !enabledRef.current) return;
    const accountId = user.id;
    const attempt = {};
    attemptRef.current = attempt;
    setError(null);
    setNotice(null);
    setIsLinking(true);
    const isCurrent = () => attemptRef.current === attempt && accountRef.current === accountId && enabledRef.current;
    try {
      const result = await linkChatGPTIdentity();
      if (!isCurrent()) return;
      if (result.error) setError(result.error);
      else setNotice('Continue in ChatGPT to finish linking your account.');
    } catch {
      if (isCurrent()) setError('Could not start account linking. Try again.');
    } finally {
      if (isCurrent()) {
        attemptRef.current = null;
        setIsLinking(false);
      }
    }
  };

  return (
    <section aria-labelledby="chatgpt-signin-heading" className="rounded-xl border border-white/10 bg-[#111515] p-6 mb-6">
      <h2 id="chatgpt-signin-heading" className="text-sm font-medium text-[#A8B2B2] uppercase tracking-wider mb-4">ChatGPT sign-in</h2>
      <p className="text-sm text-[#A8B2B2] mb-4">{linked ? 'Use ChatGPT to sign in to this ZeroBoard account. Your boards stay with this account.' : 'Link ChatGPT to sign in to this ZeroBoard account and keep your existing boards.'}</p>
      {linked ? (
        <p role="status" className="text-sm text-[#78fcd6]">ChatGPT account linked</p>
      ) : (
        <div className="space-y-3">
          <Button type="button" onClick={() => void handleLink()} disabled={isLinking} aria-busy={isLinking} className="bg-white/5 hover:bg-white/10 text-[#F2F7F7] border border-white/10 rounded-xl">
            {isLinking && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            Link ChatGPT account
          </Button>
          {isLinking && <p role="status" className="text-sm text-[#A8B2B2]">Opening ChatGPT…</p>}
          {notice && <p role="status" className="text-sm text-[#A8B2B2]">{notice}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}
