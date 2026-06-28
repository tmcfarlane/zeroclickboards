import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthContext } from './AuthProvider';
import { useMemo, useState, type FormEvent } from 'react';
import { Mail, Lock, Chrome, Loader2 } from 'lucide-react';

interface SignInModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const inputClasses =
  'pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50';

export function SignInModal({ isOpen, onOpenChange }: SignInModalProps) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuthContext();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    if (email.trim().length === 0 || password.length === 0) return false;
    // Only the sign-up tab enforces a minimum length; existing accounts may have
    // shorter passwords and must still be able to sign in.
    return tab === 'signup' ? password.length >= 8 : true;
  }, [email, password, tab]);

  const resetState = () => {
    setEmail('');
    setPassword('');
    setError(null);
    setNotice(null);
    setIsSubmitting(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  const handleTabChange = (next: string) => {
    setTab(next as typeof tab);
    setError(null);
    setNotice(null);
  };

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    const result = await signInWithGoogle();
    setIsSubmitting(false);
    if (result.error) setError(result.error);
  };

  const handleEmail = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    if (tab === 'signin') {
      const result = await signInWithEmail(email.trim(), password);
      setIsSubmitting(false);
      if (result.error) setError(result.error);
      else handleOpenChange(false);
      return;
    }

    const result = await signUpWithEmail(email.trim(), password);
    setIsSubmitting(false);
    if (result.error) {
      setError(result.error);
    } else if (result.needsEmailConfirmation) {
      // Account created but no session yet — keep the modal open and tell the
      // user to confirm, instead of silently closing as if they were signed in.
      setNotice('Account created. Check your email to confirm your account, then sign in.');
    } else {
      handleOpenChange(false);
    }
  };

  const errorId = 'auth-error';
  const renderError = error ? (
    <p id={errorId} role="alert" className="text-sm text-red-400">
      {error}
    </p>
  ) : null;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to ZeroBoard</DialogTitle>
          <DialogDescription className="text-[#A8B2B2]">
            Sign in to save boards to your account and sync across devices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Button
            type="button"
            onClick={handleGoogle}
            disabled={isSubmitting}
            className="w-full h-11 bg-white/5 hover:bg-white/10 text-[#F2F7F7] border border-white/10 rounded-xl"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <Chrome className="w-4 h-4 mr-2" aria-hidden="true" />
            )}
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-[#A8B2B2]">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {notice && (
            <p role="status" className="text-sm text-[#78fcd6]">
              {notice}
            </p>
          )}

          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className="grid grid-cols-2 bg-white/5">
              <TabsTrigger value="signin" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">Sign in</TabsTrigger>
              <TabsTrigger value="signup" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">Sign up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4">
              <form onSubmit={handleEmail} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm text-[#A8B2B2]">Email</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      className={inputClasses}
                      placeholder="you@company.com"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm text-[#A8B2B2]">Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      className={inputClasses}
                      placeholder="Your password"
                    />
                  </div>
                </div>
                {renderError}
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full h-11 gradient-cyan text-[#0B0F0F] hover:opacity-90 rounded-xl font-semibold"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-4">
              <form onSubmit={handleEmail} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="email2" className="text-sm text-[#A8B2B2]">Email</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <Input
                      id="email2"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      className={inputClasses}
                      placeholder="you@company.com"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2" className="text-sm text-[#A8B2B2]">Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <Input
                      id="password2"
                      name="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      className={inputClasses}
                      placeholder="Minimum 8 characters"
                    />
                  </div>
                </div>
                {renderError}
                <Button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full h-11 gradient-cyan text-[#0B0F0F] hover:opacity-90 rounded-xl font-semibold"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                  {isSubmitting ? 'Creating account…' : 'Create account'}
                </Button>
                <p className="text-xs text-[#A8B2B2]">
                  You may need to confirm your email depending on your Supabase Auth settings.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
