export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      boards: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string | null
          data: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string | null
          data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          description?: string | null
          data?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      columns: {
        Row: {
          id: string
          board_id: string
          user_id: string
          title: string
          order: number
          created_at: string
        }
        Insert: {
          id?: string
          board_id: string
          user_id: string
          title: string
          order: number
          created_at?: string
        }
        Update: {
          id?: string
          board_id?: string
          user_id?: string
          title?: string
          order?: number
          created_at?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          id: string
          board_id: string
          column_id: string
          user_id: string
          title: string
          content: Json | null
          target_date: string | null
          labels: string[] | null
          cover_image: string | null
          order: number
          is_archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          board_id: string
          column_id: string
          user_id: string
          title: string
          content?: Json | null
          target_date?: string | null
          labels?: string[] | null
          cover_image?: string | null
          order: number
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          board_id?: string
          column_id?: string
          user_id?: string
          title?: string
          content?: Json | null
          target_date?: string | null
          labels?: string[] | null
          cover_image?: string | null
          order?: number
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      card_activities: {
        Row: {
          id: string
          card_id: string
          user_id: string
          type: string
          data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          card_id: string
          user_id: string
          type: string
          data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          card_id?: string
          user_id?: string
          type?: string
          data?: Json | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// Convenience types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type InsertTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type UpdateTables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']

export type Profile = Tables<'profiles'>
export type BoardRow = Tables<'boards'>
export type ColumnRow = Tables<'columns'>
export type CardRow = Tables<'cards'>
export type CardActivity = Tables<'card_activities'>

export type InsertProfile = InsertTables<'profiles'>
export type InsertBoard = InsertTables<'boards'>
export type InsertColumn = InsertTables<'columns'>
export type InsertCard = InsertTables<'cards'>
export type InsertCardActivity = InsertTables<'card_activities'>

export type UpdateProfile = UpdateTables<'profiles'>
export type UpdateBoard = UpdateTables<'boards'>
export type UpdateColumn = UpdateTables<'columns'>
export type UpdateCard = UpdateTables<'cards'>
export type UpdateCardActivity = UpdateTables<'card_activities'>
