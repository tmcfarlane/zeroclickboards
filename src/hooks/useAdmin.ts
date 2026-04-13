import { useQuery } from '@tanstack/react-query'
import { useAuthContext } from '@/components/auth/AuthProvider'

interface AdminProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
}

interface AdminSubscription {
  id: string
  user_id: string
  user_email: string
  user_name: string | null
  status: string
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

interface AdminStats {
  totalUsers: number
  totalSubscriptions: number
  activeSubscriptions: number
}

interface AdminStatsData {
  isAdmin: boolean
  stats: AdminStats
  recentUsers: AdminProfile[]
  recentSubscriptions: AdminSubscription[]
}

/** Lightweight admin check — no service role key needed */
export function useAdmin() {
  const { session, isSignedIn } = useAuthContext()

  const { data } = useQuery<{ isAdmin: boolean }>({
    queryKey: ['admin-check', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/admin/check', {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      })
      if (!res.ok) return { isAdmin: false }
      return res.json()
    },
    enabled: isSignedIn && !!session?.access_token,
    staleTime: 60_000,
    retry: false,
  })

  return {
    isAdmin: data?.isAdmin ?? false,
  }
}

/** Full admin stats — requires service role key on the backend */
export function useAdminStats() {
  const { session, isSignedIn } = useAuthContext()

  const { data, isLoading, error, refetch } = useQuery<AdminStatsData>({
    queryKey: ['admin-stats', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats', {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      })
      if (res.status === 403) {
        return { isAdmin: false, stats: { totalUsers: 0, totalSubscriptions: 0, activeSubscriptions: 0 }, recentUsers: [], recentSubscriptions: [] }
      }
      if (!res.ok) throw new Error('Failed to fetch admin stats')
      return res.json()
    },
    enabled: isSignedIn && !!session?.access_token,
    staleTime: 30_000,
    retry: false,
  })

  return {
    isAdmin: data?.isAdmin ?? false,
    stats: data?.stats ?? null,
    recentUsers: data?.recentUsers ?? [],
    recentSubscriptions: data?.recentSubscriptions ?? [],
    isLoading,
    error,
    refetch,
  }
}
