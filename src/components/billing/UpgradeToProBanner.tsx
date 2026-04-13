import { useState } from 'react';
import { Sparkles, X, ArrowRight, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { toast } from 'sonner';

interface UpgradeToProBannerProps {
  onLearnMore: () => void;
}

export function UpgradeToProBanner({ onLearnMore }: UpgradeToProBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const { hasSubscription } = useSubscription();
  const { isSignedIn } = useAuth();
  const { session } = useAuthContext();

  // Don't show if: already subscribed, dismissed, or not signed in
  // Show while loading (optimistic — most users are free tier)
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

  return (
    <div className="pt-2 bg-gradient-to-r from-[#78fcd6]/[0.08] via-[#78fcd6]/[0.04] to-[#00ffb6]/[0.08] border-b border-[#78fcd6]/20">
      <div className="relative flex items-center justify-center gap-3 px-4 py-2.5 pr-10">
        <Sparkles className="w-4 h-4 text-[#78fcd6] flex-shrink-0" />

        {/* Copy — value prop */}
        <p className="text-sm text-[#A8B2B2]">
          <span className="text-[#F2F7F7] font-medium">Unlock unlimited AI queries</span>
          {' '}&mdash; automate your boards with natural language.
          <span className="hidden sm:inline text-[#A8B2B2]/70"> Just $3/mo.</span>
        </p>

        {/* Direct-to-Stripe CTA */}
        <button
          onClick={handleCheckout}
          disabled={isCheckingOut}
          className="awesome-border cursor-pointer flex-shrink-0 disabled:opacity-60 disabled:cursor-wait"
        >
          <div className="awesome-border-inner group flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-[#78fcd6] hover:text-[#00ffb6] transition-colors">
            {isCheckingOut ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Redirecting&hellip;</span>
              </>
            ) : (
              <>
                <span>Upgrade to Pro</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </div>
        </button>

        {/* Learn More opens pricing dialog */}
        <button
          onClick={onLearnMore}
          className="text-xs text-[#A8B2B2]/60 hover:text-[#78fcd6] transition-colors underline underline-offset-2 flex-shrink-0"
        >
          Learn more
        </button>

        {/* Dismiss */}
        <button
          onClick={() => setIsDismissed(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#A8B2B2]/40 hover:text-[#A8B2B2] hover:bg-white/5 transition-colors"
          aria-label="Dismiss upgrade banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
