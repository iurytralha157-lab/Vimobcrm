import type { WhatsAppContactCard, WhatsAppLocation, WhatsAppQuotedMessage } from "@/lib/api/whatsapp";

export interface WhatsAppConversation {
  id: string;
  session_id: string | null;
  lead_id: string | null;
  remote_jid: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_picture: string | null;
  contact_presence: string | null;
  presence_updated_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_id?: string | null;
  last_message_sent_at?: string | null;
  last_message_from_me?: boolean | null;
  last_message_status?: string | null;
  unread_count: number;
  is_group: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
	historical_lead_view?: boolean;
  supervisory_lead_view?: boolean;
  session?: {
    id: string;
    instance_name: string;
    phone_number: string | null;
    status: string;
    organization_id: string;
    provider?: "evolution" | "evolution_go" | null;
  };
  lead?: {
    id: string;
    name: string;
    source?: string | null;
    whatsapp_avatar_url?: string | null;
    pipeline_id?: string | null;
    stage_id?: string | null;
    pipeline?: {
      id: string;
      name: string;
    } | null;
    stage?: {
      id: string;
      name: string;
      color: string | null;
    } | null;
    assignee?: {
      id: string;
      name: string;
      avatar_url?: string | null;
    } | null;
    tags?: Array<{
      tag: {
        id: string;
        name: string;
        color: string;
      };
    }>;
  };
}

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  session_id: string | null;
  message_id: string;
  client_message_id?: string | null;
  from_me: boolean;
  content: string | null;
  message_type: string;
  media_url: string | null;
  media_mime_type: string | null;
  media_filename?: string | null;
  contacts?: WhatsAppContactCard[];
  location?: WhatsAppLocation;
  quoted_message?: WhatsAppQuotedMessage;
  media_status?: "pending" | "ready" | "failed" | null;
  media_error?: string | null;
  media_size?: number | null;
  media_storage_path?: string | null;
  remote_jid?: string | null;
  reaction_to_message_id?: string | null;
  reaction_emoji?: string | null;
  reaction_sender_jid?: string | null;
  reaction_sender_name?: string | null;
  metadata?: Record<string, unknown>;
  status: string;
  can_quote?: boolean;
  can_react?: boolean;
  delivery_error_code?: "recipient_not_registered" | "outcome_unknown" | "send_failed" | null;
  delivery_error_reason?: "media_integrity_unverified";
  delivery_failed_at?: string | null;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  sender_jid: string | null;
  sender_name: string | null;
  sender_user_id?: string | null;
}

export interface ConversationFilters {
  pipelineId?: string;
  teamId?: string;
  userId?: string;
  leadSource?: string;
  tagIds?: string[];
  dealStatus?: 'open' | 'won' | 'lost';
  pageId?: string;
  campaignIds?: string[];
  adSetId?: string;
  adId?: string;
  leadCreatedFrom?: string;
  leadCreatedTo?: string;
  hideGroups?: boolean;
  showArchived?: boolean;
  onlyLeads?: boolean;
  withoutLead?: boolean;
  pendingReply?: boolean;
  search?: string;
  lastMessageFrom?: string;
  lastMessageTo?: string;
}

type WhatsAppMessagePage = {
  messages: WhatsAppMessage[];
};

export type PaginatedWhatsAppMessages = {
  pages: WhatsAppMessagePage[];
};
