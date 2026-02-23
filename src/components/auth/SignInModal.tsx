import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthContext } from './AuthProvider';
import { useMemo, useState } from 'react';
import { Mail, Lock, Chrome } from 'lucide-react';

interface SignInModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignInModal({ isOpen, onOpenChange }: SignInModalProps) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuthContext();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.length >= 8;
  }, [email, password]);

  const handleGoogle = async () => {
    setError(null);
    setIsSubmitting(true);
    const result = await signInWithGoogle();
    setIsSubmitting(false);
    if (result.error) setError(result.error);
  };

  const handleEmail = async () => {
    setError(null);
    setIsSubmitting(true);
    const result = tab === 'signin'
      ? await signInWithEmail(email.trim(), password)
      : await signUpWithEmail(email.trim(), password);
    setIsSubmitting(false);
    if (result.error) setError(result.error);
    if (!result.error) onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
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
            <Chrome className="w-4 h-4 mr-2" />
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-[#A8B2B2]">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="grid grid-cols-2 bg-white/5">
              <TabsTrigger value="signin" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">Sign in</TabsTrigger>
              <TabsTrigger value="signup" className="data-[state=active]:bg-[#78fcd6]/20 data-[state=active]:text-[#78fcd6]">Sign up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm text-[#A8B2B2]">Email</Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm text-[#A8B2B2]">Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                    placeholder="Minimum 8 characters"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button
                type="button"
                onClick={handleEmail}
                disabled={!canSubmit || isSubmitting}
                className="w-full h-11 gradient-cyan text-[#0B0F0F] hover:opacity-90 rounded-xl font-semibold"
              >
                Sign in
              </Button>
            </TabsContent>

            <TabsContent value="signup" className="mt-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email2" className="text-sm text-[#A8B2B2]">Email</Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="email2"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                    placeholder="you@company.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password2" className="text-sm text-[#A8B2B2]">Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#A8B2B2] absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input
                    id="password2"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                    placeholder="Minimum 8 characters"
                  />
                </div>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button
                type="button"
                onClick={handleEmail}
                disabled={!canSubmit || isSubmitting}
                className="w-full h-11 gradient-cyan text-[#0B0F0F] hover:opacity-90 rounded-xl font-semibold"
              >
                Create account
              </Button>
              <p className="text-xs text-[#A8B2B2]">
                You may need to confirm your email depending on your Supabase Auth settings.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
