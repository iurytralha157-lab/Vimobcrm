import { useQuery } from '@tanstack/react-query';
import { Json } from '@/integrations/supabase/types';
import { settingsAPI } from '@/lib/api/settings';

export interface SystemSettingsValue {
  logo_url_light?: string | null;
  logo_url_dark?: string | null;
  favicon_url_light?: string | null;
  favicon_url_dark?: string | null;
  pwa_icon_url?: string | null;
  login_bg_url?: string | null;
  default_whatsapp?: string | null;
  contact_whatsapp?: string | null;
  logo_width?: number | null;
  logo_height?: number | null;
  maintenance_mode?: boolean | null;
  maintenance_message?: string | null;
  feature_flags?: Record<string, boolean> | null;
  notification_instance_name?: string | null;

  // New fields from request
  logo_principal?: string | null;
  logo_secundaria?: string | null;
  favicon?: string | null;
  imagens_padrao?: string[];

  whatsapp?: {
    enabled: boolean;
    api_key: string;
    phone_number: string;
    template_default: string;
  };
  sms?: {
    enabled: boolean;
    api_key: string;
  };
  comunicados?: Array<{
    id: string;
    titulo: string;
    mensagem: string;
    data_publicacao: string;
    ativo: boolean;
  }>;
  maintenance?: {
    enabled: boolean;
    message: string;
    allowed_ips: string[];
  };
  force_update?: {
    version: string;
    message: string;
  };
  notifications?: {
    email_enabled: boolean;
    push_enabled: boolean;
    sms_enabled: boolean;
    templates: Array<{
      type: string;
      trigger: string;
      subject: string;
      body: string;
    }>;
  };
}

export interface SystemSettings {
  id: string;
  key: string;
  value: Json;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  // Convenience accessors from value
  logo_url_light?: string | null;
  logo_url_dark?: string | null;
  favicon_url_light?: string | null;
  favicon_url_dark?: string | null;
  pwa_icon_url?: string | null;
  login_bg_url?: string | null;
  default_whatsapp?: string | null;
  contact_whatsapp?: string | null;
  logo_width?: number | null;
  logo_height?: number | null;
  maintenance_mode?: boolean;
  maintenance_message?: string;
  feature_flags?: Record<string, boolean>;
  notification_instance_name?: string | null;

  // New convenience accessors
  logo_principal?: string | null;
  logo_secundaria?: string | null;
  favicon?: string | null;
  imagens_padrao?: string[];
  whatsapp_config?: SystemSettingsValue['whatsapp'];
  sms_config?: SystemSettingsValue['sms'];
  comunicados?: SystemSettingsValue['comunicados'];
  maintenance_config?: SystemSettingsValue['maintenance'];
  force_update?: SystemSettingsValue['force_update'];
  notifications_config?: SystemSettingsValue['notifications'];
}

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const data = await settingsAPI.getSystemSettings<SystemSettings>();
      if (!data) return null;

      const value = (data.value as SystemSettingsValue) || {};
      return {
        ...data,
        logo_url_light: value.logo_url_light || null,
        logo_url_dark: value.logo_url_dark || null,
        favicon_url_light: value.favicon_url_light || null,
        favicon_url_dark: value.favicon_url_dark || null,
        pwa_icon_url: value.pwa_icon_url || null,
        login_bg_url: value.login_bg_url || null,
        default_whatsapp: value.default_whatsapp || null,
        contact_whatsapp: value.contact_whatsapp || value.default_whatsapp || null,
        logo_width: value.logo_width || null,
        logo_height: value.logo_height || null,
        maintenance_mode: value.maintenance?.enabled ?? value.maintenance_mode ?? false,
        maintenance_message: value.maintenance?.message ?? value.maintenance_message ?? '',
        feature_flags: (value.feature_flags as Record<string, boolean>) || {},
        notification_instance_name: value.notification_instance_name || null,

        // New mappings
        logo_principal: value.logo_principal || value.logo_url_light || null,
        logo_secundaria: value.logo_secundaria || value.logo_url_dark || null,
        favicon: value.favicon || value.favicon_url_light || null,
        imagens_padrao: value.imagens_padrao || [],
        whatsapp_config: value.whatsapp || { enabled: false, api_key: '', phone_number: '', template_default: '' },
        sms_config: value.sms || { enabled: false, api_key: '' },
        comunicados: value.comunicados || [],
        maintenance_config: value.maintenance || { enabled: false, message: '', allowed_ips: [] },
        force_update: value.force_update || { version: '', message: '' },
        notifications_config: value.notifications || { email_enabled: false, push_enabled: false, sms_enabled: false, templates: [] }
      } as SystemSettings;
    },
    staleTime: 1000 * 60 * 5,
  });
}
