import { supabase } from '../supabase'
import type { ColumnRow, InsertColumn, UpdateColumn } from '../../types/database'
import type { DatabaseResponse, QueryOptions, RealtimeCallbacks, SubscriptionResult } from './types'

export async function getAll(boardId: string, options?: QueryOptions): Promise<DatabaseResponse<ColumnRow[]>> {
  let query = supabase
    .from('columns')
    .select('*')
    .eq('board_id', boardId)

  if (options?.orderBy) {
    query = query.order(options.orderBy, { ascending: options.ascending ?? true })
  } else {
    query = query.order('order', { ascending: true })
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

export async function getById(id: string, boardId: string): Promise<DatabaseResponse<ColumnRow>> {
  const { data, error } = await supabase
    .from('columns')
    .select('*')
    .eq('id', id)
    .eq('board_id', boardId)
    .single()

  return { data, error }
}

export async function create(column: InsertColumn): Promise<DatabaseResponse<ColumnRow>> {
  const { data, error } = await supabase
    .from('columns')
    .insert(column)
    .select()
    .single()

  return { data, error }
}

export async function update(id: string, updates: UpdateColumn, boardId: string): Promise<DatabaseResponse<ColumnRow>> {
  const { data, error } = await supabase
    .from('columns')
    .update(updates)
    .eq('id', id)
    .eq('board_id', boardId)
    .select()
    .single()

  return { data, error }
}

export async function deleteColumn(id: string, boardId: string): Promise<DatabaseResponse<null>> {
  const { data, error } = await supabase
    .from('columns')
    .delete()
    .eq('id', id)
    .eq('board_id', boardId)

  return { data, error }
}

export async function reorder(boardId: string, columnIds: string[]): Promise<DatabaseResponse<ColumnRow[]>> {
  const results = await Promise.all(
    columnIds.map(async (id, index) => {
      const { data, error } = await supabase
        .from('columns')
        .update({ order: index })
        .eq('id', id)
        .eq('board_id', boardId)
        .select()
        .single()

      return { data, error }
    })
  )

  const firstError = results.find((r) => r.error)?.error ?? null
  if (firstError) {
    return { data: null, error: firstError }
  }

  return { data: results.map((r) => r.data).filter(Boolean) as ColumnRow[], error: null }
}

export function subscribe(boardId: string, callbacks: RealtimeCallbacks<ColumnRow>): SubscriptionResult {
  const channel = supabase
    .channel(`columns-${boardId}-changes`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'columns',
        filter: `board_id=eq.${boardId}`
      },
      (payload: { eventType: string; new: unknown; old: unknown }) => {
        switch (payload.eventType) {
          case 'INSERT':
            callbacks.onInsert?.(payload.new as ColumnRow)
            break
          case 'UPDATE':
            callbacks.onUpdate?.(payload.new as ColumnRow)
            break
          case 'DELETE':
            callbacks.onDelete?.(payload.old as ColumnRow)
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
