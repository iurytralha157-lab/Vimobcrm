export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TableDefinition<Row, Insert = Row, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type VimobCoreDatabase = {
  public: {
    Tables: {
      admin_subscription_plans: TableDefinition<
        {
          id: string
          slug: string
          name: string
          description: string | null
          price: number
          billing_cycle: string | null
          trial_enabled: boolean
          trial_days: number | null
          max_users: number | null
          max_leads: number | null
          max_whatsapp_sessions: number | null
          modules: string[]
          is_active: boolean
          is_public: boolean
          created_at: string
          updated_at: string
        },
        {
          id?: string
          slug: string
          name: string
          description?: string | null
          price?: number
          billing_cycle?: string | null
          trial_enabled?: boolean
          trial_days?: number | null
          max_users?: number | null
          max_leads?: number | null
          max_whatsapp_sessions?: number | null
          modules?: string[]
          is_active?: boolean
          is_public?: boolean
          created_at?: string
          updated_at?: string
        }
      >
      organizations: TableDefinition<
        {
          id: string
          name: string
          slug: string | null
          logo_url: string | null
          is_active: boolean
          segment: string
          cnpj: string | null
          creci: string | null
          inscricao_estadual: string | null
          razao_social: string | null
          nome_fantasia: string | null
          cep: string | null
          endereco: string | null
          numero: string | null
          complemento: string | null
          bairro: string | null
          cidade: string | null
          uf: string | null
          telefone: string | null
          whatsapp: string | null
          email: string | null
          website: string | null
          default_commission_percentage: number | null
          plan_id: string | null
          subscription_status: string
          subscription_type: string | null
          subscription_value: number | null
          trial_ends_at: string | null
          next_billing_date: string | null
          billing_day: number | null
          checkout_token: string | null
          max_users: number
          max_whatsapp_sessions_override: number | null
          is_financial_module_enabled: boolean
          asaas_customer_id: string | null
          asaas_subscription_id: string | null
          asaas_payment_link_id: string | null
          asaas_payment_link_url: string | null
          admin_notes: string | null
          created_by: string | null
          last_access_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          name: string
          slug?: string | null
          logo_url?: string | null
          is_active?: boolean
          segment?: string
          cnpj?: string | null
          creci?: string | null
          inscricao_estadual?: string | null
          razao_social?: string | null
          nome_fantasia?: string | null
          cep?: string | null
          endereco?: string | null
          numero?: string | null
          complemento?: string | null
          bairro?: string | null
          cidade?: string | null
          uf?: string | null
          telefone?: string | null
          whatsapp?: string | null
          email?: string | null
          website?: string | null
          default_commission_percentage?: number | null
          plan_id?: string | null
          subscription_status?: string
          subscription_type?: string | null
          subscription_value?: number | null
          trial_ends_at?: string | null
          next_billing_date?: string | null
          billing_day?: number | null
          checkout_token?: string | null
          max_users?: number
          max_whatsapp_sessions_override?: number | null
          is_financial_module_enabled?: boolean
          asaas_customer_id?: string | null
          asaas_subscription_id?: string | null
          asaas_payment_link_id?: string | null
          asaas_payment_link_url?: string | null
          admin_notes?: string | null
          created_by?: string | null
          last_access_at?: string | null
          created_at?: string
          updated_at?: string
        }
      >
      users: TableDefinition<
        {
          id: string
          organization_id: string | null
          name: string
          email: string
          role: string
          avatar_url: string | null
          is_active: boolean
          language: string | null
          theme_mode: 'light' | 'dark' | 'system'
          whatsapp: string | null
          cpf: string | null
          points: number
          xp: number
          created_at: string
          updated_at: string
        },
        {
          id: string
          organization_id?: string | null
          name: string
          email: string
          role?: string
          avatar_url?: string | null
          is_active?: boolean
          language?: string | null
          theme_mode?: 'light' | 'dark' | 'system'
          whatsapp?: string | null
          cpf?: string | null
          points?: number
          xp?: number
          created_at?: string
          updated_at?: string
        }
      >
      organization_members: TableDefinition<
        {
          id: string
          organization_id: string
          user_id: string
          role: string
          is_active: boolean
          joined_at: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          user_id: string
          role?: string
          is_active?: boolean
          joined_at?: string
          created_at?: string
          updated_at?: string
        }
      >
      organization_modules: TableDefinition<
        {
          id: string
          organization_id: string
          module_name: string
          is_enabled: boolean
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          module_name: string
          is_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
      >
      subscriptions: TableDefinition<
        {
          id: string
          organization_id: string
          plan_id: string | null
          status: string
          provider: string | null
          provider_customer_id: string | null
          provider_subscription_id: string | null
          current_period_start: string | null
          current_period_end: string | null
          trial_ends_at: string | null
          cancel_at: string | null
          canceled_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        },
        {
          id?: string
          organization_id: string
          plan_id?: string | null
          status?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          current_period_start?: string | null
          current_period_end?: string | null
          trial_ends_at?: string | null
          cancel_at?: string | null
          canceled_at?: string | null
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
      >
      legal_consents: TableDefinition<
        {
          id: string
          user_id: string
          organization_id: string
          terms_version: string
          privacy_version: string
          accepted_at: string
          ip_address: string | null
          user_agent: string | null
          source: string
          metadata: Json
          created_at: string
        },
        {
          id?: string
          user_id: string
          organization_id: string
          terms_version: string
          privacy_version: string
          accepted_at?: string
          ip_address?: string | null
          user_agent?: string | null
          source?: string
          metadata?: Json
          created_at?: string
        }
      >
      audit_logs: TableDefinition<
        {
          id: string
          organization_id: string | null
          user_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          old_data: Json | null
          new_data: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        },
        {
          id?: string
          organization_id?: string | null
          user_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          old_data?: Json | null
          new_data?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
      >
      system_settings: TableDefinition<
        {
          id: string
          key: string
          value: Json
          description: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          key: string
          value?: Json
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      >
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
