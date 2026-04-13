import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Check, Loader2, Minus } from 'lucide-react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { toast } from 'sonner';

interface AIUpgradePromptProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const freeFeatures = [
  { text: '5 AI queries per day', included: true },
  { text: 'Unlimited boards & cards', included: true },
  { text: 'Drag & drop organization', included: true },
  { text: 'Labels, due dates & covers', included: true },
  { text: 'Timeline view', included: true },
  { text: 'Unlimited AI queries', included: false },
  { text: 'Natural language commands', included: false },
  { text: 'AI card creation & batch ops', included: false },
];

const proFeatures = [
  { text: 'Everything in Free', included: true },
  { text: 'Unlimited AI queries', included: true },
  { text: 'Natural language commands', included: true },
  { text: 'AI-powered card creation', included: true },
  { text: 'Batch operations via chat', included: true },
];

export function AIUpgradePrompt({ isOpen, onOpenChange }: AIUpgradePromptProps) {
  const { session } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to start checkout');
        setIsLoading(false);
      }
    } catch {
      toast.error('Failed to start checkout');
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="text-xl font-bold text-center">Choose Your Plan</DialogTitle>
          <DialogDescription className="text-[#A8B2B2] text-center">
            Get more done with AI-powered board management
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
          {/* Free tier */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[#A8B2B2] uppercase tracking-wider">Free</h3>
              <div className="mt-2">
                <span className="text-2xl font-bold text-[#F2F7F7]">$0</span>
                <span className="text-sm text-[#A8B2B2]">/month</span>
              </div>
            </div>

            <div className="space-y-2.5 flex-1">
              {freeFeatures.map((f) => (
                <div key={f.text} className="flex items-start gap-2">
                  {f.included ? (
                    <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-2.5 h-2.5 text-[#A8B2B2]" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Minus className="w-2.5 h-2.5 text-[#A8B2B2]/30" />
                    </div>
                  )}
                  <span className={`text-xs leading-snug ${f.included ? 'text-[#A8B2B2]' : 'text-[#A8B2B2]/30'}`}>
                    {f.text}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="h-10 rounded-lg border border-white/10 flex items-center justify-center text-xs font-medium text-[#A8B2B2]">
                Current plan
              </div>
            </div>
          </div>

          {/* Pro tier */}
          <div className="rounded-xl border border-[#78fcd6]/30 bg-[#78fcd6]/[0.04] p-4 flex flex-col relative">
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-[#78fcd6] text-[#0B0F0F] text-[10px] font-bold uppercase tracking-wider">
              Recommended
            </div>

            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[#78fcd6] uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Pro
              </h3>
              <div className="mt-2">
                <span className="text-2xl font-bold text-[#F2F7F7]">$3</span>
                <span className="text-sm text-[#A8B2B2]">/month</span>
              </div>
            </div>

            <div className="space-y-2.5 flex-1">
              {proFeatures.map((f) => (
                <div key={f.text} className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-[#78fcd6]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-2.5 h-2.5 text-[#78fcd6]" />
                  </div>
                  <span className="text-xs leading-snug text-[#F2F7F7]">{f.text}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-[#78fcd6]/10">
              <Button
                onClick={handleSubscribe}
                disabled={isLoading}
                className="w-full h-10 gradient-cyan text-[#0B0F0F] hover:opacity-90 font-semibold rounded-lg text-sm"
              >
                {isLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Redirecting&hellip;</>
                ) : (
                  'Get Pro for $3/mo'
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 text-center">
          <p className="text-[11px] text-[#A8B2B2]/60">
            Cancel anytime &middot; Secure checkout powered by Stripe
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
