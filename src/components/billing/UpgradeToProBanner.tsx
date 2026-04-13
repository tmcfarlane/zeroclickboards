import { useState } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';

interface UpgradeToProBannerProps {
  onUpgradeClick: () => void;
}

export function UpgradeToProBanner({ onUpgradeClick }: UpgradeToProBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const { hasSubscription, isLoading } = useSubscription();
  const { isSignedIn } = useAuth();

  // Don't show if: already subscribed, dismissed, or not signed in
  // Show while loading (optimistic — most users are free tier)
  if (!isSignedIn || hasSubscription || isDismissed) return null;

  return (
    <div className="pt-2 bg-gradient-to-r from-[#78fcd6]/[0.08] via-[#78fcd6]/[0.04] to-[#00ffb6]/[0.08] border-b border-[#78fcd6]/20">
      <div className="flex items-center justify-center gap-3 px-4 py-2.5">
        <Sparkles className="w-4 h-4 text-[#78fcd6] flex-shrink-0" />

        {/* Copy — value prop + social proof */}
        <p className="text-sm text-[#A8B2B2]">
          <span className="text-[#F2F7F7] font-medium">Unlock unlimited AI queries</span>
          {' '}&mdash; automate your boards with natural language.
          <span className="hidden sm:inline text-[#A8B2B2]/70"> Just $3/mo.</span>
        </p>

        {/* CTA button */}
        <button
          onClick={onUpgradeClick}
          className="group flex items-center gap-1.5 flex-shrink-0 px-4 py-1.5 rounded-full bg-[#78fcd6] text-[#0B0F0F] text-sm font-semibold hover:bg-[#00ffb6] transition-all duration-200 hover:shadow-[0_0_20px_rgba(120,252,214,0.3)]"
        >
          <span>Upgrade to Pro</span>
          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
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
