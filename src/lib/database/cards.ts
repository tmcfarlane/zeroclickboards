import { supabase } from '../supabase'
import type { CardRow, InsertCard, UpdateCard, CardActivity, InsertCardActivity } from '../../types/database'
import type { DatabaseResponse, QueryOptions, RealtimeCallbacks, SubscriptionResult } from './types'

export async function getAll(boardId: string, options?: QueryOptions & { columnId?: string; includeArchived?: boolean }): Promise<DatabaseResponse<CardRow[]>> {
  let query = supabase
    .from('cards')
    .select('*')
    .eq('board_id', boardId)

  if (options?.columnId) {
    query = query.eq('column_id', options.columnId)
  }

  if (!options?.includeArchived) {
    query = query.eq('is_archived', false)
  }

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

export async function getById(id: string, boardId: string): Promise<DatabaseResponse<CardRow>> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('id', id)
    .eq('board_id', boardId)
    .single()

  return { data, error }
}

export async function create(card: InsertCard): Promise<DatabaseResponse<CardRow>> {
  const { data, error } = await supabase
    .from('cards')
    .insert(card)
    .select()
    .single()

  return { data, error }
}

export async function update(id: string, updates: UpdateCard, boardId: string): Promise<DatabaseResponse<CardRow>> {
  const { data, error } = await supabase
    .from('cards')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('board_id', boardId)
    .select()
    .single()

  return { data, error }
}

export async function deleteCard(id: string, boardId: string): Promise<DatabaseResponse<null>> {
  const { data, error } = await supabase
    .from('cards')
    .delete()
    .eq('id', id)
    .eq('board_id', boardId)

  return { data, error }
}

export async function archive(id: string, boardId: string): Promise<DatabaseResponse<CardRow>> {
  return update(id, { is_archived: true }, boardId)
}

export async function unarchive(id: string, boardId: string): Promise<DatabaseResponse<CardRow>> {
  return update(id, { is_archived: false }, boardId)
}

export async function move(id: string, boardId: string, newColumnId: string, newOrder: number): Promise<DatabaseResponse<CardRow>> {
  return update(id, { column_id: newColumnId, order: newOrder }, boardId)
}

export async function reorder(columnId: string, cardIds: string[]): Promise<DatabaseResponse<CardRow[]>> {
  const results = await Promise.all(
    cardIds.map(async (id, index) => {
      const { data, error } = await supabase
        .from('cards')
        .update({ order: index })
        .eq('id', id)
        .eq('column_id', columnId)
        .select()
        .single()

      return { data, error }
    })
  )

  const firstError = results.find((r) => r.error)?.error ?? null
  if (firstError) {
    return { data: null, error: firstError }
  }

  return { data: results.map((r) => r.data).filter(Boolean) as CardRow[], error: null }
}

export async function getActivities(cardId: string): Promise<DatabaseResponse<CardActivity[]>> {
  const { data, error } = await supabase
    .from('card_activities')
    .select('*')
    .eq('card_id', cardId)
    .order('created_at', { ascending: false })

  return { data, error }
}

export async function addActivity(activity: InsertCardActivity): Promise<DatabaseResponse<CardActivity>> {
  const { data, error } = await supabase
    .from('card_activities')
    .insert(activity)
    .select()
    .single()

  return { data, error }
}

export function subscribe(boardId: string, callbacks: RealtimeCallbacks<CardRow>): SubscriptionResult {
  const channel = supabase
    .channel(`cards-${boardId}-changes`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'cards',
        filter: `board_id=eq.${boardId}`
      },
      (payload: { eventType: string; new: unknown; old: unknown }) => {
        switch (payload.eventType) {
          case 'INSERT':
            callbacks.onInsert?.(payload.new as CardRow)
            break
          case 'UPDATE':
            callbacks.onUpdate?.(payload.new as CardRow)
            break
          case 'DELETE':
            callbacks.onDelete?.(payload.old as CardRow)
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

export function subscribeToActivities(cardId: string, callback: (activity: CardActivity) => void): SubscriptionResult {
  const channel = supabase
    .channel(`card-activities-${cardId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'card_activities',
        filter: `card_id=eq.${cardId}`
      },
      (payload: { new: unknown }) => {
        callback(payload.new as CardActivity)
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
