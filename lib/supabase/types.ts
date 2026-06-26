// Gerado automaticamente pelo Supabase CLI
// npx supabase gen types typescript > lib/supabase/types.ts

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
      users: {
        Row: {
          id: string
          organization_id: string | null
          name: string
          email: string
          role: 'admin' | 'user' | 'super_admin'
          avatar_url: string | null
          is_active: boolean
          language?: string | null
          phone?: string | null
          whatsapp?: string | null
          cpf?: string | null
          cep?: string | null
          endereco?: string | null
          numero?: string | null
          complemento?: string | null
          bairro?: string | null
          cidade?: string | null
          uf?: string | null
          created_at?: string
          updated_at?: string
        }
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['users']['Row']>
      }
      organizations: {
        Row: {
          id: string
          name: string
          logo_url: string | null
          theme_mode: string
          accent_color: string
          is_active?: boolean
          subscription_status?: string
          segment?: 'imobiliario' | 'telecom' | 'servicos' | null
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
          created_at?: string
          updated_at?: string
        }
        Insert: Omit<Database['public']['Tables']['organizations']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['organizations']['Row']>
      }
      organization_members: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          role: string
          is_active: boolean
          joined_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['organization_members']['Row'], 'id' | 'joined_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['organization_members']['Row']>
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
    CompositeTypes: {}
  }
}
