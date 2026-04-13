import { supabase } from '../supabase'
import type { DatabaseResponse } from './types'

export interface FeedbackRow {
  id: string
  user_id: string | null
  title: string
  description: string
  category: string
  status: string
  created_at: string
}

export interface InsertFeedback {
  user_id?: string | null
  title: string
  description: string
  category?: string
}

export async function create(data: InsertFeedback): Promise<DatabaseResponse<FeedbackRow>> {
  const { data: result, error } = await supabase
    .from('feedback')
    .insert(data)
    .select()
    .single()

  return { data: result, error }
}

export async function getByUser(userId: string): Promise<DatabaseResponse<FeedbackRow[]>> {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return { data, error }
}
