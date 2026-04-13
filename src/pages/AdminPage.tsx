import { Link } from 'react-router-dom';
import { ArrowLeft, Users, CreditCard, Sparkles, Loader2, RefreshCw, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdminStats } from '@/hooks/useAdmin';

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StatusBadge({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd?: boolean }) {
  if (cancelAtPeriodEnd) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
        Cancelling
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        Active
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-[#A8B2B2] border border-white/10">
      {status}
    </span>
  );
}

export function AdminPage() {
  const { isAdmin, stats, recentUsers, recentSubscriptions, isLoading, refetch } = useAdminStats();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-[#78fcd6] animate-spin" />
          <span className="text-[#A8B2B2] text-sm">Checking admin access...</span>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <Shield className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-[#F2F7F7] mb-2">Access Denied</h1>
        <p className="text-[#A8B2B2] mb-6">You don't have admin access.</p>
        <Link
          to="/app"
          className="inline-flex items-center justify-center h-10 px-6 gradient-cyan text-[#0B0F0F] font-semibold rounded-xl hover:opacity-90 transition-opacity"
        >
          Back to App
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7]">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Back nav + title */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              to="/app"
              className="inline-flex items-center gap-1.5 text-sm text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors mb-3"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to boards
            </Link>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-[#78fcd6]" />
              Admin Dashboard
            </h1>
          </div>
          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            className="border-white/10 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
        </div>

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="rounded-xl border border-white/10 bg-[#111515] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-400" />
                </div>
                <span className="text-sm text-[#A8B2B2]">Total Users</span>
              </div>
              <p className="text-3xl font-bold">{stats.totalUsers}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111515] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#78fcd6]/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[#78fcd6]" />
                </div>
                <span className="text-sm text-[#A8B2B2]">Active Subs</span>
              </div>
              <p className="text-3xl font-bold">{stats.activeSubscriptions}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111515] p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-purple-400" />
                </div>
                <span className="text-sm text-[#A8B2B2]">Total Subs</span>
              </div>
              <p className="text-3xl font-bold">{stats.totalSubscriptions}</p>
            </div>
          </div>
        )}

        {/* Recent Users */}
        <section className="rounded-xl border border-white/10 bg-[#111515] p-6 mb-6">
          <h2 className="text-sm font-medium text-[#A8B2B2] uppercase tracking-wider mb-4">
            Recent Users
          </h2>
          {recentUsers.length === 0 ? (
            <p className="text-sm text-[#A8B2B2]">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-[#A8B2B2]">
                    <th className="pb-2 pr-4 font-medium">User</th>
                    <th className="pb-2 pr-4 font-medium">Email</th>
                    <th className="pb-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recentUsers.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
                              <Users className="w-3 h-3 text-[#A8B2B2]" />
                            </div>
                          )}
                          <span className="truncate max-w-[160px]">{u.full_name || '—'}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-[#A8B2B2] truncate max-w-[200px]">{u.email}</td>
                      <td className="py-2.5 text-[#A8B2B2] whitespace-nowrap">{formatDate(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent Subscriptions */}
        <section className="rounded-xl border border-white/10 bg-[#111515] p-6">
          <h2 className="text-sm font-medium text-[#A8B2B2] uppercase tracking-wider mb-4">
            Recent Subscriptions
          </h2>
          {recentSubscriptions.length === 0 ? (
            <p className="text-sm text-[#A8B2B2]">No subscriptions found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-[#A8B2B2]">
                    <th className="pb-2 pr-4 font-medium">User</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Period Start</th>
                    <th className="pb-2 pr-4 font-medium">Period End</th>
                    <th className="pb-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recentSubscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 pr-4">
                        <div className="truncate max-w-[180px]">
                          <span className="text-[#F2F7F7]">{s.user_name || s.user_email}</span>
                          {s.user_name && (
                            <span className="text-[#A8B2B2] text-xs ml-1.5">{s.user_email}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={s.status} cancelAtPeriodEnd={s.cancel_at_period_end} />
                      </td>
                      <td className="py-2.5 pr-4 text-[#A8B2B2] whitespace-nowrap">{formatDate(s.current_period_start)}</td>
                      <td className="py-2.5 pr-4 text-[#A8B2B2] whitespace-nowrap">{formatDate(s.current_period_end)}</td>
                      <td className="py-2.5 text-[#A8B2B2] whitespace-nowrap">{formatDate(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
