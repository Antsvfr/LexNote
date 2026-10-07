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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      capture_interruptions: {
        Row: {
          at_ms: number
          course_session_id: string
          created_at: string
          id: string
          kind: string
          message: string
          recoverable: boolean
          resolved_at_ms: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          at_ms?: number
          course_session_id: string
          created_at?: string
          id?: string
          kind: string
          message: string
          recoverable?: boolean
          resolved_at_ms?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          at_ms?: number
          course_session_id?: string
          created_at?: string
          id?: string
          kind?: string
          message?: string
          recoverable?: boolean
          resolved_at_ms?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_interruptions_course_session_id_fkey"
            columns: ["course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capture_interruptions_user_course_fk"
            columns: ["user_id", "course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      course_sessions: {
        Row: {
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          duration_sec: number
          end_time: string | null
          excerpt: string
          id: string
          module_id: string | null
          notes: Json | null
          room: string | null
          search_text: string
          session_date: string | null
          session_number: number | null
          session_type: string
          start_time: string | null
          status: string
          subject_id: string
          teacher: string | null
          thumbnail: string | null
          title: string
          updated_at: string
          user_id: string
          version: number
          word_count: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_sec?: number
          end_time?: string | null
          excerpt?: string
          id?: string
          module_id?: string | null
          notes?: Json | null
          room?: string | null
          search_text?: string
          session_date?: string | null
          session_number?: number | null
          session_type?: string
          start_time?: string | null
          status?: string
          subject_id: string
          teacher?: string | null
          thumbnail?: string | null
          title: string
          updated_at?: string
          user_id: string
          version?: number
          word_count?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_sec?: number
          end_time?: string | null
          excerpt?: string
          id?: string
          module_id?: string | null
          notes?: Json | null
          room?: string | null
          search_text?: string
          session_date?: string | null
          session_number?: number | null
          session_type?: string
          start_time?: string | null
          status?: string
          subject_id?: string
          teacher?: string | null
          thumbnail?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          version?: number
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_sessions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_sessions_user_module_fk"
            columns: ["user_id", "module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "course_sessions_user_subject_fk"
            columns: ["user_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          position: number
          subject_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          position?: number
          subject_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          position?: number
          subject_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "modules_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modules_user_subject_fk"
            columns: ["user_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      note_anchors: {
        Row: {
          course_session_id: string
          created_at: string
          deleted_at: string | null
          id: string
          nearby_transcript_segment_ids: string[]
          note_position: Json | null
          timestamp_ms: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          course_session_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          nearby_transcript_segment_ids?: string[]
          note_position?: Json | null
          timestamp_ms?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          course_session_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          nearby_transcript_segment_ids?: string[]
          note_position?: Json | null
          timestamp_ms?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_anchors_course_session_id_fkey"
            columns: ["course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_anchors_user_course_fk"
            columns: ["user_id", "course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          academic_year: string | null
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          institution: string | null
          last_name: string | null
          onboarding_completed: boolean
          quote: string | null
          updated_at: string
        }
        Insert: {
          academic_year?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          institution?: string | null
          last_name?: string | null
          onboarding_completed?: boolean
          quote?: string | null
          updated_at?: string
        }
        Update: {
          academic_year?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          institution?: string | null
          last_name?: string | null
          onboarding_completed?: boolean
          quote?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subjects: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          semester: string | null
          teacher: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          semester?: string | null
          teacher?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          semester?: string | null
          teacher?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      sync_metadata: {
        Row: {
          created_at: string
          device_id: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timeline_markers: {
        Row: {
          course_session_id: string
          created_at: string
          deleted_at: string | null
          id: string
          label: string | null
          marker_type: string
          note: string | null
          reasons: Json
          timestamp_ms: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          course_session_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label?: string | null
          marker_type?: string
          note?: string | null
          reasons?: Json
          timestamp_ms?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          course_session_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label?: string | null
          marker_type?: string
          note?: string | null
          reasons?: Json
          timestamp_ms?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "timeline_markers_course_session_id_fkey"
            columns: ["course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_markers_user_course_fk"
            columns: ["user_id", "course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          confidence: number | null
          course_session_id: string
          created_at: string
          deleted_at: string | null
          end_ms: number | null
          id: string
          provider: string | null
          sequence: number
          start_ms: number | null
          status: string | null
          text: string
          transcript_session_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          confidence?: number | null
          course_session_id: string
          created_at?: string
          deleted_at?: string | null
          end_ms?: number | null
          id?: string
          provider?: string | null
          sequence?: number
          start_ms?: number | null
          status?: string | null
          text?: string
          transcript_session_id: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          confidence?: number | null
          course_session_id?: string
          created_at?: string
          deleted_at?: string | null
          end_ms?: number | null
          id?: string
          provider?: string | null
          sequence?: number
          start_ms?: number | null
          status?: string | null
          text?: string
          transcript_session_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_course_session_id_fkey"
            columns: ["course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_segments_transcript_session_id_fkey"
            columns: ["transcript_session_id"]
            isOneToOne: false
            referencedRelation: "transcript_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_segments_user_course_fk"
            columns: ["user_id", "course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transcript_segments_user_transcript_fk"
            columns: ["user_id", "transcript_session_id"]
            isOneToOne: false
            referencedRelation: "transcript_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      transcript_sessions: {
        Row: {
          audio_metadata: Json | null
          course_session_id: string
          created_at: string
          deleted_at: string | null
          ended_at: string | null
          id: string
          provider: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          audio_metadata?: Json | null
          course_session_id: string
          created_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          id?: string
          provider?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          audio_metadata?: Json | null
          course_session_id?: string
          created_at?: string
          deleted_at?: string | null
          ended_at?: string | null
          id?: string
          provider?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcript_sessions_course_session_id_fkey"
            columns: ["course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_sessions_user_course_fk"
            columns: ["user_id", "course_session_id"]
            isOneToOne: false
            referencedRelation: "course_sessions"
            referencedColumns: ["user_id", "id"]
          },
        ]
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
