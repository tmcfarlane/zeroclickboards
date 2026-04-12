import { useQuery } from '@tanstack/react-query'
import { useAuthContext } from '@/components/auth/AuthProvider'

interface SubscriptionData {
  hasActiveSubscription: boolean
  subscription: {
    id: string
    status: string
    current_period_end: string
    cancel_at_period_end: boolean
  } | null
}

export function useSubscription() {
  const { session, isSignedIn } = useAuthContext()

  const { data, isLoading, refetch } = useQuery<SubscriptionData>({
    queryKey: ['subscription', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/stripe/check-subscription', {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
        },
      })
      if (!res.ok) throw new Error('Failed to check subscription')
      return res.json()
    },
    enabled: isSignedIn && !!session?.access_token,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  return {
    hasSubscription: data?.hasActiveSubscription ?? false,
    subscription: data?.subscription ?? null,
    isLoading,
    refetch,
  }
}
