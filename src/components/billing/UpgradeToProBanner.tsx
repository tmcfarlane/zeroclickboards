import { useMemo, useState } from 'react';
import { Sparkles, X, ArrowRight, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

const TRIAL_PHRASES = [
  'This AI isn\u2019t going to pay for itself',
  'Try Pro for 7 days \u00b7 run up my AI bill',
  'Need another subscription this month?',
  'Open source doesn\u2019t pay the AI bills',
  'The code is free \u2014 the AI isn\u2019t',
  'Unlimited AI for 7 days \u00b7 my treat',
  'Spoil yourself \u00b7 7 days unlimited AI',
  'Go wild \u00b7 7 days unlimited AI',
  'Burn through my AI credits \u00b7 7 days free',
  'MIT license. Paid tokens. 7 days free.',
];

const UPSELL_PHRASES = [
  'Unlock unlimited AI',
  'Free and open source \u00b7 AI is $3/mo',
  'Cheaper than a coffee \u00b7 unlimited AI',
  'Support open source \u00b7 $3/mo',
  'Unlimited AI for $3/mo',
];

export function UpgradeToProBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const { hasSubscription, trialEligible } = useSubscription();
  const { isSignedIn } = useAuth();
  const { session } = useAuthContext();

  const label = useMemo(() => {
    const pool = trialEligible ? TRIAL_PHRASES : UPSELL_PHRASES;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [trialEligible]);

  if (!isSignedIn || hasSubscription || isDismissed) return null;

  const handleCheckout = async () => {
    setIsCheckingOut(true);
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
        setIsCheckingOut(false);
      }
    } catch {
      toast.error('Failed to start checkout');
      setIsCheckingOut(false);
    }
  };

  const tooltip = trialEligible
    ? '7 days free, then $3/mo. Cancel anytime.'
    : 'Just $3/mo. Cancel anytime.';

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCheckout}
            disabled={isCheckingOut}
            aria-label={tooltip}
            className="group inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[#78fcd6]/30 bg-[#78fcd6]/5 hover:bg-[#78fcd6]/15 hover:border-[#78fcd6]/50 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            {isCheckingOut ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#78fcd6]" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 text-[#78fcd6]" />
            )}
            <span className="text-xs font-medium text-[#F2F7F7] whitespace-nowrap hidden sm:inline">
              {isCheckingOut ? 'Redirecting…' : label}
            </span>
            <span className="text-xs font-medium text-[#78fcd6] whitespace-nowrap sm:hidden">
              Pro
            </span>
            {!isCheckingOut && (
              <ArrowRight className="w-3 h-3 text-[#78fcd6] transition-transform group-hover:translate-x-0.5 hidden sm:inline" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={6}
          className="bg-[#0B0F0F] text-[#F2F7F7] border border-white/10 [&>span]:bg-[#0B0F0F] [&>span]:fill-[#0B0F0F]"
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={() => setIsDismissed(true)}
        className="p-1 rounded text-[#A8B2B2]/40 hover:text-[#A8B2B2] hover:bg-white/5 transition-colors"
        aria-label="Dismiss upgrade prompt"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
