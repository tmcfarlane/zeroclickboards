import { supabase } from '../supabase'
import type { DatabaseResponse } from './types'

export type MemberRole = 'owner' | 'editor' | 'commenter' | 'viewer'

export interface BoardMemberRow {
  id: string
  board_id: string
  user_id: string
  role: string
  invited_by: string | null
  created_at: string
}

export interface BoardMemberWithProfile extends BoardMemberRow {
  profiles: {
    email: string
    full_name: string | null
    avatar_url: string | null
  } | null
}

export async function getMembers(boardId: string): Promise<DatabaseResponse<BoardMemberWithProfile[]>> {
  const { data, error } = await supabase
    .from('board_members')
    .select('*, profiles(email, full_name, avatar_url)')
    .eq('board_id', boardId)

  return { data: data as BoardMemberWithProfile[] | null, error }
}

export async function addMember(boardId: string, userId: string, role: MemberRole, invitedBy?: string): Promise<DatabaseResponse<BoardMemberRow>> {
  const { data, error } = await supabase
    .from('board_members')
    .insert({
      board_id: boardId,
      user_id: userId,
      role,
      invited_by: invitedBy ?? null,
    })
    .select()
    .single()

  return { data, error }
}

export async function updateRole(boardId: string, userId: string, role: MemberRole): Promise<DatabaseResponse<BoardMemberRow>> {
  const { data, error } = await supabase
    .from('board_members')
    .update({ role })
    .eq('board_id', boardId)
    .eq('user_id', userId)
    .select()
    .single()

  return { data, error }
}

export async function removeMember(boardId: string, userId: string): Promise<DatabaseResponse<null>> {
  const { data, error } = await supabase
    .from('board_members')
    .delete()
    .eq('board_id', boardId)
    .eq('user_id', userId)

  return { data, error }
}

export async function getMembership(boardId: string, userId: string): Promise<DatabaseResponse<BoardMemberRow>> {
  const { data, error } = await supabase
    .from('board_members')
    .select('*')
    .eq('board_id', boardId)
    .eq('user_id', userId)
    .single()

  return { data, error }
}

export async function searchProfiles(email: string): Promise<DatabaseResponse<{ id: string; email: string | null; full_name: string | null; avatar_url: string | null }[]>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .ilike('email', `%${email}%`)
    .limit(10)

  return { data, error }
}
