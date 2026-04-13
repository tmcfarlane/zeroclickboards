export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          command_type: string | null
          created_at: string
          id: string
          query_text: string | null
          token_count: number | null
          user_id: string
        }
        Insert: {
          command_type?: string | null
          created_at?: string
          id?: string
          query_text?: string | null
          token_count?: number | null
          user_id: string
        }
        Update: {
          command_type?: string | null
          created_at?: string
          id?: string
          query_text?: string | null
          token_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      board_invites: {
        Row: {
          board_id: string
          board_name: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: string
        }
        Insert: {
          board_id: string
          board_name?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: string
        }
        Update: {
          board_id?: string
          board_name?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_invites_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      board_members: {
        Row: {
          board_id: string
          created_at: string
          id: string
          invited_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          user_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_members_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          created_at: string
          data: Json
          description: string | null
          embed_enabled: boolean
          id: string
          is_public: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          description?: string | null
          embed_enabled?: boolean
          id?: string
          is_public?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          description?: string | null
          embed_enabled?: boolean
          id?: string
          is_public?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      card_activities: {
        Row: {
          card_id: string
          created_at: string
          data: Json | null
          id: string
          type: string
          user_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          data?: Json | null
          id?: string
          type: string
          user_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          data?: Json | null
          id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_activities_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          board_id: string
          column_id: string
          content: Json | null
          cover_image: string | null
          created_at: string
          id: string
          is_archived: boolean
          labels: string[] | null
          order: number
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          board_id: string
          column_id: string
          content?: Json | null
          cover_image?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          labels?: string[] | null
          order?: number
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          board_id?: string
          column_id?: string
          content?: Json | null
          cover_image?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          labels?: string[] | null
          order?: number
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "columns"
            referencedColumns: ["id"]
          },
        ]
      }
      columns: {
        Row: {
          board_id: string
          created_at: string
          id: string
          order: number
          title: string
          user_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          order?: number
          title: string
          user_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          order?: number
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          status: string
          title: string
          user_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          id?: string
          status?: string
          title: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          status?: string
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_lesson_id: string | null
          current_period_end: string | null
          current_step_id: string | null
          email: string | null
          experience_level: string | null
          full_name: string | null
          id: string
          last_activity_date: string | null
          livemode: boolean
          onboarding_completed: boolean
          plan: string
          streak_days: number
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          track_preference: string | null
          xp_total: number
        }
        Insert: {
          avatar_url?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_lesson_id?: string | null
          current_period_end?: string | null
          current_step_id?: string | null
          email?: string | null
          experience_level?: string | null
          full_name?: string | null
          id: string
          last_activity_date?: string | null
          livemode?: boolean
          onboarding_completed?: boolean
          plan?: string
          streak_days?: number
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          track_preference?: string | null
          xp_total?: number
        }
        Update: {
          avatar_url?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_lesson_id?: string | null
          current_period_end?: string | null
          current_step_id?: string | null
          email?: string | null
          experience_level?: string | null
          full_name?: string | null
          id?: string
          last_activity_date?: string | null
          livemode?: boolean
          onboarding_completed?: boolean
          plan?: string
          streak_days?: number
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          track_preference?: string | null
          xp_total?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          status: string
          stripe_customer_id: string
          stripe_price_id: string | null
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id: string
          stripe_price_id?: string | null
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          status?: string
          stripe_customer_id?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_board_ids_for_user: { Args: { p_user_id: string }; Returns: string[] }
      get_editable_board_ids_for_user: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      resolve_pending_invites: {
        Args: { p_email: string; p_user_id: string }
        Returns: undefined
      }
      resolve_pending_invites_for_current_user: {
        Args: Record<string, never>
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
