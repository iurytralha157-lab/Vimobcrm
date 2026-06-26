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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          content: string | null
          created_at: string
          id: string
          lead_id: string
          metadata: Json | null
          type: string
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          lead_id: string
          metadata?: Json | null
          type: string
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_subscription_plans: {
        Row: {
          billing_cycle: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_leads: number | null
          max_whatsapp_sessions: number | null
          max_users: number | null
          modules: string[] | null
          name: string
          price: number
          trial_enabled: boolean | null
          trial_days: number | null
          updated_at: string | null
        }
        Insert: {
          billing_cycle?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_leads?: number | null
          max_whatsapp_sessions?: number | null
          max_users?: number | null
          modules?: string[] | null
          name: string
          price?: number
          trial_enabled?: boolean | null
          trial_days?: number | null
          updated_at?: string | null
        }
        Update: {
          billing_cycle?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_leads?: number | null
          max_whatsapp_sessions?: number | null
          max_users?: number | null
          modules?: string[] | null
          name?: string
          price?: number
          trial_enabled?: boolean | null
          trial_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_agent_conversations: {
        Row: {
          agent_id: string
          conversation_id: string
          handed_off_at: string | null
          id: string
          lead_id: string | null
          message_count: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          agent_id: string
          conversation_id: string
          handed_off_at?: string | null
          id?: string
          lead_id?: string | null
          message_count?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          agent_id?: string
          conversation_id?: string
          handed_off_at?: string | null
          id?: string
          lead_id?: string | null
          message_count?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agent_conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agent_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_agents: {
        Row: {
          ai_provider: string | null
          created_at: string | null
          handoff_keywords: string[] | null
          id: string
          is_active: boolean | null
          max_messages_before_handoff: number | null
          name: string
          organization_id: string
          session_id: string | null
          system_prompt: string | null
          updated_at: string | null
        }
        Insert: {
          ai_provider?: string | null
          created_at?: string | null
          handoff_keywords?: string[] | null
          id?: string
          is_active?: boolean | null
          max_messages_before_handoff?: number | null
          name?: string
          organization_id: string
          session_id?: string | null
          system_prompt?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_provider?: string | null
          created_at?: string | null
          handoff_keywords?: string[] | null
          id?: string
          is_active?: boolean | null
          max_messages_before_handoff?: number | null
          name?: string
          organization_id?: string
          session_id?: string | null
          system_prompt?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          button_text: string | null
          button_url: string | null
          created_at: string | null
          created_by: string | null
          display_duration_seconds: number | null
          ends_at: string | null
          id: string
          is_active: boolean | null
          message: string
          send_notification: boolean | null
          show_banner: boolean | null
          starts_at: string | null
          target_organization_ids: string[] | null
          target_type: string | null
          target_user_ids: string[] | null
          updated_at: string | null
        }
        Insert: {
          button_text?: string | null
          button_url?: string | null
          created_at?: string | null
          created_by?: string | null
          display_duration_seconds?: number | null
          ends_at?: string | null
          id?: string
          is_active?: boolean | null
          message: string
          send_notification?: boolean | null
          show_banner?: boolean | null
          starts_at?: string | null
          target_organization_ids?: string[] | null
          target_type?: string | null
          target_user_ids?: string[] | null
          updated_at?: string | null
        }
        Update: {
          button_text?: string | null
          button_url?: string | null
          created_at?: string | null
          created_by?: string | null
          display_duration_seconds?: number | null
          ends_at?: string | null
          id?: string
          is_active?: boolean | null
          message?: string
          send_notification?: boolean | null
          show_banner?: boolean | null
          starts_at?: string | null
          target_organization_ids?: string[] | null
          target_type?: string | null
          target_user_ids?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      asaas_payments: {
        Row: {
          asaas_customer_id: string | null
          asaas_payment_id: string
          asaas_subscription_id: string | null
          billing_type: string | null
          created_at: string | null
          due_date: string | null
          id: string
          invoice_url: string | null
          net_value: number | null
          organization_id: string
          payment_date: string | null
          raw_event: Json | null
          status: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          asaas_customer_id?: string | null
          asaas_payment_id: string
          asaas_subscription_id?: string | null
          billing_type?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_url?: string | null
          net_value?: number | null
          organization_id: string
          payment_date?: string | null
          raw_event?: Json | null
          status?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          asaas_customer_id?: string | null
          asaas_payment_id?: string
          asaas_subscription_id?: string | null
          billing_type?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_url?: string | null
          net_value?: number | null
          organization_id?: string
          payment_date?: string | null
          raw_event?: Json | null
          status?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "asaas_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments_log: {
        Row: {
          assigned_at: string | null
          assigned_user_id: string | null
          created_at: string
          id: string
          lead_id: string
          organization_id: string | null
          reason: string | null
          round_robin_id: string | null
          user_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_user_id?: string | null
          created_at?: string
          id?: string
          lead_id: string
          organization_id?: string | null
          reason?: string | null
          round_robin_id?: string | null
          user_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_user_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string
          organization_id?: string | null
          reason?: string | null
          round_robin_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_log_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_log_round_robin_id_fkey"
            columns: ["round_robin_id"]
            isOneToOne: false
            referencedRelation: "round_robins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          organization_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_connections: {
        Row: {
          automation_id: string | null
          condition_branch: string | null
          created_at: string | null
          id: string
          source_handle: string | null
          source_node_id: string | null
          target_node_id: string | null
        }
        Insert: {
          automation_id?: string | null
          condition_branch?: string | null
          created_at?: string | null
          id?: string
          source_handle?: string | null
          source_node_id?: string | null
          target_node_id?: string | null
        }
        Update: {
          automation_id?: string | null
          condition_branch?: string | null
          created_at?: string | null
          id?: string
          source_handle?: string | null
          source_node_id?: string | null
          target_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_connections_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_connections_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "automation_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_connections_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "automation_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_edges: {
        Row: {
          automation_id: string | null
          condition_config: Json | null
          created_at: string | null
          id: string
          source_node_id: string | null
          target_node_id: string | null
        }
        Insert: {
          automation_id?: string | null
          condition_config?: Json | null
          created_at?: string | null
          id?: string
          source_node_id?: string | null
          target_node_id?: string | null
        }
        Update: {
          automation_id?: string | null
          condition_config?: Json | null
          created_at?: string | null
          id?: string
          source_node_id?: string | null
          target_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_edges_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_edges_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "automation_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_edges_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "automation_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_executions: {
        Row: {
          automation_id: string | null
          completed_at: string | null
          conversation_id: string | null
          current_node_id: string | null
          error_message: string | null
          execution_data: Json | null
          id: string
          lead_id: string | null
          lock_token: string | null
          locked_at: string | null
          next_execution_at: string | null
          organization_id: string
          started_at: string | null
          status: string | null
        }
        Insert: {
          automation_id?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          current_node_id?: string | null
          error_message?: string | null
          execution_data?: Json | null
          id?: string
          lead_id?: string | null
          lock_token?: string | null
          locked_at?: string | null
          next_execution_at?: string | null
          organization_id: string
          started_at?: string | null
          status?: string | null
        }
        Update: {
          automation_id?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          current_node_id?: string | null
          error_message?: string | null
          execution_data?: Json | null
          id?: string
          lead_id?: string | null
          lock_token?: string | null
          locked_at?: string | null
          next_execution_at?: string | null
          organization_id?: string
          started_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_executions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_current_node_id_fkey"
            columns: ["current_node_id"]
            isOneToOne: false
            referencedRelation: "automation_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_message_dispatches: {
        Row: {
          attempt_key: string
          created_at: string | null
          execution_id: string
          id: string
          node_id: string
          organization_id: string
        }
        Insert: {
          attempt_key: string
          created_at?: string | null
          execution_id: string
          id?: string
          node_id: string
          organization_id: string
        }
        Update: {
          attempt_key?: string
          created_at?: string | null
          execution_id?: string
          id?: string
          node_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_message_dispatches_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "automation_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_nodes: {
        Row: {
          action_type: string | null
          automation_id: string | null
          created_at: string | null
          id: string
          node_config: Json | null
          node_type: string
          position_x: number | null
          position_y: number | null
        }
        Insert: {
          action_type?: string | null
          automation_id?: string | null
          created_at?: string | null
          id?: string
          node_config?: Json | null
          node_type: string
          position_x?: number | null
          position_y?: number | null
        }
        Update: {
          action_type?: string | null
          automation_id?: string | null
          created_at?: string | null
          id?: string
          node_config?: Json | null
          node_type?: string
          position_x?: number | null
          position_y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_nodes_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_templates: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          id: string
          media_type: string | null
          media_url: string | null
          name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          flow_definition: Json | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          trigger_config: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          flow_definition?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id?: string | null
          trigger_config?: Json | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          flow_definition?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          trigger_config?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      available_permissions: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      broker_monthly_goals: {
        Row: {
          created_at: string | null
          goal_amount: number
          id: string
          month: number
          organization_id: string
          updated_at: string | null
          user_id: string
          year: number
        }
        Insert: {
          created_at?: string | null
          goal_amount?: number
          id?: string
          month: number
          organization_id: string
          updated_at?: string | null
          user_id: string
          year: number
        }
        Update: {
          created_at?: string | null
          goal_amount?: number
          id?: string
          month?: number
          organization_id?: string
          updated_at?: string | null
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      cadence_tasks_template: {
        Row: {
          cadence_template_id: string
          id: string
          organization_id: string
          title: string
          type: string
          delay_days: number
          position: number
          message_template: string | null
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          cadence_template_id: string
          id?: string
          organization_id: string
          title: string
          type?: string
          delay_days?: number
          position?: number
          message_template?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          cadence_template_id?: string
          id?: string
          organization_id?: string
          title?: string
          type?: string
          delay_days?: number
          position?: number
          message_template?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_tasks_template_cadence_template_id_fkey"
            columns: ["cadence_template_id"]
            isOneToOne: false
            referencedRelation: "cadence_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cadence_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          pipeline_id: string | null
          stage_id: string | null
          stage_key: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          pipeline_id?: string | null
          stage_id?: string | null
          stage_key?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          pipeline_id?: string | null
          stage_id?: string | null
          stage_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          commission_id: string
          id: string
          new_status: string
          notes: string | null
          old_status: string | null
          organization_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          commission_id: string
          id?: string
          new_status: string
          notes?: string | null
          old_status?: string | null
          organization_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          commission_id?: string
          id?: string
          new_status?: string
          notes?: string | null
          old_status?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_history_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commissions"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_rules: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          percentage: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          percentage?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          percentage?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          base_value: number | null
          calculated_value: number | null
          contract_id: string | null
          created_at: string | null
          forecast_date: string | null
          id: string
          lead_id: string | null
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_by: string | null
          payment_proof: string | null
          percentage: number | null
          property_id: string | null
          rule_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          base_value?: number | null
          calculated_value?: number | null
          contract_id?: string | null
          created_at?: string | null
          forecast_date?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          paid_by?: string | null
          payment_proof?: string | null
          percentage?: number | null
          property_id?: string | null
          rule_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          base_value?: number | null
          calculated_value?: number | null
          contract_id?: string | null
          created_at?: string | null
          forecast_date?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_proof?: string | null
          percentage?: number | null
          property_id?: string | null
          rule_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "commission_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_daily_reports: {
        Row: {
          accidents_notes: string | null
          created_at: string | null
          equipment_status: string | null
          id: string
          labor_count: number | null
          organization_id: string
          photos: Json | null
          project_id: string
          report_date: string
          temperature: string | null
          updated_at: string | null
          user_id: string
          weather_condition: string | null
          work_status: string
          work_summary: string | null
        }
        Insert: {
          accidents_notes?: string | null
          created_at?: string | null
          equipment_status?: string | null
          id?: string
          labor_count?: number | null
          organization_id: string
          photos?: Json | null
          project_id: string
          report_date?: string
          temperature?: string | null
          updated_at?: string | null
          user_id: string
          weather_condition?: string | null
          work_status?: string
          work_summary?: string | null
        }
        Update: {
          accidents_notes?: string | null
          created_at?: string | null
          equipment_status?: string | null
          id?: string
          labor_count?: number | null
          organization_id?: string
          photos?: Json | null
          project_id?: string
          report_date?: string
          temperature?: string | null
          updated_at?: string | null
          user_id?: string
          weather_condition?: string | null
          work_status?: string
          work_summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_daily_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_daily_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_documents: {
        Row: {
          created_at: string | null
          expiry_date: string | null
          file_url: string
          id: string
          issue_date: string | null
          name: string
          notes: string | null
          organization_id: string
          project_id: string
          sla_days: number | null
          status: string
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expiry_date?: string | null
          file_url: string
          id?: string
          issue_date?: string | null
          name: string
          notes?: string | null
          organization_id: string
          project_id: string
          sla_days?: number | null
          status?: string
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expiry_date?: string | null
          file_url?: string
          id?: string
          issue_date?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          project_id?: string
          sla_days?: number | null
          status?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_milestones: {
        Row: {
          completed_at: string | null
          created_at: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          order_index: number
          organization_id: string
          project_id: string
          start_date: string | null
          status: string
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          order_index?: number
          organization_id: string
          project_id: string
          start_date?: string | null
          status?: string
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          order_index?: number
          organization_id?: string
          project_id?: string
          start_date?: string | null
          status?: string
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_milestones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_projects: {
        Row: {
          budget_actual: number | null
          budget_estimated: number | null
          city_hall_approval_date: string | null
          created_at: string | null
          created_by: string | null
          delivery_date_actual: string | null
          description: string | null
          end_date_actual: string | null
          end_date_planned: string | null
          financial_progress_percent: number | null
          id: string
          name: string
          organization_id: string
          physical_progress_percent: number | null
          project_type: string | null
          property_id: string | null
          start_date_actual: string | null
          start_date_planned: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          budget_actual?: number | null
          budget_estimated?: number | null
          city_hall_approval_date?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_date_actual?: string | null
          description?: string | null
          end_date_actual?: string | null
          end_date_planned?: string | null
          financial_progress_percent?: number | null
          id?: string
          name: string
          organization_id: string
          physical_progress_percent?: number | null
          project_type?: string | null
          property_id?: string | null
          start_date_actual?: string | null
          start_date_planned?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          budget_actual?: number | null
          budget_estimated?: number | null
          city_hall_approval_date?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_date_actual?: string | null
          description?: string | null
          end_date_actual?: string | null
          end_date_planned?: string | null
          financial_progress_percent?: number | null
          id?: string
          name?: string
          organization_id?: string
          physical_progress_percent?: number | null
          project_type?: string | null
          property_id?: string | null
          start_date_actual?: string | null
          start_date_planned?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_projects_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_purchase_order_items: {
        Row: {
          created_at: string | null
          description: string
          id: string
          purchase_order_id: string
          quantity: number
          total_price: number
          unit: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          purchase_order_id: string
          quantity?: number
          total_price?: number
          unit?: string | null
          unit_price?: number
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          purchase_order_id?: string
          quantity?: number
          total_price?: number
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "construction_purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_purchase_orders: {
        Row: {
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          delivery_date_actual: string | null
          delivery_date_planned: string | null
          description: string | null
          discount_amount: number | null
          estimated_cost: number | null
          id: string
          net_amount: number
          organization_id: string
          payment_terms: string | null
          project_id: string
          saving_amount: number | null
          status: string
          supplier_id: string | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_date_actual?: string | null
          delivery_date_planned?: string | null
          description?: string | null
          discount_amount?: number | null
          estimated_cost?: number | null
          id?: string
          net_amount?: number
          organization_id: string
          payment_terms?: string | null
          project_id: string
          saving_amount?: number | null
          status?: string
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_date_actual?: string | null
          delivery_date_planned?: string | null
          description?: string | null
          discount_amount?: number | null
          estimated_cost?: number | null
          id?: string
          net_amount?: number
          organization_id?: string
          payment_terms?: string | null
          project_id?: string
          saving_amount?: number | null
          status?: string
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "construction_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_suppliers: {
        Row: {
          address: string | null
          category: string | null
          created_at: string | null
          document_number: string | null
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          rating: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          created_at?: string | null
          document_number?: string | null
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          rating?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          created_at?: string | null
          document_number?: string | null
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          rating?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_team_members: {
        Row: {
          created_at: string | null
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "construction_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_teams: {
        Row: {
          created_at: string | null
          id: string
          leader_id: string | null
          name: string
          organization_id: string
          specialty: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          leader_id?: string | null
          name: string
          organization_id: string
          specialty?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          leader_id?: string | null
          name?: string
          organization_id?: string
          specialty?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_brokers: {
        Row: {
          commission_percentage: number | null
          contract_id: string
          created_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          commission_percentage?: number | null
          contract_id: string
          created_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          commission_percentage?: number | null
          contract_id?: string
          created_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_brokers_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_brokers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_sequences: {
        Row: {
          id: string
          last_number: number | null
          organization_id: string
        }
        Insert: {
          id?: string
          last_number?: number | null
          organization_id: string
        }
        Update: {
          id?: string
          last_number?: number | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          attachments: Json | null
          client_document: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          closing_date: string | null
          commission_percentage: number | null
          commission_value: number | null
          contract_number: string | null
          contract_type: string | null
          created_at: string | null
          created_by: string | null
          down_payment: number | null
          end_date: string | null
          id: string
          installments: number | null
          lead_id: string | null
          notes: string | null
          organization_id: string
          payment_conditions: string | null
          property_id: string | null
          signing_date: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          attachments?: Json | null
          client_document?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          closing_date?: string | null
          commission_percentage?: number | null
          commission_value?: number | null
          contract_number?: string | null
          contract_type?: string | null
          created_at?: string | null
          created_by?: string | null
          down_payment?: number | null
          end_date?: string | null
          id?: string
          installments?: number | null
          lead_id?: string | null
          notes?: string | null
          organization_id: string
          payment_conditions?: string | null
          property_id?: string | null
          signing_date?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          attachments?: Json | null
          client_document?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          closing_date?: string | null
          commission_percentage?: number | null
          commission_value?: number | null
          contract_number?: string | null
          contract_type?: string | null
          created_at?: string | null
          created_by?: string | null
          down_payment?: number | null
          end_date?: string | null
          id?: string
          installments?: number | null
          lead_id?: string | null
          notes?: string | null
          organization_id?: string
          payment_conditions?: string | null
          property_id?: string | null
          signing_date?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_areas: {
        Row: {
          city: string
          created_at: string | null
          id: string
          is_active: boolean | null
          neighborhood: string
          organization_id: string
          uf: string
          updated_at: string | null
          zone: string | null
        }
        Insert: {
          city: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          neighborhood: string
          organization_id: string
          uf: string
          updated_at?: string | null
          zone?: string | null
        }
        Update: {
          city?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          neighborhood?: string
          organization_id?: string
          uf?: string
          updated_at?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coverage_areas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          error_message: string | null
          id: string
          organization_id: string | null
          recipient_email: string
          sent_at: string | null
          status: string
          subject: string | null
          template_id: string | null
          template_key: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          organization_id?: string | null
          recipient_email: string
          sent_at?: string | null
          status: string
          subject?: string | null
          template_id?: string | null
          template_key?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          organization_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          template_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          created_at: string | null
          html: string
          id: string
          is_active: boolean | null
          key: string
          name: string
          organization_id: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          html: string
          id?: string
          is_active?: boolean | null
          key: string
          name: string
          organization_id?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          html?: string
          id?: string
          is_active?: boolean | null
          key?: string
          name?: string
          organization_id?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_requests: {
        Row: {
          admin_response: string | null
          category: string
          created_at: string
          description: string
          id: string
          organization_id: string
          responded_at: string | null
          responded_by: string | null
          status: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_response?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          organization_id: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_response?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_requests_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_categories: {
        Row: {
          category_group: string | null
          color: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          type: string
        }
        Insert: {
          category_group?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          type?: string
        }
        Update: {
          category_group?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_entries: {
        Row: {
          amount: number
          broker_id: string | null
          category: string | null
          category_group: string | null
          contract_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          installment_number: number | null
          is_recurring: boolean | null
          lead_id: string | null
          notes: string | null
          organization_id: string
          paid_amount: number | null
          paid_date: string | null
          paid_value: number | null
          parent_entry_id: string | null
          payment_method: string | null
          recurring_type: string | null
          status: string | null
          total_installments: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          broker_id?: string | null
          category?: string | null
          category_group?: string | null
          contract_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          installment_number?: number | null
          is_recurring?: boolean | null
          lead_id?: string | null
          notes?: string | null
          organization_id: string
          paid_amount?: number | null
          paid_date?: string | null
          paid_value?: number | null
          parent_entry_id?: string | null
          payment_method?: string | null
          recurring_type?: string | null
          status?: string | null
          total_installments?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          broker_id?: string | null
          category?: string | null
          category_group?: string | null
          contract_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          installment_number?: number | null
          is_recurring?: boolean | null
          lead_id?: string | null
          notes?: string | null
          organization_id?: string
          paid_amount?: number | null
          paid_date?: string | null
          paid_value?: number | null
          parent_entry_id?: string | null
          payment_method?: string | null
          recurring_type?: string | null
          status?: string | null
          total_installments?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_parent_entry_id_fkey"
            columns: ["parent_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_activity_logs: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          idempotency_key: string | null
          metadata: Json | null
          organization_id: string | null
          points_earned: number
          quantity: number
          reference_id: string | null
          season_id: string | null
          user_id: string | null
          xp_awarded: number
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          organization_id?: string | null
          points_earned: number
          quantity?: number
          reference_id?: string | null
          season_id?: string | null
          user_id?: string | null
          xp_awarded?: number
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          organization_id?: string | null
          points_earned?: number
          quantity?: number
          reference_id?: string | null
          season_id?: string | null
          user_id?: string | null
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "gamification_activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          organization_id: string
          points_earned: number | null
          source_id: string | null
          source_module: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
          points_earned?: number | null
          source_id?: string | null
          source_module?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          points_earned?: number | null
          source_id?: string | null
          source_module?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gamification_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_missions: {
        Row: {
          action_type: string
          bonus_points: number
          created_at: string | null
          current_progress: number | null
          description: string | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          period: string | null
          target_count: number
          target_scope: string | null
          target_user_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          action_type: string
          bonus_points: number
          created_at?: string | null
          current_progress?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          period?: string | null
          target_count: number
          target_scope?: string | null
          target_user_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          action_type?: string
          bonus_points?: number
          created_at?: string | null
          current_progress?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          period?: string | null
          target_count?: number
          target_scope?: string | null
          target_user_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gamification_missions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gamification_missions_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_participants: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          participates: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          participates?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          participates?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gamification_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_rankings: {
        Row: {
          created_at: string | null
          event_types: string[] | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          event_types?: string[] | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          slug: string
        }
        Update: {
          created_at?: string | null
          event_types?: string[] | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_rankings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_rules: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          points: number
          updated_at: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          points?: number
          updated_at?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          points?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gamification_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_seasons: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string
          ended_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          reset_reason: string | null
          start_date: string
          started_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          ended_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          reset_reason?: string | null
          start_date: string
          started_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          ended_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          reset_reason?: string | null
          start_date?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gamification_seasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_streaks: {
        Row: {
          created_at: string | null
          current_streak: number | null
          highest_streak: number | null
          id: string
          last_activity_at: string | null
          organization_id: string
          streak_type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_streak?: number | null
          highest_streak?: number | null
          id?: string
          last_activity_at?: string | null
          organization_id: string
          streak_type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_streak?: number | null
          highest_streak?: number | null
          id?: string
          last_activity_at?: string | null
          organization_id?: string
          streak_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_streaks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gamification_streaks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string | null
          created_at: string | null
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      help_articles: {
        Row: {
          category: string
          content: string
          created_at: string | null
          display_order: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          title: string
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          category: string
          content: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          title: string
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          title?: string
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      imoview_integrations: {
        Row: {
          api_key: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          organization_id: string
          sync_log: Json | null
          total_synced: number | null
          updated_at: string | null
        }
        Insert: {
          api_key: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_id: string
          sync_log?: Json | null
          total_synced?: number | null
          updated_at?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_id?: string
          sync_log?: Json | null
          total_synced?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imoview_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string | null
          expires_at: string
          id: string
          organization_id: string
          role: string | null
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          organization_id: string
          role?: string | null
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          role?: string | null
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignment_history: {
        Row: {
          assigned_by: string | null
          assigned_from: string | null
          assigned_to: string | null
          created_at: string | null
          id: string
          lead_id: string
          reason: string | null
        }
        Insert: {
          assigned_by?: string | null
          assigned_from?: string | null
          assigned_to?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          reason?: string | null
        }
        Update: {
          assigned_by?: string | null
          assigned_from?: string | null
          assigned_to?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignment_history_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignment_history_assigned_from_fkey"
            columns: ["assigned_from"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignment_history_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignment_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_attachments: {
        Row: {
          created_at: string | null
          created_by: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          lead_id: string
          message_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          lead_id: string
          message_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          lead_id?: string
          message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_attachments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_entry_events: {
        Row: {
          campaign_name: string | null
          created_at: string
          entry_type: string
          id: string
          lead_id: string
          metadata: Json
          organization_id: string
          pipeline_id: string | null
          property_id: string | null
          source: string | null
          stage_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          valor_interesse: number | null
        }
        Insert: {
          campaign_name?: string | null
          created_at?: string
          entry_type: string
          id?: string
          lead_id: string
          metadata?: Json
          organization_id: string
          pipeline_id?: string | null
          property_id?: string | null
          source?: string | null
          stage_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          valor_interesse?: number | null
        }
        Update: {
          campaign_name?: string | null
          created_at?: string
          entry_type?: string
          id?: string
          lead_id?: string
          metadata?: Json
          organization_id?: string
          pipeline_id?: string | null
          property_id?: string | null
          source?: string | null
          stage_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          valor_interesse?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_entry_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_entry_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_entry_events_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_entry_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_entry_events_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          browser: string | null
          created_at: string | null
          device_type: string | null
          event_type: string
          id: string
          metadata: Json | null
          organization_id: string | null
          page_path: string
          page_title: string | null
          property_id: string | null
          referrer: string | null
          screen_height: number | null
          screen_width: number | null
          session_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          browser?: string | null
          created_at?: string | null
          device_type?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          page_path: string
          page_title?: string | null
          property_id?: string | null
          referrer?: string | null
          screen_height?: number | null
          screen_width?: number | null
          session_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          browser?: string | null
          created_at?: string | null
          device_type?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          page_path?: string
          page_title?: string | null
          property_id?: string | null
          referrer?: string | null
          screen_height?: number | null
          screen_width?: number | null
          session_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_meta: {
        Row: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          contact_notes: string | null
          created_at: string
          creative_instagram_url: string | null
          creative_url: string | null
          creative_video_url: string | null
          form_id: string | null
          form_name: string | null
          id: string
          lead_id: string
          page_id: string | null
          platform: string | null
          raw_payload: Json | null
          source_type: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          contact_notes?: string | null
          created_at?: string
          creative_instagram_url?: string | null
          creative_url?: string | null
          creative_video_url?: string | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          lead_id: string
          page_id?: string | null
          platform?: string | null
          raw_payload?: Json | null
          source_type?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          contact_notes?: string | null
          created_at?: string
          creative_instagram_url?: string | null
          creative_url?: string | null
          creative_video_url?: string | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          lead_id?: string
          page_id?: string | null
          platform?: string | null
          raw_payload?: Json | null
          source_type?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_meta_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_pool_history: {
        Row: {
          from_user_id: string | null
          id: string
          lead_id: string | null
          organization_id: string | null
          reason: string | null
          redistributed_at: string | null
          to_user_id: string | null
        }
        Insert: {
          from_user_id?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string | null
          reason?: string | null
          redistributed_at?: string | null
          to_user_id?: string | null
        }
        Update: {
          from_user_id?: string | null
          id?: string
          lead_id?: string | null
          organization_id?: string | null
          reason?: string | null
          redistributed_at?: string | null
          to_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_pool_history_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_pool_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_pool_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_pool_history_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_property_interests: {
        Row: {
          created_at: string | null
          id: string
          interest_level: string | null
          lead_id: string
          notes: string | null
          property_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          interest_level?: string | null
          lead_id: string
          notes?: string | null
          property_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          interest_level?: string | null
          lead_id?: string
          notes?: string | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_property_interests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_property_interests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_stage_history: {
        Row: {
          duration_seconds: number | null
          entered_at: string | null
          exited_at: string | null
          id: string
          lead_id: string
          stage_id: string | null
          user_id: string | null
        }
        Insert: {
          duration_seconds?: number | null
          entered_at?: string | null
          exited_at?: string | null
          id?: string
          lead_id: string
          stage_id?: string | null
          user_id?: string | null
        }
        Update: {
          duration_seconds?: number | null
          entered_at?: string | null
          exited_at?: string | null
          id?: string
          lead_id?: string
          stage_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_stage_history_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_stage_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          id: string
          lead_id: string
          tag_id: string
        }
        Insert: {
          id?: string
          lead_id: string
          tag_id: string
        }
        Update: {
          id?: string
          lead_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tasks: {
        Row: {
          created_at: string
          day_offset: number
          description: string | null
          done_at: string | null
          done_by: string | null
          due_date: string | null
          id: string
          is_done: boolean | null
          lead_id: string
          outcome: string | null
          outcome_notes: string | null
          title: string
          type: string | null
        }
        Insert: {
          created_at?: string
          day_offset?: number
          description?: string | null
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          id?: string
          is_done?: boolean | null
          lead_id: string
          outcome?: string | null
          outcome_notes?: string | null
          title: string
          type?: string | null
        }
        Update: {
          created_at?: string
          day_offset?: number
          description?: string | null
          done_at?: string | null
          done_by?: string | null
          due_date?: string | null
          id?: string
          is_done?: boolean | null
          lead_id?: string
          outcome?: string | null
          outcome_notes?: string | null
          title?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_tasks_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_timeline_events: {
        Row: {
          created_at: string | null
          description: string | null
          event_type: string
          id: string
          lead_id: string
          metadata: Json | null
          organization_id: string
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_type: string
          id?: string
          lead_id: string
          metadata?: Json | null
          organization_id: string
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_type?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          organization_id?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_timeline_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_timeline_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_timeline_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_at: string | null
          assigned_user_id: string | null
          bairro: string | null
          cargo: string | null
          cep: string | null
          cidade: string | null
          commission_percentage: number | null
          complemento: string | null
          created_at: string
          deal_status: string | null
          email: string | null
          empresa: string | null
          endereco: string | null
          faixa_valor_imovel: string | null
          feedback: string | null
          finalidade_compra: string | null
          first_response_actor_user_id: string | null
          first_response_at: string | null
          first_response_channel: string | null
          first_response_is_automation: boolean | null
          first_response_seconds: number | null
          first_touch_actor_user_id: string | null
          first_touch_at: string | null
          first_touch_channel: string | null
          first_touch_seconds: number | null
          id: string
          initial_message: string | null
          interest_plan_id: string | null
          interest_property_id: string | null
          is_own_resource: boolean | null
          last_entry_at: string | null
          lost_at: string | null
          lost_reason: string | null
          message: string | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_click_id: string | null
          meta_form_id: string | null
          meta_lead_id: string | null
          name: string
          numero: string | null
          organization_id: string
          phone: string | null
          pipeline_id: string | null
          procura_financiamento: boolean | null
          profissao: string | null
          property_code: string | null
          property_id: string | null
          redistribution_count: number | null
          reentry_count: number
          renda_familiar: string | null
          source: string | null
          source_session_id: string | null
          source_webhook_id: string | null
          stage_entered_at: string | null
          stage_id: string | null
          trabalha: boolean | null
          uf: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          valor_interesse: number | null
          visitor_session_id: string | null
          whatsapp_avatar_synced_at: string | null
          whatsapp_avatar_url: string | null
          whatsapp_verified: boolean | null
          won_at: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_user_id?: string | null
          bairro?: string | null
          cargo?: string | null
          cep?: string | null
          cidade?: string | null
          commission_percentage?: number | null
          complemento?: string | null
          created_at?: string
          deal_status?: string | null
          email?: string | null
          empresa?: string | null
          endereco?: string | null
          faixa_valor_imovel?: string | null
          feedback?: string | null
          finalidade_compra?: string | null
          first_response_actor_user_id?: string | null
          first_response_at?: string | null
          first_response_channel?: string | null
          first_response_is_automation?: boolean | null
          first_response_seconds?: number | null
          first_touch_actor_user_id?: string | null
          first_touch_at?: string | null
          first_touch_channel?: string | null
          first_touch_seconds?: number | null
          id?: string
          initial_message?: string | null
          interest_plan_id?: string | null
          interest_property_id?: string | null
          is_own_resource?: boolean | null
          last_entry_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          message?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_click_id?: string | null
          meta_form_id?: string | null
          meta_lead_id?: string | null
          name: string
          numero?: string | null
          organization_id: string
          phone?: string | null
          pipeline_id?: string | null
          procura_financiamento?: boolean | null
          profissao?: string | null
          property_code?: string | null
          property_id?: string | null
          redistribution_count?: number | null
          reentry_count?: number
          renda_familiar?: string | null
          source?: string | null
          source_session_id?: string | null
          source_webhook_id?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          trabalha?: boolean | null
          uf?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          valor_interesse?: number | null
          visitor_session_id?: string | null
          whatsapp_avatar_synced_at?: string | null
          whatsapp_avatar_url?: string | null
          whatsapp_verified?: boolean | null
          won_at?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_user_id?: string | null
          bairro?: string | null
          cargo?: string | null
          cep?: string | null
          cidade?: string | null
          commission_percentage?: number | null
          complemento?: string | null
          created_at?: string
          deal_status?: string | null
          email?: string | null
          empresa?: string | null
          endereco?: string | null
          faixa_valor_imovel?: string | null
          feedback?: string | null
          finalidade_compra?: string | null
          first_response_actor_user_id?: string | null
          first_response_at?: string | null
          first_response_channel?: string | null
          first_response_is_automation?: boolean | null
          first_response_seconds?: number | null
          first_touch_actor_user_id?: string | null
          first_touch_at?: string | null
          first_touch_channel?: string | null
          first_touch_seconds?: number | null
          id?: string
          initial_message?: string | null
          interest_plan_id?: string | null
          interest_property_id?: string | null
          is_own_resource?: boolean | null
          last_entry_at?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          message?: string | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_click_id?: string | null
          meta_form_id?: string | null
          meta_lead_id?: string | null
          name?: string
          numero?: string | null
          organization_id?: string
          phone?: string | null
          pipeline_id?: string | null
          procura_financiamento?: boolean | null
          profissao?: string | null
          property_code?: string | null
          property_id?: string | null
          redistribution_count?: number | null
          reentry_count?: number
          renda_familiar?: string | null
          source?: string | null
          source_session_id?: string | null
          source_webhook_id?: string | null
          stage_entered_at?: string | null
          stage_id?: string | null
          trabalha?: boolean | null
          uf?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          valor_interesse?: number | null
          visitor_session_id?: string | null
          whatsapp_avatar_synced_at?: string | null
          whatsapp_avatar_url?: string | null
          whatsapp_verified?: boolean | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_first_response_actor_user_id_fkey"
            columns: ["first_response_actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_first_touch_actor_user_id_fkey"
            columns: ["first_touch_actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_interest_plan_id_fkey"
            columns: ["interest_plan_id"]
            isOneToOne: false
            referencedRelation: "service_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_interest_property_id_fkey"
            columns: ["interest_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_source_session_id_fkey"
            columns: ["source_session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_source_webhook_id_fkey"
            columns: ["source_webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      media_jobs: {
        Row: {
          attempts: number | null
          conversation_id: string
          created_at: string | null
          error_message: string | null
          id: string
          max_attempts: number | null
          media_mime_type: string | null
          media_type: string
          message_id: string
          message_key: Json | null
          next_retry_at: string | null
          organization_id: string
          session_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          conversation_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          max_attempts?: number | null
          media_mime_type?: string | null
          media_type: string
          message_id: string
          message_key?: Json | null
          next_retry_at?: string | null
          organization_id: string
          session_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          conversation_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          max_attempts?: number | null
          media_mime_type?: string | null
          media_type?: string
          message_id?: string
          message_key?: Json | null
          next_retry_at?: string | null
          organization_id?: string
          session_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_jobs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      member_availability: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string | null
          id: string
          is_active: boolean | null
          is_all_day: boolean | null
          start_time: string | null
          team_member_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time?: string | null
          id?: string
          is_active?: boolean | null
          is_all_day?: boolean | null
          start_time?: string | null
          team_member_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string | null
          id?: string
          is_active?: boolean | null
          is_all_day?: boolean | null
          start_time?: string | null
          team_member_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_availability_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_campaign_insights: {
        Row: {
          ad_id: string | null
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          budget: number | null
          budget_type: string | null
          campaign_id: string | null
          campaign_name: string | null
          conversations_count: number | null
          cpl: number | null
          created_at: string | null
          creative_permalink_url: string | null
          creative_url: string | null
          creative_video_url: string | null
          ctr: number | null
          date_start: string | null
          date_stop: string | null
          fetched_at: string | null
          hook_rate: number | null
          id: string
          impressions: number | null
          leads_count: number | null
          link_clicks: number | null
          level: string
          objective: string | null
          organization_id: string
          reach: number | null
          spend: number | null
          status: string | null
        }
        Insert: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          budget?: number | null
          budget_type?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          conversations_count?: number | null
          cpl?: number | null
          created_at?: string | null
          creative_permalink_url?: string | null
          creative_url?: string | null
          creative_video_url?: string | null
          ctr?: number | null
          date_start?: string | null
          date_stop?: string | null
          fetched_at?: string | null
          hook_rate?: number | null
          id?: string
          impressions?: number | null
          leads_count?: number | null
          link_clicks?: number | null
          level?: string
          objective?: string | null
          organization_id: string
          reach?: number | null
          spend?: number | null
          status?: string | null
        }
        Update: {
          ad_id?: string | null
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          budget?: number | null
          budget_type?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          conversations_count?: number | null
          cpl?: number | null
          created_at?: string | null
          creative_permalink_url?: string | null
          creative_url?: string | null
          creative_video_url?: string | null
          ctr?: number | null
          date_start?: string | null
          date_stop?: string | null
          fetched_at?: string | null
          hook_rate?: number | null
          id?: string
          impressions?: number | null
          leads_count?: number | null
          link_clicks?: number | null
          level?: string
          objective?: string | null
          organization_id?: string
          reach?: number | null
          spend?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_campaign_insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_conversations: {
        Row: {
          contact_name: string | null
          contact_picture: string | null
          created_at: string | null
          external_id: string
          id: string
          is_archived: boolean | null
          last_message: string | null
          last_message_at: string | null
          lead_id: string | null
          organization_id: string | null
          page_id: string | null
          platform: string
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          contact_name?: string | null
          contact_picture?: string | null
          created_at?: string | null
          external_id: string
          id?: string
          is_archived?: boolean | null
          last_message?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          organization_id?: string | null
          page_id?: string | null
          platform: string
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          contact_name?: string | null
          contact_picture?: string | null
          created_at?: string | null
          external_id?: string
          id?: string
          is_archived?: boolean | null
          last_message?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          organization_id?: string | null
          page_id?: string | null
          platform?: string
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_form_configs: {
        Row: {
          assigned_user_id: string | null
          auto_tags: Json | null
          created_at: string
          custom_fields_config: Json | null
          default_status: string | null
          field_mapping: Json | null
          form_id: string
          form_name: string | null
          id: string
          integration_id: string
          is_active: boolean | null
          last_lead_at: string | null
          leads_received: number | null
          organization_id: string
          pipeline_id: string | null
          property_id: string | null
          stage_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_user_id?: string | null
          auto_tags?: Json | null
          created_at?: string
          custom_fields_config?: Json | null
          default_status?: string | null
          field_mapping?: Json | null
          form_id: string
          form_name?: string | null
          id?: string
          integration_id: string
          is_active?: boolean | null
          last_lead_at?: string | null
          leads_received?: number | null
          organization_id: string
          pipeline_id?: string | null
          property_id?: string | null
          stage_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_user_id?: string | null
          auto_tags?: Json | null
          created_at?: string
          custom_fields_config?: Json | null
          default_status?: string | null
          field_mapping?: Json | null
          form_id?: string
          form_name?: string | null
          id?: string
          integration_id?: string
          is_active?: boolean | null
          last_lead_at?: string | null
          leads_received?: number | null
          organization_id?: string
          pipeline_id?: string | null
          property_id?: string | null
          stage_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_form_configs_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_form_configs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "meta_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_form_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_form_configs_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_form_configs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_form_configs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_integrations: {
        Row: {
          access_token: string | null
          ad_account_id: string | null
          assigned_user_id: string | null
          campaign_property_mapping: Json | null
          created_at: string
          default_status: string | null
          field_mapping: Json | null
          form_ids: Json | null
          health_status: string | null
          id: string
          is_connected: boolean | null
          last_error: string | null
          last_lead_at: string | null
          last_sync_at: string | null
          last_validated_at: string | null
          leads_received: number | null
          organization_id: string
          page_id: string | null
          page_name: string | null
          pipeline_id: string | null
          stage_id: string | null
          token_expires_at: string | null
          token_status: string | null
          updated_at: string
          webhook_subscribed_at: string | null
        }
        Insert: {
          access_token?: string | null
          ad_account_id?: string | null
          assigned_user_id?: string | null
          campaign_property_mapping?: Json | null
          created_at?: string
          default_status?: string | null
          field_mapping?: Json | null
          form_ids?: Json | null
          health_status?: string | null
          id?: string
          is_connected?: boolean | null
          last_error?: string | null
          last_lead_at?: string | null
          last_sync_at?: string | null
          last_validated_at?: string | null
          leads_received?: number | null
          organization_id: string
          page_id?: string | null
          page_name?: string | null
          pipeline_id?: string | null
          stage_id?: string | null
          token_expires_at?: string | null
          token_status?: string | null
          updated_at?: string
          webhook_subscribed_at?: string | null
        }
        Update: {
          access_token?: string | null
          ad_account_id?: string | null
          assigned_user_id?: string | null
          campaign_property_mapping?: Json | null
          created_at?: string
          default_status?: string | null
          field_mapping?: Json | null
          form_ids?: Json | null
          health_status?: string | null
          id?: string
          is_connected?: boolean | null
          last_error?: string | null
          last_lead_at?: string | null
          last_sync_at?: string | null
          last_validated_at?: string | null
          leads_received?: number | null
          organization_id?: string
          page_id?: string | null
          page_name?: string | null
          pipeline_id?: string | null
          stage_id?: string | null
          token_expires_at?: string | null
          token_status?: string | null
          updated_at?: string
          webhook_subscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_integrations_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_integrations_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_integrations_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_messages: {
        Row: {
          content: string | null
          conversation_id: string | null
          created_at: string | null
          external_id: string | null
          from_me: boolean | null
          id: string
          media_mime_type: string | null
          media_url: string | null
          message_type: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          external_id?: string | null
          from_me?: boolean | null
          id?: string
          media_mime_type?: string | null
          media_url?: string | null
          message_type?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          external_id?: string | null
          from_me?: boolean | null
          id?: string
          media_mime_type?: string | null
          media_url?: string | null
          message_type?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "meta_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_webhook_events: {
        Row: {
          attempts: number | null
          error_message: string | null
          form_id: string | null
          id: string
          last_error: string | null
          leadgen_id: string | null
          next_retry_at: string | null
          object: string | null
          organization_id: string | null
          page_id: string | null
          processed_at: string | null
          raw_payload: Json
          received_at: string
          signature_valid: boolean | null
          status: string
        }
        Insert: {
          attempts?: number | null
          error_message?: string | null
          form_id?: string | null
          id?: string
          last_error?: string | null
          leadgen_id?: string | null
          next_retry_at?: string | null
          object?: string | null
          organization_id?: string | null
          page_id?: string | null
          processed_at?: string | null
          raw_payload: Json
          received_at?: string
          signature_valid?: boolean | null
          status?: string
        }
        Update: {
          attempts?: number | null
          error_message?: string | null
          form_id?: string | null
          id?: string
          last_error?: string | null
          leadgen_id?: string | null
          next_retry_at?: string | null
          object?: string | null
          organization_id?: string | null
          page_id?: string | null
          processed_at?: string | null
          raw_payload?: Json
          received_at?: string
          signature_valid?: boolean | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          channel: string
          created_at: string | null
          dedupe_key: string | null
          error: string | null
          id: string
          is_test: boolean | null
          organization_id: string | null
          payload: Json | null
          recipient: string | null
          response: Json | null
          status: string
          template_id: string | null
          user_id: string | null
        }
        Insert: {
          channel: string
          created_at?: string | null
          dedupe_key?: string | null
          error?: string | null
          id?: string
          is_test?: boolean | null
          organization_id?: string | null
          payload?: Json | null
          recipient?: string | null
          response?: Json | null
          status: string
          template_id?: string | null
          user_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          dedupe_key?: string | null
          error?: string | null
          id?: string
          is_test?: boolean | null
          organization_id?: string | null
          payload?: Json | null
          recipient?: string | null
          response?: Json | null
          status?: string
          template_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          admin_emails: string[] | null
          created_at: string | null
          enabled_channels: string[] | null
          from_email: string | null
          from_name: string | null
          id: string
          organization_id: string | null
          reply_to: string | null
          test_email: string | null
          test_phone: string | null
          updated_at: string | null
        }
        Insert: {
          admin_emails?: string[] | null
          created_at?: string | null
          enabled_channels?: string[] | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          organization_id?: string | null
          reply_to?: string | null
          test_email?: string | null
          test_phone?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_emails?: string[] | null
          created_at?: string | null
          enabled_channels?: string[] | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          organization_id?: string | null
          reply_to?: string | null
          test_email?: string | null
          test_phone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          category: string | null
          channel: string
          channels: string[] | null
          created_at: string | null
          dedupe_window_seconds: number | null
          editable_by_admin: boolean | null
          event_key: string | null
          html_body: string | null
          id: string
          is_active: boolean | null
          message: string
          name: string
          organization_id: string | null
          slug: string
          subject: string | null
          title: string | null
          updated_at: string | null
          variables: string[] | null
        }
        Insert: {
          category?: string | null
          channel: string
          channels?: string[] | null
          created_at?: string | null
          dedupe_window_seconds?: number | null
          editable_by_admin?: boolean | null
          event_key?: string | null
          html_body?: string | null
          id?: string
          is_active?: boolean | null
          message: string
          name: string
          organization_id?: string | null
          slug: string
          subject?: string | null
          title?: string | null
          updated_at?: string | null
          variables?: string[] | null
        }
        Update: {
          category?: string | null
          channel?: string
          channels?: string[] | null
          created_at?: string | null
          dedupe_window_seconds?: number | null
          editable_by_admin?: boolean | null
          event_key?: string | null
          html_body?: string | null
          id?: string
          is_active?: boolean | null
          message?: string
          name?: string
          organization_id?: string | null
          slug?: string
          subject?: string | null
          title?: string | null
          updated_at?: string | null
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          content: string | null
          created_at: string
          id: string
          is_read: boolean | null
          lead_id: string | null
          organization_id: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          lead_id?: string | null
          organization_id: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          lead_id?: string | null
          organization_id?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_requests: {
        Row: {
          about_text: string | null
          admin_notes: string | null
          banner_title: string | null
          banner_url: string | null
          billing_cycle: string | null
          cnpj: string | null
          company_address: string | null
          company_city: string | null
          company_complement: string | null
          company_email: string | null
          company_name: string
          company_neighborhood: string | null
          company_number: string | null
          company_phone: string | null
          company_whatsapp: string | null
          confirmed_value: number | null
          creci: string | null
          created_at: string | null
          custom_domain: string | null
          facebook: string | null
          favicon_url: string | null
          id: string
          instagram: string | null
          linkedin: string | null
          legal_accepted_at: string | null
          logo_url: string | null
          onboarding_completed_at: string | null
          primary_color: string | null
          privacy_policy_accepted: boolean
          privacy_policy_version: string | null
          responsible_cpf: string | null
          responsible_email: string
          responsible_name: string
          responsible_phone: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          secondary_color: string | null
          segment: string | null
          selected_plan_id: string | null
          site_seo_description: string | null
          site_title: string | null
          status: string
          team_size: string | null
          terms_accepted: boolean
          terms_version: string | null
          updated_at: string | null
          user_id: string | null
          youtube: string | null
        }
        Insert: {
          about_text?: string | null
          admin_notes?: string | null
          banner_title?: string | null
          banner_url?: string | null
          billing_cycle?: string | null
          cnpj?: string | null
          company_address?: string | null
          company_city?: string | null
          company_complement?: string | null
          company_email?: string | null
          company_name: string
          company_neighborhood?: string | null
          company_number?: string | null
          company_phone?: string | null
          company_whatsapp?: string | null
          confirmed_value?: number | null
          creci?: string | null
          created_at?: string | null
          custom_domain?: string | null
          facebook?: string | null
          favicon_url?: string | null
          id?: string
          instagram?: string | null
          linkedin?: string | null
          legal_accepted_at?: string | null
          logo_url?: string | null
          onboarding_completed_at?: string | null
          primary_color?: string | null
          privacy_policy_accepted?: boolean
          privacy_policy_version?: string | null
          responsible_cpf?: string | null
          responsible_email: string
          responsible_name: string
          responsible_phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          secondary_color?: string | null
          segment?: string | null
          selected_plan_id?: string | null
          site_seo_description?: string | null
          site_title?: string | null
          status?: string
          team_size?: string | null
          terms_accepted?: boolean
          terms_version?: string | null
          updated_at?: string | null
          user_id?: string | null
          youtube?: string | null
        }
        Update: {
          about_text?: string | null
          admin_notes?: string | null
          banner_title?: string | null
          banner_url?: string | null
          billing_cycle?: string | null
          cnpj?: string | null
          company_address?: string | null
          company_city?: string | null
          company_complement?: string | null
          company_email?: string | null
          company_name?: string
          company_neighborhood?: string | null
          company_number?: string | null
          company_phone?: string | null
          company_whatsapp?: string | null
          confirmed_value?: number | null
          creci?: string | null
          created_at?: string | null
          custom_domain?: string | null
          facebook?: string | null
          favicon_url?: string | null
          id?: string
          instagram?: string | null
          linkedin?: string | null
          legal_accepted_at?: string | null
          logo_url?: string | null
          onboarding_completed_at?: string | null
          primary_color?: string | null
          privacy_policy_accepted?: boolean
          privacy_policy_version?: string | null
          responsible_cpf?: string | null
          responsible_email?: string
          responsible_name?: string
          responsible_phone?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          secondary_color?: string | null
          segment?: string | null
          selected_plan_id?: string | null
          site_seo_description?: string | null
          site_title?: string | null
          status?: string
          team_size?: string | null
          terms_accepted?: boolean
          terms_version?: string | null
          updated_at?: string | null
          user_id?: string | null
          youtube?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_requests_selected_plan_id_fkey"
            columns: ["selected_plan_id"]
            isOneToOne: false
            referencedRelation: "admin_subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_api_keys: {
        Row: {
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          last_used_at: string | null
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          last_used_at?: string | null
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_kpi_cache: {
        Row: {
          id: string
          kpi_name: string
          kpi_value: number | null
          metadata: Json | null
          organization_id: string | null
          period: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          kpi_name: string
          kpi_value?: number | null
          metadata?: Json | null
          organization_id?: string | null
          period: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          kpi_name?: string
          kpi_value?: number | null
          metadata?: Json | null
          organization_id?: string | null
          period?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_kpi_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          joined_at: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          organization_id: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          joined_at?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_modules: {
        Row: {
          created_at: string | null
          id: string
          is_enabled: boolean | null
          module_name: string
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          module_name: string
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          module_name?: string
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_role_permissions: {
        Row: {
          created_at: string
          id: string
          organization_role_id: string
          permission_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_role_id: string
          permission_key: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_role_id?: string
          permission_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_role_permissions_organization_role_id_fkey"
            columns: ["organization_role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_sites: {
        Row: {
          about_checkmarks: Json | null
          about_features: Json | null
          about_image_url: string | null
          about_stats: Json | null
          about_subtitle: string | null
          about_text: string | null
          about_title: string | null
          accent_color: string | null
          address: string | null
          background_color: string
          body_scripts: string | null
          card_color: string
          city: string | null
          created_at: string
          custom_domain: string | null
          domain_verified: boolean
          domain_verified_at: string | null
          email: string | null
          facebook: string | null
          favicon_url: string | null
          google_ads_id: string | null
          google_analytics_id: string | null
          gtm_id: string | null
          head_scripts: string | null
          hero_image_url: string | null
          hero_subtitle: string | null
          hero_title: string | null
          id: string
          instagram: string | null
          is_active: boolean
          linkedin: string | null
          logo_height: number | null
          logo_url: string | null
          logo_width: number | null
          meta_pixel_id: string | null
          organization_id: string
          page_banner_url: string | null
          phone: string | null
          primary_color: string | null
          secondary_color: string | null
          seo_description: string | null
          seo_keywords: string | null
          seo_title: string | null
          show_about_on_home: boolean | null
          site_description: string | null
          site_theme: string
          site_title: string | null
          state: string | null
          subdomain: string | null
          text_color: string
          updated_at: string
          watermark_enabled: boolean | null
          watermark_logo_url: string | null
          watermark_opacity: number | null
          whatsapp: string | null
          youtube: string | null
        }
        Insert: {
          about_checkmarks?: Json | null
          about_features?: Json | null
          about_image_url?: string | null
          about_stats?: Json | null
          about_subtitle?: string | null
          about_text?: string | null
          about_title?: string | null
          accent_color?: string | null
          address?: string | null
          background_color?: string
          body_scripts?: string | null
          card_color?: string
          city?: string | null
          created_at?: string
          custom_domain?: string | null
          domain_verified?: boolean
          domain_verified_at?: string | null
          email?: string | null
          facebook?: string | null
          favicon_url?: string | null
          google_ads_id?: string | null
          google_analytics_id?: string | null
          gtm_id?: string | null
          head_scripts?: string | null
          hero_image_url?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          linkedin?: string | null
          logo_height?: number | null
          logo_url?: string | null
          logo_width?: number | null
          meta_pixel_id?: string | null
          organization_id: string
          page_banner_url?: string | null
          phone?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          seo_description?: string | null
          seo_keywords?: string | null
          seo_title?: string | null
          show_about_on_home?: boolean | null
          site_description?: string | null
          site_theme?: string
          site_title?: string | null
          state?: string | null
          subdomain?: string | null
          text_color?: string
          updated_at?: string
          watermark_enabled?: boolean | null
          watermark_logo_url?: string | null
          watermark_opacity?: number | null
          whatsapp?: string | null
          youtube?: string | null
        }
        Update: {
          about_checkmarks?: Json | null
          about_features?: Json | null
          about_image_url?: string | null
          about_stats?: Json | null
          about_subtitle?: string | null
          about_text?: string | null
          about_title?: string | null
          accent_color?: string | null
          address?: string | null
          background_color?: string
          body_scripts?: string | null
          card_color?: string
          city?: string | null
          created_at?: string
          custom_domain?: string | null
          domain_verified?: boolean
          domain_verified_at?: string | null
          email?: string | null
          facebook?: string | null
          favicon_url?: string | null
          google_ads_id?: string | null
          google_analytics_id?: string | null
          gtm_id?: string | null
          head_scripts?: string | null
          hero_image_url?: string | null
          hero_subtitle?: string | null
          hero_title?: string | null
          id?: string
          instagram?: string | null
          is_active?: boolean
          linkedin?: string | null
          logo_height?: number | null
          logo_url?: string | null
          logo_width?: number | null
          meta_pixel_id?: string | null
          organization_id?: string
          page_banner_url?: string | null
          phone?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          seo_description?: string | null
          seo_keywords?: string | null
          seo_title?: string | null
          show_about_on_home?: boolean | null
          site_description?: string | null
          site_theme?: string
          site_title?: string | null
          state?: string | null
          subdomain?: string | null
          text_color?: string
          updated_at?: string
          watermark_enabled?: boolean | null
          watermark_logo_url?: string | null
          watermark_opacity?: number | null
          whatsapp?: string | null
          youtube?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          admin_notes: string | null
          asaas_customer_id: string | null
          asaas_payment_link_id: string | null
          asaas_payment_link_url: string | null
          asaas_subscription_id: string | null
          bairro: string | null
          billing_day: number | null
          cep: string | null
          checkout_token: string | null
          cidade: string | null
          cnpj: string | null
          complemento: string | null
          created_at: string
          created_by: string | null
          creci: string | null
          default_commission_percentage: number | null
          email: string | null
          endereco: string | null
          id: string
          inscricao_estadual: string | null
          is_active: boolean
          is_financial_module_enabled: boolean | null
          last_access_at: string | null
          logo_size: number | null
          logo_url: string | null
          max_whatsapp_sessions_override: number | null
          max_users: number
          name: string
          next_billing_date: string | null
          nome_fantasia: string | null
          numero: string | null
          plan_id: string | null
          razao_social: string | null
          segment: string | null
          subscription_status: string
          subscription_type: string | null
          subscription_value: number | null
          telefone: string | null
          trial_ends_at: string | null
          uf: string | null
          updated_at: string
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          admin_notes?: string | null
          asaas_customer_id?: string | null
          asaas_payment_link_id?: string | null
          asaas_payment_link_url?: string | null
          asaas_subscription_id?: string | null
          bairro?: string | null
          billing_day?: number | null
          cep?: string | null
          checkout_token?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          created_by?: string | null
          creci?: string | null
          default_commission_percentage?: number | null
          email?: string | null
          endereco?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_active?: boolean
          is_financial_module_enabled?: boolean | null
          last_access_at?: string | null
          logo_size?: number | null
          logo_url?: string | null
          max_whatsapp_sessions_override?: number | null
          max_users?: number
          name: string
          next_billing_date?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          plan_id?: string | null
          razao_social?: string | null
          segment?: string | null
          subscription_status?: string
          subscription_type?: string | null
          subscription_value?: number | null
          telefone?: string | null
          trial_ends_at?: string | null
          uf?: string | null
          updated_at?: string
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          admin_notes?: string | null
          asaas_customer_id?: string | null
          asaas_payment_link_id?: string | null
          asaas_payment_link_url?: string | null
          asaas_subscription_id?: string | null
          bairro?: string | null
          billing_day?: number | null
          cep?: string | null
          checkout_token?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          created_by?: string | null
          creci?: string | null
          default_commission_percentage?: number | null
          email?: string | null
          endereco?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_active?: boolean
          is_financial_module_enabled?: boolean | null
          last_access_at?: string | null
          logo_size?: number | null
          logo_url?: string | null
          max_whatsapp_sessions_override?: number | null
          max_users?: number
          name?: string
          next_billing_date?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          plan_id?: string | null
          razao_social?: string | null
          segment?: string | null
          subscription_status?: string
          subscription_type?: string | null
          subscription_value?: number | null
          telefone?: string | null
          trial_ends_at?: string | null
          uf?: string | null
          updated_at?: string
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "admin_subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string | null
          id: string
          key: string
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      pipeline_sla_settings: {
        Row: {
          created_at: string | null
          critical_hours: number | null
          id: string
          pipeline_id: string
          sla_start_field: string | null
          stage_id: string | null
          updated_at: string | null
          warning_hours: number | null
        }
        Insert: {
          created_at?: string | null
          critical_hours?: number | null
          id?: string
          pipeline_id: string
          sla_start_field?: string | null
          stage_id?: string | null
          updated_at?: string | null
          warning_hours?: number | null
        }
        Update: {
          created_at?: string | null
          critical_hours?: number | null
          id?: string
          pipeline_id?: string
          sla_start_field?: string | null
          stage_id?: string | null
          updated_at?: string | null
          warning_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_sla_settings_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_sla_settings_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          default_round_robin_id: string | null
          first_response_start: string | null
          id: string
          include_automation_in_first_response: boolean | null
          is_default: boolean | null
          name: string
          organization_id: string
          pool_enabled: boolean | null
          pool_max_redistributions: number | null
          pool_timeout_minutes: number | null
        }
        Insert: {
          created_at?: string
          default_round_robin_id?: string | null
          first_response_start?: string | null
          id?: string
          include_automation_in_first_response?: boolean | null
          is_default?: boolean | null
          name: string
          organization_id: string
          pool_enabled?: boolean | null
          pool_max_redistributions?: number | null
          pool_timeout_minutes?: number | null
        }
        Update: {
          created_at?: string
          default_round_robin_id?: string | null
          first_response_start?: string | null
          id?: string
          include_automation_in_first_response?: boolean | null
          is_default?: boolean | null
          name?: string
          organization_id?: string
          pool_enabled?: boolean | null
          pool_max_redistributions?: number | null
          pool_timeout_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_default_round_robin_id_fkey"
            columns: ["default_round_robin_id"]
            isOneToOne: false
            referencedRelation: "round_robins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          description: string | null
          id: string
          metadata: Json
          organization_id: string | null
          severity: string
          title: string
          type: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          organization_id?: string | null
          severity?: string
          title: string
          type: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          organization_id?: string | null
          severity?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          aceita_financiamento: boolean | null
          andar: number | null
          ano_construcao: number | null
          ano_reforma: number | null
          anunciar: boolean | null
          aprovacao_ambiental: string | null
          area_total: number | null
          area_util: number | null
          arquivos: Json | null
          autorizado_comercializacao: boolean | null
          bairro: string | null
          banheiros: number | null
          cadastrado_por: string | null
          cep: string | null
          cidade: string | null
          city_id: string | null
          code: string
          codigo_agua: string | null
          codigo_eletricidade: string | null
          codigo_iptu: string | null
          comentarios_internos: string | null
          comissao_locacao: number | null
          comissao_venda: number | null
          commission_percentage: number | null
          complemento: string | null
          condicao_comercial: string | null
          condicao_pagamento: string | null
          condominio: number | null
          condominium_id: string | null
          corretor_id: string | null
          created_at: string
          data_inicio_comissao: string | null
          descricao: string | null
          descricao_site: string | null
          destaque: boolean | null
          detalhes_extras: string[] | null
          endereco: string | null
          exclusividade: boolean | null
          finalidade: string | null
          fotos: Json | null
          id: string
          imagem_principal: string | null
          imoview_codigo: string | null
          iptu: number | null
          is_demo: boolean
          latitude: number | null
          local_chaves: string | null
          longitude: number | null
          marcadores: string[] | null
          mobilia: string | null
          neighborhood_id: string | null
          numero: string | null
          numero_matricula: string | null
          observacoes_documentacao: string | null
          ocupacao: string | null
          organization_id: string
          owner_cellphone: string | null
          owner_email: string | null
          owner_media_source: string | null
          owner_name: string | null
          owner_notify_email: boolean | null
          owner_phone_commercial: string | null
          owner_phone_residential: string | null
          padrao: string | null
          pais: string | null
          placa_no_local: boolean | null
          posicao_localizacao: string | null
          preco: number | null
          projeto_aprovado: boolean | null
          public_address_visibility: string
          proximidades: string[] | null
          quartos: number | null
          referencia_alternativa: string | null
          regra_pet: boolean | null
          seguro_incendio: number | null
          situacao_imovel: string | null
          status: string | null
          status_descritivo: string | null
          suites: number | null
          super_destaque: boolean | null
          taxa_de_servico: number | null
          tipo_comissao: string | null
          tipo_de_imovel: string | null
          tipo_de_negocio: string | null
          title: string | null
          tour_virtual: string | null
          uf: string | null
          updated_at: string
          usou_fgts: boolean | null
          vagas: number | null
          valor_itr: number | null
          valor_locacao: number | null
          valor_locacao_avaliado: number | null
          valor_seguro_fianca: number | null
          valor_venda_avaliado: number | null
          video_imovel: string | null
          vista_codigo: string | null
          zoneamento: string | null
        }
        Insert: {
          aceita_financiamento?: boolean | null
          andar?: number | null
          ano_construcao?: number | null
          ano_reforma?: number | null
          anunciar?: boolean | null
          aprovacao_ambiental?: string | null
          area_total?: number | null
          area_util?: number | null
          arquivos?: Json | null
          autorizado_comercializacao?: boolean | null
          bairro?: string | null
          banheiros?: number | null
          cadastrado_por?: string | null
          cep?: string | null
          cidade?: string | null
          city_id?: string | null
          code: string
          codigo_agua?: string | null
          codigo_eletricidade?: string | null
          codigo_iptu?: string | null
          comentarios_internos?: string | null
          comissao_locacao?: number | null
          comissao_venda?: number | null
          commission_percentage?: number | null
          complemento?: string | null
          condicao_comercial?: string | null
          condicao_pagamento?: string | null
          condominio?: number | null
          condominium_id?: string | null
          corretor_id?: string | null
          created_at?: string
          data_inicio_comissao?: string | null
          descricao?: string | null
          descricao_site?: string | null
          destaque?: boolean | null
          detalhes_extras?: string[] | null
          endereco?: string | null
          exclusividade?: boolean | null
          finalidade?: string | null
          fotos?: Json | null
          id?: string
          imagem_principal?: string | null
          imoview_codigo?: string | null
          iptu?: number | null
          is_demo?: boolean
          latitude?: number | null
          local_chaves?: string | null
          longitude?: number | null
          marcadores?: string[] | null
          mobilia?: string | null
          neighborhood_id?: string | null
          numero?: string | null
          numero_matricula?: string | null
          observacoes_documentacao?: string | null
          ocupacao?: string | null
          organization_id: string
          owner_cellphone?: string | null
          owner_email?: string | null
          owner_media_source?: string | null
          owner_name?: string | null
          owner_notify_email?: boolean | null
          owner_phone_commercial?: string | null
          owner_phone_residential?: string | null
          padrao?: string | null
          pais?: string | null
          placa_no_local?: boolean | null
          posicao_localizacao?: string | null
          preco?: number | null
          projeto_aprovado?: boolean | null
          public_address_visibility?: string
          proximidades?: string[] | null
          quartos?: number | null
          referencia_alternativa?: string | null
          regra_pet?: boolean | null
          seguro_incendio?: number | null
          situacao_imovel?: string | null
          status?: string | null
          status_descritivo?: string | null
          suites?: number | null
          super_destaque?: boolean | null
          taxa_de_servico?: number | null
          tipo_comissao?: string | null
          tipo_de_imovel?: string | null
          tipo_de_negocio?: string | null
          title?: string | null
          tour_virtual?: string | null
          uf?: string | null
          updated_at?: string
          usou_fgts?: boolean | null
          vagas?: number | null
          valor_itr?: number | null
          valor_locacao?: number | null
          valor_locacao_avaliado?: number | null
          valor_seguro_fianca?: number | null
          valor_venda_avaliado?: number | null
          video_imovel?: string | null
          vista_codigo?: string | null
          zoneamento?: string | null
        }
        Update: {
          aceita_financiamento?: boolean | null
          andar?: number | null
          ano_construcao?: number | null
          ano_reforma?: number | null
          anunciar?: boolean | null
          aprovacao_ambiental?: string | null
          area_total?: number | null
          area_util?: number | null
          arquivos?: Json | null
          autorizado_comercializacao?: boolean | null
          bairro?: string | null
          banheiros?: number | null
          cadastrado_por?: string | null
          cep?: string | null
          cidade?: string | null
          city_id?: string | null
          code?: string
          codigo_agua?: string | null
          codigo_eletricidade?: string | null
          codigo_iptu?: string | null
          comentarios_internos?: string | null
          comissao_locacao?: number | null
          comissao_venda?: number | null
          commission_percentage?: number | null
          complemento?: string | null
          condicao_comercial?: string | null
          condicao_pagamento?: string | null
          condominio?: number | null
          condominium_id?: string | null
          corretor_id?: string | null
          created_at?: string
          data_inicio_comissao?: string | null
          descricao?: string | null
          descricao_site?: string | null
          destaque?: boolean | null
          detalhes_extras?: string[] | null
          endereco?: string | null
          exclusividade?: boolean | null
          finalidade?: string | null
          fotos?: Json | null
          id?: string
          imagem_principal?: string | null
          imoview_codigo?: string | null
          iptu?: number | null
          is_demo?: boolean
          latitude?: number | null
          local_chaves?: string | null
          longitude?: number | null
          marcadores?: string[] | null
          mobilia?: string | null
          neighborhood_id?: string | null
          numero?: string | null
          numero_matricula?: string | null
          observacoes_documentacao?: string | null
          ocupacao?: string | null
          organization_id?: string
          owner_cellphone?: string | null
          owner_email?: string | null
          owner_media_source?: string | null
          owner_name?: string | null
          owner_notify_email?: boolean | null
          owner_phone_commercial?: string | null
          owner_phone_residential?: string | null
          padrao?: string | null
          pais?: string | null
          placa_no_local?: boolean | null
          posicao_localizacao?: string | null
          preco?: number | null
          projeto_aprovado?: boolean | null
          public_address_visibility?: string
          proximidades?: string[] | null
          quartos?: number | null
          referencia_alternativa?: string | null
          regra_pet?: boolean | null
          seguro_incendio?: number | null
          situacao_imovel?: string | null
          status?: string | null
          status_descritivo?: string | null
          suites?: number | null
          super_destaque?: boolean | null
          taxa_de_servico?: number | null
          tipo_comissao?: string | null
          tipo_de_imovel?: string | null
          tipo_de_negocio?: string | null
          title?: string | null
          tour_virtual?: string | null
          uf?: string | null
          updated_at?: string
          usou_fgts?: boolean | null
          vagas?: number | null
          valor_itr?: number | null
          valor_locacao?: number | null
          valor_locacao_avaliado?: number | null
          valor_seguro_fianca?: number | null
          valor_venda_avaliado?: number | null
          video_imovel?: string | null
          vista_codigo?: string | null
          zoneamento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "property_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_condominium_id_fkey"
            columns: ["condominium_id"]
            isOneToOne: false
            referencedRelation: "property_condominiums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "property_neighborhoods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_cities: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          uf: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          uf?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          uf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "property_cities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_condominiums: {
        Row: {
          address: string | null
          city_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          neighborhood_id: string | null
          organization_id: string
        }
        Insert: {
          address?: string | null
          city_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          neighborhood_id?: string | null
          organization_id: string
        }
        Update: {
          address?: string | null
          city_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          neighborhood_id?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_condominiums_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "property_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_condominiums_neighborhood_id_fkey"
            columns: ["neighborhood_id"]
            isOneToOne: false
            referencedRelation: "property_neighborhoods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_condominiums_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_features: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_features_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_neighborhoods: {
        Row: {
          city_id: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
        }
        Insert: {
          city_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
        }
        Update: {
          city_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_neighborhoods_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "property_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_neighborhoods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_proximities: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_proximities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_sequences: {
        Row: {
          id: string
          last_number: number | null
          organization_id: string
          prefix: string
        }
        Insert: {
          id?: string
          last_number?: number | null
          organization_id: string
          prefix: string
        }
        Update: {
          id?: string
          last_number?: number | null
          organization_id?: string
          prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      property_types: {
        Row: {
          created_at: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prospecting_reports: {
        Row: {
          calls: number | null
          confirmed_visits: number | null
          contacts: number | null
          created_at: string | null
          description: string | null
          id: string
          meetings: number | null
          messages: number | null
          metadata: Json | null
          organization_id: string | null
          property_capturing: number | null
          proposals_sent: number | null
          scheduled_visits: number | null
          source: string | null
          user_id: string | null
          visits: number | null
        }
        Insert: {
          calls?: number | null
          confirmed_visits?: number | null
          contacts?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          meetings?: number | null
          messages?: number | null
          metadata?: Json | null
          organization_id?: string | null
          property_capturing?: number | null
          proposals_sent?: number | null
          scheduled_visits?: number | null
          source?: string | null
          user_id?: string | null
          visits?: number | null
        }
        Update: {
          calls?: number | null
          confirmed_visits?: number | null
          contacts?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          meetings?: number | null
          messages?: number | null
          metadata?: Json | null
          organization_id?: string | null
          property_capturing?: number | null
          proposals_sent?: number | null
          scheduled_visits?: number | null
          source?: string | null
          user_id?: string | null
          visits?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "prospecting_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string | null
          id: string
          subscription: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          subscription: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          subscription?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string | null
          device_info: Json | null
          id: string
          is_active: boolean | null
          organization_id: string
          platform: string
          token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          device_info?: Json | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          platform: string
          token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          device_info?: Json | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          platform?: string
          token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      round_robin_logs: {
        Row: {
          assigned_user_id: string | null
          created_at: string | null
          id: string
          lead_id: string | null
          member_id: string | null
          organization_id: string | null
          reason: string | null
          round_robin_id: string | null
          rule_matched: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          member_id?: string | null
          organization_id?: string | null
          reason?: string | null
          round_robin_id?: string | null
          rule_matched?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string | null
          member_id?: string | null
          organization_id?: string | null
          reason?: string | null
          round_robin_id?: string | null
          rule_matched?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "round_robin_logs_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_logs_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "round_robin_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_logs_round_robin_id_fkey"
            columns: ["round_robin_id"]
            isOneToOne: false
            referencedRelation: "round_robins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_logs_rule_matched_fkey"
            columns: ["rule_matched"]
            isOneToOne: false
            referencedRelation: "round_robin_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      round_robin_members: {
        Row: {
          id: string
          leads_count: number | null
          position: number
          round_robin_id: string
          team_id: string | null
          user_id: string
          weight: number | null
        }
        Insert: {
          id?: string
          leads_count?: number | null
          position?: number
          round_robin_id: string
          team_id?: string | null
          user_id: string
          weight?: number | null
        }
        Update: {
          id?: string
          leads_count?: number | null
          position?: number
          round_robin_id?: string
          team_id?: string | null
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "round_robin_members_round_robin_id_fkey"
            columns: ["round_robin_id"]
            isOneToOne: false
            referencedRelation: "round_robins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robin_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      round_robin_rules: {
        Row: {
          id: string
          is_active: boolean | null
          match: Json | null
          match_type: string
          match_value: string
          priority: number | null
          round_robin_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean | null
          match?: Json | null
          match_type: string
          match_value: string
          priority?: number | null
          round_robin_id: string
        }
        Update: {
          id?: string
          is_active?: boolean | null
          match?: Json | null
          match_type?: string
          match_value?: string
          priority?: number | null
          round_robin_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_robin_rules_round_robin_id_fkey"
            columns: ["round_robin_id"]
            isOneToOne: false
            referencedRelation: "round_robins"
            referencedColumns: ["id"]
          },
        ]
      }
      round_robins: {
        Row: {
          ai_agent_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          last_assigned_index: number | null
          leads_distributed: number | null
          name: string
          organization_id: string
          reentry_behavior: string | null
          settings: Json | null
          strategy: string | null
          target_pipeline_id: string | null
          target_stage_id: string | null
        }
        Insert: {
          ai_agent_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          last_assigned_index?: number | null
          leads_distributed?: number | null
          name: string
          organization_id: string
          reentry_behavior?: string | null
          settings?: Json | null
          strategy?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
        }
        Update: {
          ai_agent_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          last_assigned_index?: number | null
          leads_distributed?: number | null
          name?: string
          organization_id?: string
          reentry_behavior?: string | null
          settings?: Json | null
          strategy?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "round_robins_ai_agent_id_fkey"
            columns: ["ai_agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robins_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robins_target_pipeline_id_fkey"
            columns: ["target_pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_robins_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_event_assignees: {
        Row: {
          created_at: string
          event_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_event_assignees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_event_assignees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_event_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_event_comments: {
        Row: {
          content: string
          created_at: string
          event_id: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          event_id: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          event_id?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_event_comments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_event_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_events: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          description: string | null
          end_time: string
          event_type: string | null
          google_event_id: string | null
          id: string
          is_all_day: boolean | null
          lead_id: string | null
          location: string | null
          organization_id: string
          property_id: string | null
          recurrence_count: number | null
          recurrence_parent_id: string | null
          recurrence_rule: string | null
          recurrence_until: string | null
          reminder_minutes: number | null
          start_time: string
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
          visibility: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          end_time: string
          event_type?: string | null
          google_event_id?: string | null
          id?: string
          is_all_day?: boolean | null
          lead_id?: string | null
          location?: string | null
          organization_id: string
          property_id?: string | null
          recurrence_count?: number | null
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          recurrence_until?: string | null
          reminder_minutes?: number | null
          start_time: string
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          visibility?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          end_time?: string
          event_type?: string | null
          google_event_id?: string | null
          id?: string
          is_all_day?: boolean | null
          lead_id?: string | null
          location?: string | null
          organization_id?: string
          property_id?: string | null
          recurrence_count?: number | null
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          recurrence_until?: string | null
          reminder_minutes?: number | null
          start_time?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_plans: {
        Row: {
          category: string
          code: string
          created_at: string | null
          description: string | null
          features: string[] | null
          id: string
          is_active: boolean | null
          is_promo: boolean | null
          name: string
          organization_id: string
          price: number | null
          speed_mb: number | null
          updated_at: string | null
        }
        Insert: {
          category: string
          code: string
          created_at?: string | null
          description?: string | null
          features?: string[] | null
          id?: string
          is_active?: boolean | null
          is_promo?: boolean | null
          name: string
          organization_id: string
          price?: number | null
          speed_mb?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          code?: string
          created_at?: string | null
          description?: string | null
          features?: string[] | null
          id?: string
          is_active?: boolean | null
          is_promo?: boolean | null
          name?: string
          organization_id?: string
          price?: number | null
          speed_mb?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_analytics_events: {
        Row: {
          browser: string | null
          created_at: string
          device_type: string | null
          duration_seconds: number | null
          event_type: string
          id: string
          organization_id: string
          page_path: string
          page_title: string | null
          referrer: string | null
          screen_height: number | null
          screen_width: number | null
          session_id: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          browser?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          event_type?: string
          id?: string
          organization_id: string
          page_path: string
          page_title?: string | null
          referrer?: string | null
          screen_height?: number | null
          screen_width?: number | null
          session_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          browser?: string | null
          created_at?: string
          device_type?: string | null
          duration_seconds?: number | null
          event_type?: string
          id?: string
          organization_id?: string
          page_path?: string
          page_title?: string | null
          referrer?: string | null
          screen_height?: number | null
          screen_width?: number | null
          session_id?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_analytics_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_menu_items: {
        Row: {
          created_at: string | null
          href: string
          id: string
          is_active: boolean | null
          label: string
          link_type: string
          open_in_new_tab: boolean | null
          organization_id: string
          position: number
        }
        Insert: {
          created_at?: string | null
          href: string
          id?: string
          is_active?: boolean | null
          label: string
          link_type: string
          open_in_new_tab?: boolean | null
          organization_id: string
          position?: number
        }
        Update: {
          created_at?: string | null
          href?: string
          id?: string
          is_active?: boolean | null
          label?: string
          link_type?: string
          open_in_new_tab?: boolean | null
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_menu_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_search_filters: {
        Row: {
          created_at: string | null
          filter_key: string
          id: string
          is_active: boolean
          label: string
          organization_id: string
          position: number
        }
        Insert: {
          created_at?: string | null
          filter_key: string
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          position?: number
        }
        Update: {
          created_at?: string | null
          filter_key?: string
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "site_search_filters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_automations: {
        Row: {
          automation_id: string | null
          config: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          stage_id: string
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          automation_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          stage_id: string
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          automation_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          stage_id?: string
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_automations_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_operational_configs: {
        Row: {
          approval_flow: Json | null
          automatic_notifications: Json | null
          automatic_operational_requests: Json | null
          automatic_tasks: Json | null
          checklist_template: Json | null
          created_at: string | null
          dashboard_destination: string | null
          id: string
          operation_context: string
          organization_id: string
          responsible_sector: string | null
          sla_hours: number | null
          stage_id: string
          updated_at: string | null
          visibility_rules: Json | null
        }
        Insert: {
          approval_flow?: Json | null
          automatic_notifications?: Json | null
          automatic_operational_requests?: Json | null
          automatic_tasks?: Json | null
          checklist_template?: Json | null
          created_at?: string | null
          dashboard_destination?: string | null
          id?: string
          operation_context: string
          organization_id: string
          responsible_sector?: string | null
          sla_hours?: number | null
          stage_id: string
          updated_at?: string | null
          visibility_rules?: Json | null
        }
        Update: {
          approval_flow?: Json | null
          automatic_notifications?: Json | null
          automatic_operational_requests?: Json | null
          automatic_tasks?: Json | null
          checklist_template?: Json | null
          created_at?: string | null
          dashboard_destination?: string | null
          id?: string
          operation_context?: string
          organization_id?: string
          responsible_sector?: string | null
          sla_hours?: number | null
          stage_id?: string
          updated_at?: string | null
          visibility_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_operational_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_operational_configs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stages: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          is_lost: boolean
          is_won: boolean
          name: string
          organization_id: string
          pipeline_id: string
          position: number
          sla_hours: number | null
          stage_key: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_lost?: boolean
          is_won?: boolean
          name: string
          organization_id: string
          pipeline_id: string
          position?: number
          sla_hours?: number | null
          stage_key?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_lost?: boolean
          is_won?: boolean
          name?: string
          organization_id?: string
          pipeline_id?: string
          position?: number
          sla_hours?: number | null
          stage_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_logs: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
          organization_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value?: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string | null
          id: string
          is_leader: boolean | null
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_leader?: boolean | null
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_leader?: boolean | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      team_pipelines: {
        Row: {
          created_at: string
          id: string
          pipeline_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pipeline_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pipeline_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_pipelines_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_pipelines_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      telecom_billing: {
        Row: {
          amount: number | null
          billing_month: string
          billing_status: string | null
          created_at: string | null
          customer_id: string
          id: string
          notes: string | null
          organization_id: string
          payment_status: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          billing_month: string
          billing_status?: string | null
          created_at?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          organization_id: string
          payment_status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          billing_month?: string
          billing_status?: string | null
          created_at?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          payment_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telecom_billing_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "telecom_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telecom_billing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      telecom_customers: {
        Row: {
          address: string | null
          birth_date: string | null
          cep: string | null
          chip_category: string | null
          chip_quantity: number | null
          city: string | null
          complement: string | null
          contract_date: string | null
          contracted_plan: string | null
          cpf_cnpj: string | null
          created_at: string | null
          due_day: number | null
          email: string | null
          external_id: string | null
          id: string
          installation_date: string | null
          is_combo: boolean | null
          is_portability: boolean | null
          lead_id: string | null
          mesh_quantity: number | null
          mesh_repeater: string | null
          mother_name: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          number: string | null
          organization_id: string
          payment_method: string | null
          phone: string | null
          phone2: string | null
          plan_code: string | null
          plan_id: string | null
          plan_value: number | null
          rg: string | null
          seller_id: string | null
          status: string | null
          uf: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          cep?: string | null
          chip_category?: string | null
          chip_quantity?: number | null
          city?: string | null
          complement?: string | null
          contract_date?: string | null
          contracted_plan?: string | null
          cpf_cnpj?: string | null
          created_at?: string | null
          due_day?: number | null
          email?: string | null
          external_id?: string | null
          id?: string
          installation_date?: string | null
          is_combo?: boolean | null
          is_portability?: boolean | null
          lead_id?: string | null
          mesh_quantity?: number | null
          mesh_repeater?: string | null
          mother_name?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          organization_id: string
          payment_method?: string | null
          phone?: string | null
          phone2?: string | null
          plan_code?: string | null
          plan_id?: string | null
          plan_value?: number | null
          rg?: string | null
          seller_id?: string | null
          status?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          cep?: string | null
          chip_category?: string | null
          chip_quantity?: number | null
          city?: string | null
          complement?: string | null
          contract_date?: string | null
          contracted_plan?: string | null
          cpf_cnpj?: string | null
          created_at?: string | null
          due_day?: number | null
          email?: string | null
          external_id?: string | null
          id?: string
          installation_date?: string | null
          is_combo?: boolean | null
          is_portability?: boolean | null
          lead_id?: string | null
          mesh_quantity?: number | null
          mesh_repeater?: string | null
          mother_name?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          number?: string | null
          organization_id?: string
          payment_method?: string | null
          phone?: string | null
          phone2?: string | null
          plan_code?: string | null
          plan_id?: string | null
          plan_value?: number | null
          rg?: string | null
          seller_id?: string | null
          status?: string | null
          uf?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telecom_customers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telecom_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telecom_customers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "service_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telecom_customers_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      telephony_calls: {
        Row: {
          created_at: string | null
          direction: string | null
          duration_seconds: number | null
          id: string
          lead_id: string | null
          metadata: Json | null
          organization_id: string | null
          outcome: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          direction?: string | null
          duration_seconds?: number | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          organization_id?: string | null
          outcome?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          direction?: string | null
          duration_seconds?: number | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          organization_id?: string | null
          outcome?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telephony_calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telephony_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telephony_calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_gamification_stats: {
        Row: {
          created_at: string | null
          current_level: number | null
          current_rank: string | null
          id: string
          last_activity_at: string | null
          organization_id: string | null
          rank_tier: string
          season_id: string | null
          streak_days: number | null
          total_points: number | null
          updated_at: string | null
          user_id: string | null
          xp: number | null
          xp_current_level: number
          xp_next_level: number
          xp_total: number
        }
        Insert: {
          created_at?: string | null
          current_level?: number | null
          current_rank?: string | null
          id?: string
          last_activity_at?: string | null
          organization_id?: string | null
          rank_tier?: string
          season_id?: string | null
          streak_days?: number | null
          total_points?: number | null
          updated_at?: string | null
          user_id?: string | null
          xp?: number | null
          xp_current_level?: number
          xp_next_level?: number
          xp_total?: number
        }
        Update: {
          created_at?: string | null
          current_level?: number | null
          current_rank?: string | null
          id?: string
          last_activity_at?: string | null
          organization_id?: string | null
          rank_tier?: string
          season_id?: string | null
          streak_days?: number | null
          total_points?: number | null
          updated_at?: string | null
          user_id?: string | null
          xp?: number | null
          xp_current_level?: number
          xp_next_level?: number
          xp_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_gamification_stats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_gamification_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_mission_progress: {
        Row: {
          completed_at: string | null
          current_count: number | null
          id: string
          is_completed: boolean | null
          mission_id: string | null
          organization_id: string | null
          reset_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          current_count?: number | null
          id?: string
          is_completed?: boolean | null
          mission_id?: string | null
          organization_id?: string | null
          reset_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          current_count?: number | null
          id?: string
          is_completed?: boolean | null
          mission_id?: string | null
          organization_id?: string | null
          reset_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_mission_progress_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "gamification_missions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_org_cache: {
        Row: {
          organization_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          organization_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          organization_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_org_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organization_roles: {
        Row: {
          created_at: string
          id: string
          organization_role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organization_roles_organization_role_id_fkey"
            columns: ["organization_role_id"]
            isOneToOne: false
            referencedRelation: "organization_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          id: string
          permission_key: string
          user_id: string
        }
        Insert: {
          id?: string
          permission_key: string
          user_id: string
        }
        Update: {
          id?: string
          permission_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          cpf: string | null
          created_at: string
          email: string
          id: string
          is_active: boolean | null
          language: string | null
          name: string
          organization_id: string | null
          points: number | null
          role: string | null
          theme_mode: "light" | "dark" | "system"
          updated_at: string
          whatsapp: string | null
          xp: number | null
        }
        Insert: {
          avatar_url?: string | null
          cpf?: string | null
          created_at?: string
          email: string
          id: string
          is_active?: boolean | null
          language?: string | null
          name: string
          organization_id?: string | null
          points?: number | null
          role?: string | null
          theme_mode?: "light" | "dark" | "system"
          updated_at?: string
          whatsapp?: string | null
          xp?: number | null
        }
        Update: {
          avatar_url?: string | null
          cpf?: string | null
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean | null
          language?: string | null
          name?: string
          organization_id?: string | null
          points?: number | null
          role?: string | null
          theme_mode?: "light" | "dark" | "system"
          updated_at?: string
          whatsapp?: string | null
          xp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vista_integrations: {
        Row: {
          api_key: string
          api_url: string
          created_at: string | null
          id: string
          import_inactive: boolean | null
          is_active: boolean | null
          last_sync_at: string | null
          organization_id: string
          sync_log: Json | null
          total_synced: number | null
          updated_at: string | null
        }
        Insert: {
          api_key: string
          api_url: string
          created_at?: string | null
          id?: string
          import_inactive?: boolean | null
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_id: string
          sync_log?: Json | null
          total_synced?: number | null
          updated_at?: string | null
        }
        Update: {
          api_key?: string
          api_url?: string
          created_at?: string | null
          id?: string
          import_inactive?: boolean | null
          is_active?: boolean | null
          last_sync_at?: string | null
          organization_id?: string
          sync_log?: Json | null
          total_synced?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vista_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string | null
          events: string[]
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          name: string
          organization_id: string
          secret: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          organization_id: string
          secret?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          organization_id?: string
          secret?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks_integrations: {
        Row: {
          api_token: string
          created_at: string
          created_by: string | null
          field_mapping: Json | null
          id: string
          is_active: boolean
          last_lead_at: string | null
          last_triggered_at: string | null
          leads_received: number
          name: string
          organization_id: string
          target_pipeline_id: string | null
          target_property_id: string | null
          target_stage_id: string | null
          target_tag_ids: string[] | null
          target_team_id: string | null
          trigger_events: string[] | null
          type: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          api_token?: string
          created_at?: string
          created_by?: string | null
          field_mapping?: Json | null
          id?: string
          is_active?: boolean
          last_lead_at?: string | null
          last_triggered_at?: string | null
          leads_received?: number
          name: string
          organization_id: string
          target_pipeline_id?: string | null
          target_property_id?: string | null
          target_stage_id?: string | null
          target_tag_ids?: string[] | null
          target_team_id?: string | null
          trigger_events?: string[] | null
          type?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          api_token?: string
          created_at?: string
          created_by?: string | null
          field_mapping?: Json | null
          id?: string
          is_active?: boolean
          last_lead_at?: string | null
          last_triggered_at?: string | null
          leads_received?: number
          name?: string
          organization_id?: string
          target_pipeline_id?: string | null
          target_property_id?: string | null
          target_stage_id?: string | null
          target_tag_ids?: string[] | null
          target_team_id?: string | null
          trigger_events?: string[] | null
          type?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_integrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_integrations_target_pipeline_id_fkey"
            columns: ["target_pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_integrations_target_property_id_fkey"
            columns: ["target_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_integrations_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_integrations_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chat_labels: {
        Row: {
          conversation_id: string
          created_at: string | null
          id: string
          label_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          id?: string
          label_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chat_labels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chat_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_labels"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          archived_at: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_picture: string | null
          contact_presence: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_group: boolean | null
          last_message: string | null
          last_message_at: string | null
          lead_id: string | null
          organization_id: string | null
          presence_updated_at: string | null
          remote_jid: string
          session_id: string | null
          unread_count: number | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_picture?: string | null
          contact_presence?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_group?: boolean | null
          last_message?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          organization_id?: string | null
          presence_updated_at?: string | null
          remote_jid: string
          session_id?: string | null
          unread_count?: number | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_picture?: string | null
          contact_presence?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_group?: boolean | null
          last_message?: string | null
          last_message_at?: string | null
          lead_id?: string | null
          organization_id?: string | null
          presence_updated_at?: string | null
          remote_jid?: string
          session_id?: string | null
          unread_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          description: string | null
          group_jid: string
          id: string
          invite_link: string | null
          is_announce: boolean | null
          organization_id: string
          owner_jid: string | null
          participants: Json | null
          picture_url: string | null
          session_id: string
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          group_jid: string
          id?: string
          invite_link?: string | null
          is_announce?: boolean | null
          organization_id: string
          owner_jid?: string | null
          participants?: Json | null
          picture_url?: string | null
          session_id: string
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          group_jid?: string
          id?: string
          invite_link?: string | null
          is_announce?: boolean | null
          organization_id?: string
          owner_jid?: string | null
          participants?: Json | null
          picture_url?: string | null
          session_id?: string
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_groups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_inbound_logs: {
        Row: {
          assigned_user_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          match_details: Json | null
          matched_rule_id: string | null
          organization_id: string
          session_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          match_details?: Json | null
          matched_rule_id?: string | null
          organization_id: string
          session_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          match_details?: Json | null
          matched_rule_id?: string | null
          organization_id?: string
          session_id?: string | null
        }
        Relationships: []
      }
      whatsapp_inbound_rules: {
        Row: {
          campaign_label: string | null
          created_at: string
          id: string
          is_active: boolean
          match_field: string | null
          match_type: string
          match_value: string | null
          name: string
          organization_id: string
          priority: number
          session_id: string | null
          source_label: string | null
          target_pipeline_id: string | null
          target_round_robin_id: string | null
          target_stage_id: string | null
          target_team_id: string | null
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          campaign_label?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          match_field?: string | null
          match_type: string
          match_value?: string | null
          name: string
          organization_id: string
          priority?: number
          session_id?: string | null
          source_label?: string | null
          target_pipeline_id?: string | null
          target_round_robin_id?: string | null
          target_stage_id?: string | null
          target_team_id?: string | null
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          campaign_label?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          match_field?: string | null
          match_type?: string
          match_value?: string | null
          name?: string
          organization_id?: string
          priority?: number
          session_id?: string | null
          source_label?: string | null
          target_pipeline_id?: string | null
          target_round_robin_id?: string | null
          target_stage_id?: string | null
          target_team_id?: string | null
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_inbound_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_rules_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_rules_target_pipeline_id_fkey"
            columns: ["target_pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_rules_target_round_robin_id_fkey"
            columns: ["target_round_robin_id"]
            isOneToOne: false
            referencedRelation: "round_robins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_rules_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_inbound_rules_target_team_id_fkey"
            columns: ["target_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_labels: {
        Row: {
          color: number | null
          created_at: string | null
          id: string
          name: string
          organization_id: string
          predefined: boolean | null
          remote_label_id: string
          session_id: string
        }
        Insert: {
          color?: number | null
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          predefined?: boolean | null
          remote_label_id: string
          session_id: string
        }
        Update: {
          color?: number | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          predefined?: boolean | null
          remote_label_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_labels_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_templates: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          variables?: string[] | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          client_message_id: string | null
          content: string | null
          conversation_id: string
          delivered_at: string | null
          from_me: boolean
          id: string
          media_error: string | null
          media_mime_type: string | null
          media_size: number | null
          media_status: string | null
          media_storage_path: string | null
          media_url: string | null
          message_id: string
          message_type: string | null
          read_at: string | null
          remote_jid: string | null
          sender_jid: string | null
          sender_name: string | null
          sent_at: string
          session_id: string | null
          status: string | null
        }
        Insert: {
          client_message_id?: string | null
          content?: string | null
          conversation_id: string
          delivered_at?: string | null
          from_me?: boolean
          id?: string
          media_error?: string | null
          media_mime_type?: string | null
          media_size?: number | null
          media_status?: string | null
          media_storage_path?: string | null
          media_url?: string | null
          message_id: string
          message_type?: string | null
          read_at?: string | null
          remote_jid?: string | null
          sender_jid?: string | null
          sender_name?: string | null
          sent_at?: string
          session_id: string | null
          status?: string | null
        }
        Update: {
          client_message_id?: string | null
          content?: string | null
          conversation_id?: string
          delivered_at?: string | null
          from_me?: boolean
          id?: string
          media_error?: string | null
          media_mime_type?: string | null
          media_size?: number | null
          media_status?: string | null
          media_storage_path?: string | null
          media_url?: string | null
          message_id?: string
          message_type?: string | null
          read_at?: string | null
          remote_jid?: string | null
          sender_jid?: string | null
          sender_name?: string | null
          sent_at?: string
          session_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_session_access: {
        Row: {
          access_mode: string
          can_send: boolean | null
          can_view: boolean | null
          created_at: string
          granted_by: string | null
          id: string
          only_leads_access: boolean
          session_id: string
          user_id: string
        }
        Insert: {
          access_mode?: string
          can_send?: boolean | null
          can_view?: boolean | null
          created_at?: string
          granted_by?: string | null
          id?: string
          only_leads_access?: boolean
          session_id: string
          user_id: string
        }
        Update: {
          access_mode?: string
          can_send?: boolean | null
          can_view?: boolean | null
          created_at?: string
          granted_by?: string | null
          id?: string
          only_leads_access?: boolean
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_session_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_session_access_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_session_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          advanced_settings: Json | null
          created_at: string
          display_name: string | null
          id: string
          instance_id: string | null
          instance_name: string
          is_active: boolean | null
          is_notification_session: boolean | null
          last_connected_at: string | null
          name: string
          organization_id: string
          owner_user_id: string
          phone_number: string | null
          profile_name: string | null
          profile_picture: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          advanced_settings?: Json | null
          created_at?: string
          display_name?: string | null
          id?: string
          instance_id?: string | null
          instance_name: string
          is_active?: boolean | null
          is_notification_session?: boolean | null
          last_connected_at?: string | null
          name: string
          organization_id: string
          owner_user_id: string
          phone_number?: string | null
          profile_name?: string | null
          profile_picture?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Update: {
          advanced_settings?: Json | null
          created_at?: string
          display_name?: string | null
          id?: string
          instance_id?: string | null
          instance_name?: string
          is_active?: boolean | null
          is_notification_session?: boolean | null
          last_connected_at?: string | null
          name?: string
          organization_id?: string
          owner_user_id?: string
          phone_number?: string | null
          profile_name?: string | null
          profile_picture?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: undefined }
      admin_dashboard_feed: { Args: { p_limit?: number }; Returns: Json }
      admin_dashboard_overview: {
        Args: { p_period_days?: number }
        Returns: Json
      }
      admin_dashboard_pending_boards: { Args: never; Returns: Json }
      admin_dashboard_timeseries: {
        Args: { p_period_days?: number }
        Returns: Json
      }
      admin_list_organizations: {
        Args: { p_search?: string; p_segment?: string; p_status?: string }
        Returns: {
          automation_count: number
          created_at: string
          days_trial_left: number
          health_score: number
          id: string
          is_active: boolean
          last_access_at: string
          lead_count: number
          logo_url: string
          mrr: number
          name: string
          overdue_amount: number
          segment: string
          subscription_status: string
          subscription_type: string
          user_count: number
        }[]
      }
      award_gamification_points: {
        Args: {
          p_action_type: string
          p_metadata?: Json
          p_organization_id: string
          p_reference_id?: string
          p_user_id: string
        }
        Returns: undefined
      }
      can_access_lead: {
        Args: { p_lead_id: string; p_user_id?: string }
        Returns: boolean
      }
      can_access_whatsapp_session: {
        Args: { p_session_id: string; p_user_id?: string }
        Returns: boolean
      }
      can_manage_session: { Args: { session_id: string }; Returns: boolean }
      can_view_whatsapp_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      check_storage_org_access: {
        Args: { org_id_text: string }
        Returns: boolean
      }
      cleanup_orphan_members: { Args: never; Returns: Json }
      cleanup_whatsapp_retention: { Args: never; Returns: undefined }
      count_unique_sessions: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_organization_id: string
        }
        Returns: number
      }
      create_default_stages_for_pipeline: {
        Args: { p_org_id: string; p_pipeline_id: string }
        Returns: undefined
      }
      create_notification: {
        Args: {
          p_content: string
          p_lead_id?: string
          p_organization_id: string
          p_title: string
          p_type?: string
          p_user_id: string
        }
        Returns: string
      }
      find_orphan_rr_members: {
        Args: never
        Returns: {
          member_id: string
          queue_name: string
          reason: string
          round_robin_id: string
          user_id: string
        }[]
      }
      find_orphan_team_members: {
        Args: never
        Returns: {
          member_id: string
          reason: string
          team_id: string
          team_name: string
          user_id: string
        }[]
      }
      gamification_level_for_xp: { Args: { p_xp: number }; Returns: number }
      gamification_rank_tier: { Args: { p_level: number }; Returns: string }
      gamification_xp_for_level: { Args: { p_level: number }; Returns: number }
      generate_organization_api_key: {
        Args: { p_name: string; p_organization_id: string }
        Returns: string
      }
      get_dashboard_stats: { Args: never; Returns: Json }
      get_database_stats_admin: { Args: never; Returns: Json }
      get_funnel_data: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_deal_status?: string
          p_pipeline_id?: string
          p_source?: string
          p_tag_id?: string
          p_team_id?: string
          p_user_id?: string
        }
        Returns: {
          lead_count: number
          stage_id: string
          stage_key: string
          stage_name: string
          stage_order: number
        }[]
      }
      get_gamification_points: {
        Args: { p_action_type: string; p_org_id: string }
        Returns: number
      }
      get_lead_sources_data: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_deal_status?: string
          p_pipeline_id?: string
          p_source?: string
          p_tag_id?: string
          p_team_id?: string
          p_user_id?: string
        }
        Returns: {
          lead_count: number
          source_name: string
        }[]
      }
      get_my_org_id: { Args: never; Returns: string }
      get_or_create_active_season: {
        Args: { p_org_id: string }
        Returns: string
      }
      get_session_owner: { Args: { p_session_id: string }; Returns: string }
      get_team_member_ids: { Args: { p_team_id: string }; Returns: string[] }
      get_telephony_metrics: {
        Args: {
          p_end_date?: string
          p_organization_id: string
          p_start_date?: string
          p_user_id?: string
        }
        Returns: {
          answered_calls: number
          avg_duration: number
          missed_calls: number
          total_calls: number
          total_duration: number
        }[]
      }
      get_telephony_ranking: {
        Args: {
          p_end_date?: string
          p_limit?: number
          p_organization_id: string
          p_start_date?: string
        }
        Returns: {
          answered_calls: number
          total_calls: number
          total_duration: number
          user_id: string
          user_name: string
        }[]
      }
      get_user_led_pipeline_ids: { Args: never; Returns: string[] }
      get_user_led_team_ids: { Args: never; Returns: string[] }
      get_user_organization_id: { Args: never; Returns: string }
      get_user_organization_role: {
        Args: { p_user_id?: string }
        Returns: {
          permissions: string[]
          role_color: string
          role_id: string
          role_name: string
        }[]
      }
      get_user_team_ids: { Args: never; Returns: string[] }
      handle_lead_intake: { Args: { p_lead_id: string }; Returns: Json }
      has_whatsapp_session_ownership: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: boolean
      }
      initialize_organization_financial_categories: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_member_available: { Args: { p_user_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_super_admin_member_bypass: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      is_team_leader: { Args: { check_user_id?: string }; Returns: boolean }
      list_all_organizations_admin: {
        Args: never
        Returns: {
          admin_notes: string
          created_at: string
          id: string
          is_active: boolean
          last_access_at: string
          lead_count: number
          logo_url: string
          max_users: number
          name: string
          subscription_status: string
          user_count: number
        }[]
      }
      list_all_users_admin: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          organization_name: string
          role: string
        }[]
      }
      list_contacts_paginated: {
        Args: {
          p_ad_id?: string
          p_adset_id?: string
          p_assignee_id?: string
          p_campaign_id?: string
          p_created_from?: string
          p_created_to?: string
          p_deal_status?: string
          p_limit?: number
          p_page?: number
          p_pipeline_id?: string
          p_search?: string
          p_sort_by?: string
          p_sort_dir?: string
          p_source?: string
          p_stage_id?: string
          p_tag_id?: string
          p_team_id?: string
          p_unassigned?: boolean
        }
        Returns: {
          assigned_user_id: string
          assignee_avatar: string
          assignee_name: string
          created_at: string
          deal_status: string
          email: string
          id: string
          last_interaction_at: string
          last_interaction_channel: string
          last_interaction_preview: string
          last_entry_at: string
          lost_reason: string
          name: string
          phone: string
          pipeline_id: string
          pipeline_name: string
          reentry_count: number
          sla_status: string
          source: string
          stage_color: string
          stage_id: string
          stage_name: string
          tags: Json
          total_count: number
          whatsapp_avatar_url: string
        }[]
      }
      mark_overdue_financial_entries: { Args: never; Returns: undefined }
      normalize_phone: { Args: { phone_input: string }; Returns: string }
      notify_financial_entries: { Args: never; Returns: undefined }
      notify_whatsapp_on_lead: {
        Args: {
          p_lead_name: string
          p_org_id: string
          p_source?: string
          p_user_id: string
        }
        Returns: undefined
      }
      pick_round_robin_for_lead: {
        Args: { p_lead_id: string }
        Returns: string
      }
      process_gamification_event: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_org_id: string
          p_quantity?: number
          p_reference_id?: string
          p_user_id: string
        }
        Returns: undefined
      }
      recover_stuck_executions: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      redistribute_lead_from_pool: {
        Args: { p_lead_id: string; p_reason?: string }
        Returns: Json
      }
      register_lead_reentry: {
        Args: {
          p_campaign_name?: string
          p_entry_type?: string
          p_lead_id: string
          p_metadata?: Json
          p_org_id: string
          p_property_id?: string
          p_source?: string
          p_utm_campaign?: string
          p_utm_medium?: string
          p_utm_source?: string
          p_valor_interesse?: number
        }
        Returns: undefined
      }
      release_execution_step_lock: {
        Args: { p_execution_id: string; p_token: string }
        Returns: undefined
      }
      reorder_stages: { Args: { p_stages: Json }; Returns: undefined }
      reset_gamification_season: {
        Args: {
          p_organization_id: string
          p_reason?: string
          p_season_name: string
        }
        Returns: string
      }
      resolve_site_domain: {
        Args: { p_domain: string }
        Returns: {
          organization_id: string
          site_config: Json
        }[]
      }
      sync_historical_commissions: { Args: never; Returns: Json }
      sync_user_level_and_xp: {
        Args: { p_org_id: string; p_points: number; p_user_id: string }
        Returns: undefined
      }
      try_acquire_execution_step_lock: {
        Args: { p_execution_id: string; p_max_lock_age_seconds?: number }
        Returns: string
      }
      user_belongs_to_organization: {
        Args: { org_id: string }
        Returns: boolean
      }
      user_has_organization: { Args: never; Returns: boolean }
      user_has_permission: {
        Args: { p_permission_key: string; p_user_id?: string }
        Returns: boolean
      }
      user_has_session_access: {
        Args: { session_id: string }
        Returns: boolean
      }
      vimob_can_access_whatsapp_conversation: {
        Args: { p_conversation_id: string; p_permission?: string }
        Returns: boolean
      }
      vimob_can_access_whatsapp_session: {
        Args: { p_permission?: string; p_session_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "super_admin"
      lead_source:
        | "meta"
        | "site"
        | "manual"
        | "wordpress"
        | "whatsapp"
        | "facebook"
        | "instagram"
        | "import"
        | "google"
        | "indicacao"
        | "outros"
        | "webhook"
      round_robin_strategy: "simple" | "weighted"
      task_type:
        | "call"
        | "message"
        | "email"
        | "note"
        | "task"
        | "meeting"
        | "whatsapp"
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
      app_role: ["admin", "user", "super_admin"],
      lead_source: [
        "meta",
        "site",
        "manual",
        "wordpress",
        "whatsapp",
        "facebook",
        "instagram",
        "import",
        "google",
        "indicacao",
        "outros",
        "webhook",
      ],
      round_robin_strategy: ["simple", "weighted"],
      task_type: [
        "call",
        "message",
        "email",
        "note",
        "task",
        "meeting",
        "whatsapp",
      ],
    },
  },
} as const
