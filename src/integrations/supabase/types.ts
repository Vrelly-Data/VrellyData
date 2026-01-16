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
      api_keys: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          last_used_at: string | null
          name: string
          team_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          last_used_at?: string | null
          name: string
          team_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          last_used_at?: string | null
          name?: string
          team_id?: string
        }
        Relationships: []
      }
      audiences: {
        Row: {
          created_at: string
          created_by: string
          filters: Json
          id: string
          name: string
          result_count: number | null
          team_id: string
          type: Database["public"]["Enums"]["entity_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          filters?: Json
          id?: string
          name: string
          result_count?: number | null
          team_id: string
          type: Database["public"]["Enums"]["entity_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          filters?: Json
          id?: string
          name?: string
          result_count?: number | null
          team_id?: string
          type?: Database["public"]["Enums"]["entity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audiences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audiences_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_count: number | null
          entity_type: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          team_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_count?: number | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          team_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_count?: number | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          team_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      company_records: {
        Row: {
          created_at: string | null
          entity_data: Json
          entity_external_id: string
          id: string
          source: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_data: Json
          entity_external_id: string
          id?: string
          source: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_data?: Json
          entity_external_id?: string
          id?: string
          source?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          audience_id: string | null
          created_at: string
          credits_deducted: number
          entity_type: string
          id: string
          records_returned: number
          user_id: string
        }
        Insert: {
          audience_id?: string | null
          created_at?: string
          credits_deducted?: number
          entity_type: string
          id?: string
          records_returned?: number
          user_id: string
        }
        Update: {
          audience_id?: string | null
          created_at?: string
          credits_deducted?: number
          entity_type?: string
          id?: string
          records_returned?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_templates: {
        Row: {
          column_mappings: Json
          created_at: string | null
          created_by: string
          description: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          column_mappings?: Json
          created_at?: string | null
          created_by: string
          description?: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          column_mappings?: Json
          created_at?: string | null
          created_by?: string
          description?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          audience_id: string
          completed_at: string | null
          created_at: string
          file_path: string | null
          format: Database["public"]["Enums"]["export_format"]
          id: string
          status: Database["public"]["Enums"]["export_status"]
          team_id: string
        }
        Insert: {
          audience_id: string
          completed_at?: string | null
          created_at?: string
          file_path?: string | null
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          status?: Database["public"]["Enums"]["export_status"]
          team_id: string
        }
        Update: {
          audience_id?: string
          completed_at?: string | null
          created_at?: string
          file_path?: string | null
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          status?: Database["public"]["Enums"]["export_status"]
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_audience_id_fkey"
            columns: ["audience_id"]
            isOneToOne: false
            referencedRelation: "audiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      external_campaigns: {
        Row: {
          campaign_id: string
          campaign_name: string
          created_at: string | null
          field_mappings: Json | null
          id: string
          last_synced_at: string | null
          project_id: string
        }
        Insert: {
          campaign_id: string
          campaign_name: string
          created_at?: string | null
          field_mappings?: Json | null
          id?: string
          last_synced_at?: string | null
          project_id: string
        }
        Update: {
          campaign_id?: string
          campaign_name?: string
          created_at?: string | null
          field_mappings?: Json | null
          id?: string
          last_synced_at?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_campaigns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "external_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      external_projects: {
        Row: {
          api_endpoint: string
          api_key_encrypted: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          api_endpoint: string
          api_key_encrypted: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          api_endpoint?: string
          api_key_encrypted?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      filter_presets: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          team_id: string
          type: Database["public"]["Enums"]["entity_type"]
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          team_id: string
          type: Database["public"]["Enums"]["entity_type"]
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          team_id?: string
          type?: Database["public"]["Enums"]["entity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "filter_presets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      free_data: {
        Row: {
          created_at: string | null
          entity_data: Json
          entity_external_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          source_template_id: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string | null
          entity_data: Json
          entity_external_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          source_template_id?: string | null
          uploaded_by: string
        }
        Update: {
          created_at?: string | null
          entity_data?: Json
          entity_external_id?: string
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          source_template_id?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_data_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "data_source_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      list_items: {
        Row: {
          added_at: string
          added_by: string
          entity_data: Json
          entity_external_id: string
          id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          entity_data: Json
          entity_external_id: string
          id?: string
          list_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          entity_data?: Json
          entity_external_id?: string
          id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          name: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          name: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          name?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      people_records: {
        Row: {
          created_at: string | null
          entity_data: Json
          entity_external_id: string
          id: string
          source: string
          team_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_data: Json
          entity_external_id: string
          id?: string
          source: string
          team_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_data?: Json
          entity_external_id?: string
          id?: string
          source?: string
          team_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          billing_period_end: string | null
          billing_period_start: string | null
          created_at: string
          credits: number
          credits_used_this_month: number | null
          credits_used_today: number
          id: string
          last_credit_reset_date: string | null
          monthly_credit_limit: number | null
          name: string | null
          plan: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          subscription_tier: string | null
          updated_at: string
        }
        Insert: {
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          credits?: number
          credits_used_this_month?: number | null
          credits_used_today?: number
          id: string
          last_credit_reset_date?: string | null
          monthly_credit_limit?: number | null
          name?: string | null
          plan?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string
        }
        Update: {
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          credits?: number
          credits_used_this_month?: number | null
          credits_used_today?: number
          id?: string
          last_credit_reset_date?: string | null
          monthly_credit_limit?: number | null
          name?: string | null
          plan?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      received_contacts: {
        Row: {
          campaign_id: string | null
          contact_data: Json
          created_at: string | null
          id: string
          source_project: string
          status: string | null
          team_id: string
        }
        Insert: {
          campaign_id?: string | null
          contact_data: Json
          created_at?: string | null
          id?: string
          source_project: string
          status?: string | null
          team_id: string
        }
        Update: {
          campaign_id?: string | null
          contact_data?: Json
          created_at?: string | null
          id?: string
          source_project?: string
          status?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "received_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      suppression_lists: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          team_id: string
          type: Database["public"]["Enums"]["suppression_type"]
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          team_id: string
          type: Database["public"]["Enums"]["suppression_type"]
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          team_id?: string
          type?: Database["public"]["Enums"]["suppression_type"]
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppression_lists_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      unlock_events: {
        Row: {
          audience_id: string | null
          cost: number
          created_at: string
          entity_external_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          audience_id?: string | null
          cost: number
          created_at?: string
          entity_external_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          payload?: Json
          user_id: string
        }
        Update: {
          audience_id?: string | null
          cost?: number
          created_at?: string
          entity_external_id?: string
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unlock_events_audience_id_fkey"
            columns: ["audience_id"]
            isOneToOne: false
            referencedRelation: "audiences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unlock_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      unlocked_records: {
        Row: {
          entity_data: Json
          entity_external_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          team_id: string
          unlocked_at: string | null
          user_id: string
        }
        Insert: {
          entity_data: Json
          entity_external_id: string
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          team_id: string
          unlocked_at?: string | null
          user_id: string
        }
        Update: {
          entity_data?: Json
          entity_external_id?: string
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          team_id?: string
          unlocked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          event_types: string[]
          id: string
          is_active: boolean
          secret: string
          team_id: string
          url: string
        }
        Insert: {
          created_at?: string
          event_types?: string[]
          id?: string
          is_active?: boolean
          secret: string
          team_id: string
          url: string
        }
        Update: {
          created_at?: string
          event_types?: string[]
          id?: string
          is_active?: boolean
          secret?: string
          team_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deduct_credits: {
        Args: { p_amount: number; p_user_id: string }
        Returns: Json
      }
      get_all_profiles_admin: {
        Args: never
        Returns: {
          created_at: string
          credits: number
          id: string
          is_admin: boolean
          name: string
          plan: string
          subscription_status: string
          subscription_tier: string
        }[]
      }
      get_filter_suggestions: { Args: never; Returns: Json }
      get_user_team_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _team_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_global_admin: { Args: { _user_id: string }; Returns: boolean }
      log_audit_event: {
        Args: {
          _action: string
          _entity_count?: number
          _entity_type?: string
          _metadata?: Json
        }
        Returns: string
      }
      parse_employee_count_upper: {
        Args: { size_str: string }
        Returns: number
      }
      reset_daily_credits_if_needed: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      reset_monthly_credits: { Args: never; Returns: undefined }
      search_free_data_builder:
        | {
            Args: {
              p_cities?: string[]
              p_company_revenue?: string[]
              p_company_size_ranges?: string[]
              p_countries?: string[]
              p_departments?: string[]
              p_entity_type?: Database["public"]["Enums"]["entity_type"]
              p_gender?: string[]
              p_has_business_email?: boolean
              p_has_company_facebook?: boolean
              p_has_company_linkedin?: boolean
              p_has_company_phone?: boolean
              p_has_company_twitter?: boolean
              p_has_facebook?: boolean
              p_has_linkedin?: boolean
              p_has_personal_email?: boolean
              p_has_phone?: boolean
              p_has_twitter?: boolean
              p_income?: string[]
              p_industries?: string[]
              p_job_titles?: string[]
              p_keywords?: string[]
              p_limit?: number
              p_net_worth?: string[]
              p_offset?: number
              p_person_interests?: string[]
              p_person_skills?: string[]
              p_seniority_levels?: string[]
              p_technologies?: string[]
            }
            Returns: {
              entity_data: Json
              entity_external_id: string
              total_count: number
            }[]
          }
        | {
            Args: {
              p_cities?: string[]
              p_company_revenue?: string[]
              p_company_size_ranges?: string[]
              p_countries?: string[]
              p_departments?: string[]
              p_entity_type?: string
              p_gender?: string[]
              p_has_business_email?: boolean
              p_has_company_facebook?: boolean
              p_has_company_linkedin?: boolean
              p_has_company_phone?: boolean
              p_has_company_twitter?: boolean
              p_has_facebook?: boolean
              p_has_linkedin?: boolean
              p_has_personal_email?: boolean
              p_has_phone?: boolean
              p_has_twitter?: boolean
              p_income?: string[]
              p_industries?: string[]
              p_job_titles?: string[]
              p_keywords?: string[]
              p_limit?: number
              p_net_worth?: string[]
              p_offset?: number
              p_person_interests?: string[]
              p_person_skills?: string[]
              p_seniority_levels?: string[]
              p_technologies?: string[]
            }
            Returns: {
              entity_data: Json
              entity_external_id: string
              total_count: number
            }[]
          }
      title_matches_seniority: {
        Args: {
          p_seniority: string[]
          p_seniority_field?: string
          p_title: string
        }
        Returns: boolean
      }
      update_credits_for_testing: {
        Args: { p_new_credits: number; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "member"
      entity_type: "person" | "company"
      export_format: "csv" | "json"
      export_status: "pending" | "running" | "done" | "failed"
      suppression_type: "email" | "domain" | "company_id" | "person_id"
      user_role: "admin" | "member"
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
    Enums: {
      app_role: ["admin", "member"],
      entity_type: ["person", "company"],
      export_format: ["csv", "json"],
      export_status: ["pending", "running", "done", "failed"],
      suppression_type: ["email", "domain", "company_id", "person_id"],
      user_role: ["admin", "member"],
    },
  },
} as const
