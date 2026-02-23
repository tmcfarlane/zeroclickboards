import type { PostgrestError, RealtimeChannel } from '@supabase/supabase-js'

export interface DatabaseResponse<T> {
  data: T | null
  error: PostgrestError | null
}

export interface DatabaseError {
  message: string
  details?: string
  hint?: string
  code?: string
}

export interface RealtimeCallbacks<T> {
  onInsert?: (payload: T) => void
  onUpdate?: (payload: T) => void
  onDelete?: (payload: T) => void
}

export interface SubscriptionResult {
  channel: RealtimeChannel
  unsubscribe: () => void
}

export interface QueryOptions {
  limit?: number
  offset?: number
  orderBy?: string
  ascending?: boolean
}
