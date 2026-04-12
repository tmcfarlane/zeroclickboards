import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { toast } from 'sonner';

interface AIUpgradePromptProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

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
      }
    } catch {
      toast.error('Failed to start checkout');
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    'Natural language board management',
    'AI-powered card creation & organization',
    'Batch operations via chat',
    'Smart task suggestions',
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl gradient-cyan flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#0B0F0F]" />
            </div>
            <div>
              <DialogTitle className="text-lg">Upgrade to AI Pro</DialogTitle>
              <DialogDescription className="text-[#A8B2B2]">
                Unlock the AI Assistant
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-center">
            <div className="text-3xl font-bold text-[#78fcd6]">$3<span className="text-base font-normal text-[#A8B2B2]">/month</span></div>
          </div>

          <div className="space-y-3">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-[#78fcd6]/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-[#78fcd6]" />
                </div>
                <span className="text-sm text-[#F2F7F7]">{feature}</span>
              </div>
            ))}
          </div>

          <div className="pt-2">
            <Button
              onClick={handleSubscribe}
              disabled={isLoading}
              className="w-full h-11 gradient-cyan text-[#0B0F0F] hover:opacity-90 font-semibold rounded-xl"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing...</>
              ) : (
                'Subscribe for $3/month'
              )}
            </Button>
          </div>

          <p className="text-xs text-[#A8B2B2] text-center">
            Cancel anytime. Powered by Stripe.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
