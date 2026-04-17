import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '@/components/auth/AuthProvider'
import { apiFetch } from '@/lib/apiFetch'

interface AIUsageData {
  used: number
  limit: number | null
  resetsAt: string
}

export function useAIUsage() {
  const { session, isSignedIn } = useAuthContext()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<AIUsageData>({
    queryKey: ['ai-usage', session?.user?.id],
    queryFn: async () => {
      const res = await apiFetch('/api/ai/usage', { session })
      if (!res.ok) throw new Error('Failed to fetch AI usage')
      return res.json()
    },
    enabled: isSignedIn && !!session?.access_token,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const updateUsage = (usage: { used: number; limit: number | null; warning?: boolean }) => {
    queryClient.setQueryData(['ai-usage', session?.user?.id], (old: AIUsageData | undefined) => ({
      ...old,
      used: usage.used,
      limit: usage.limit,
      resetsAt: old?.resetsAt ?? '',
    }))
  }

  const remaining = data?.limit != null ? Math.max(0, data.limit - data.used) : null
  const isLimitReached = data?.limit != null && data.used >= data.limit
  const isPaid = data?.limit === null

  return {
    used: data?.used ?? 0,
    limit: data?.limit ?? null,
    remaining,
    isLimitReached,
    isPaid,
    resetsAt: data?.resetsAt ?? null,
    isLoading,
    updateUsage,
  }
}
