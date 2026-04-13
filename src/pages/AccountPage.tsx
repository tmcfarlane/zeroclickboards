import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, CreditCard, Loader2, User, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';
import { useAdmin } from '@/hooks/useAdmin';
import { useState } from 'react';
import { toast } from 'sonner';

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AccountPage() {
  const { user, session, signOut } = useAuthContext();
  const { hasSubscription, subscription, isLoading } = useSubscription();
  const { isAdmin } = useAdmin();
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const isPro = hasSubscription || isAdmin;
  const plan = isPro ? 'Pro' : 'Free';

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/create-portal', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to open billing portal');
      }
    } catch {
      toast.error('Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  };

  const openCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to start checkout');
        setCheckoutLoading(false);
      }
    } catch {
      toast.error('Failed to start checkout');
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back nav */}
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-sm text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to boards
        </Link>

        <h1 className="text-2xl font-bold mb-8">Account</h1>

        {/* Profile section */}
        <section className="rounded-xl border border-white/10 bg-[#111515] p-6 mb-6">
          <h2 className="text-sm font-medium text-[#A8B2B2] uppercase tracking-wider mb-4">
            Profile
          </h2>
          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={String(user.user_metadata.avatar_url)}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-[#A8B2B2]" />
              )}
            </span>
            <div className="min-w-0">
              {user?.user_metadata?.full_name && (
                <p className="font-medium truncate">{String(user.user_metadata.full_name)}</p>
              )}
              <p className="text-sm text-[#A8B2B2] truncate">{user?.email}</p>
            </div>
          </div>
        </section>

        {/* Subscription section */}
        <section className="rounded-xl border border-white/10 bg-[#111515] p-6 mb-6">
          <h2 className="text-sm font-medium text-[#A8B2B2] uppercase tracking-wider mb-4">
            Subscription
          </h2>

          {isLoading ? (
            <div className="flex items-center gap-2 text-[#A8B2B2]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading subscription info...</span>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Plan badge */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-[#A8B2B2]">Current plan</span>
                {plan === 'Pro' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#78fcd6]/10 border border-[#78fcd6]/30 text-[#78fcd6] text-sm font-medium">
                    <Sparkles className="w-3.5 h-3.5" />
                    Pro
                  </span>
                ) : (
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[#A8B2B2] text-sm font-medium">
                    Free
                  </span>
                )}
              </div>

              {/* Admin Pro note */}
              {isAdmin && !hasSubscription && (
                <div className="rounded-lg bg-[#78fcd6]/5 border border-[#78fcd6]/20 px-4 py-3 text-sm text-[#78fcd6] flex items-center gap-2">
                  <Shield className="w-4 h-4 flex-shrink-0" />
                  Pro access granted via admin role
                </div>
              )}

              {/* Billing details for Pro users */}
              {hasSubscription && subscription && (
                <div className="space-y-3 pt-2 border-t border-white/5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-[#A8B2B2] mb-1">Status</p>
                      <p className="text-sm font-medium capitalize">
                        {subscription.cancel_at_period_end
                          ? 'Cancels at period end'
                          : subscription.status}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[#A8B2B2] mb-1">Billing period started</p>
                      <p className="text-sm font-medium">
                        {formatDate(subscription.current_period_start)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[#A8B2B2] mb-1">
                        {subscription.cancel_at_period_end ? 'Access until' : 'Next billing date'}
                      </p>
                      <p className="text-sm font-medium">
                        {formatDate(subscription.current_period_end)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[#A8B2B2] mb-1">Member since</p>
                      <p className="text-sm font-medium">
                        {formatDate(subscription.created_at)}
                      </p>
                    </div>
                  </div>

                  {subscription.cancel_at_period_end && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400">
                      Your subscription is set to cancel. You'll retain Pro access until{' '}
                      {formatDate(subscription.current_period_end)}.
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="pt-2">
                {isPro && hasSubscription ? (
                  <Button
                    onClick={openPortal}
                    disabled={portalLoading}
                    variant="outline"
                    className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
                  >
                    {portalLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    Manage Subscription
                  </Button>
                ) : !isPro ? (
                  <Button
                    onClick={openCheckout}
                    disabled={checkoutLoading}
                    className="gradient-cyan text-[#0B0F0F] hover:opacity-90 font-semibold"
                  >
                    {checkoutLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Redirecting&hellip;
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Upgrade to Pro — $3/mo
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        {/* Admin link */}
        {isAdmin && (
          <section className="rounded-xl border border-[#78fcd6]/20 bg-[#78fcd6]/[0.03] p-6 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#78fcd6]/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-[#78fcd6]" />
                </div>
                <div>
                  <p className="font-medium">Admin Dashboard</p>
                  <p className="text-sm text-[#A8B2B2]">View users, subscriptions, and system stats</p>
                </div>
              </div>
              <Link
                to="/admin"
                className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-[#78fcd6]/30 text-[#78fcd6] text-sm font-medium hover:bg-[#78fcd6]/10 transition-colors"
              >
                Open
              </Link>
            </div>
          </section>
        )}

        {/* Sign out */}
        <section className="rounded-xl border border-white/10 bg-[#111515] p-6">
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              window.location.href = '/';
            }}
            className="border-white/10 text-[#A8B2B2] hover:text-red-400 hover:border-red-400/30 hover:bg-red-400/5"
          >
            Sign out
          </Button>
        </section>
      </div>
    </div>
  );
}
