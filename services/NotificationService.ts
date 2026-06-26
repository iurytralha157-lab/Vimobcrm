import { supabase } from '@/integrations/supabase/client';

export type NotificationChannel = 'whatsapp' | 'system' | 'email' | 'push';

export interface NotificationTemplate {
  id: string;
  name: string;
  slug: string;
  category: string;
  event_key: string;
  channel: NotificationChannel;
  channels: NotificationChannel[];
  title: string | null;
  message: string;
  variables: string[] | null;
  is_active: boolean;
  editable_by_admin: boolean;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
  dedupe_window_seconds?: number;
  subject?: string;
  html_body?: string;
}

export interface SendNotificationParams {
  eventKey?: string;
  templateSlug?: string; // Mantido para compatibilidade temporária
  organizationId: string;
  userId?: string;
  recipient?: string;
  variables: Record<string, unknown>;
  leadId?: string;
  dedupeKey?: string;
  isTest?: boolean;
}

class NotificationService {
  /**
   * Centralized method to send notifications via the Dispatcher Edge Function
   */
  async send({
    eventKey,
    templateSlug,
    organizationId,
    userId,
    recipient,
    variables,
    leadId,
    dedupeKey,
    isTest
  }: SendNotificationParams) {
    const finalEventKey = eventKey || templateSlug;
    if (!finalEventKey) {
      return { success: false, error: 'eventKey or templateSlug is required' };
    }

    console.log(`[NotificationService] Dispatching event: ${finalEventKey} for org: ${organizationId}`);

    try {
      const { data, error } = await supabase.functions.invoke('notification-dispatcher', {
        body: {
          event_key: finalEventKey,
          organization_id: organizationId,
          user_id: userId,
          recipient,
          variables,
          lead_id: leadId,
          dedupe_key: dedupeKey,
          is_test: isTest
        },
      });

      if (error) {
        console.error(`[NotificationService] Error invoking dispatcher for ${finalEventKey}:`, error);
        return { success: false, error };
      }

      return data;
    } catch (err) {
      console.error(`[NotificationService] Unexpected error sending ${finalEventKey}:`, err);
      return { success: false, error: err };
    }
  }
}

export const notificationService = new NotificationService();
