import { supabase } from '../supabase'
import type { BoardRow, InsertBoard, UpdateBoard } from '../../types/database'
import type { DatabaseResponse, QueryOptions, RealtimeCallbacks, SubscriptionResult } from './types'

export async function getAll(userId: string, options?: QueryOptions): Promise<DatabaseResponse<BoardRow[]>> {
  let query = supabase
    .from('boards')
    .select('*')
    .eq('user_id', userId)

  if (options?.orderBy) {
    query = query.order(options.orderBy, { ascending: options.ascending ?? true })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 10) - 1)
  }

  const { data, error } = await query
  return { data, error }
}

export async function getById(id: string, userId: string): Promise<DatabaseResponse<BoardRow>> {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  return { data, error }
}

export async function create(board: InsertBoard): Promise<DatabaseResponse<BoardRow>> {
  const { data, error } = await supabase
    .from('boards')
    .insert(board)
    .select()
    .single()

  return { data, error }
}

export async function update(id: string, updates: UpdateBoard, userId: string): Promise<DatabaseResponse<BoardRow>> {
  const { data, error } = await supabase
    .from('boards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  return { data, error }
}

export async function deleteBoard(id: string, userId: string): Promise<DatabaseResponse<null>> {
  const { data, error } = await supabase
    .from('boards')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  return { data, error }
}

export function subscribe(userId: string, callbacks: RealtimeCallbacks<BoardRow>): SubscriptionResult {
  const channel = supabase
    .channel('boards-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'boards',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        switch (payload.eventType) {
          case 'INSERT':
            callbacks.onInsert?.(payload.new as BoardRow)
            break
          case 'UPDATE':
            callbacks.onUpdate?.(payload.new as BoardRow)
            break
          case 'DELETE':
            callbacks.onDelete?.(payload.old as BoardRow)
            break
        }
      }
    )
    .subscribe()

  return {
    channel,
    unsubscribe: () => {
      supabase.removeChannel(channel)
    }
  }
}
