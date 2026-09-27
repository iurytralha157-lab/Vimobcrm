import {
  whatsappCallListResponseSchema,
  whatsappCallMediaTicketSchema,
  whatsappCallResponseSchema,
  whatsappCallRecordingResponseSchema,
  whatsappContactNameSchema,
  whatsappContactSaveResponseSchema,
  type WhatsAppCall,
} from "@/lib/validation/whatsapp-calls";
import { vimobAPIRequest } from "@/lib/api/vimob-client";

const segment = (value: string) => encodeURIComponent(value);

export const whatsappCallsAPI = {
  async listHistory(organizationId: string, before?: { at: string; id: string }): Promise<WhatsAppCall[]> {
    const response = await vimobAPIRequest<unknown>(
      "/v1/whatsapp/calls",
      { organizationId, query: {
        limit: 50,
        ...(before ? { before_at: before.at, before_id: before.id } : {}),
      } },
    );
    return whatsappCallListResponseSchema.parse(response).data;
  },

  async listActive(organizationId: string): Promise<WhatsAppCall[]> {
    const response = await vimobAPIRequest<unknown>(
      "/v1/whatsapp/calls/active",
      { organizationId },
    );
    return whatsappCallListResponseSchema.parse(response).data;
  },

  async listForSession(sessionId: string, organizationId: string): Promise<WhatsAppCall[]> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/sessions/${segment(sessionId)}/calls`,
      { organizationId, query: { limit: 50 } },
    );
    return whatsappCallListResponseSchema.parse(response).data;
  },

  async listForLead(leadId: string, organizationId: string): Promise<WhatsAppCall[]> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/leads/${segment(leadId)}/whatsapp-calls`,
      { organizationId },
    );
    return whatsappCallListResponseSchema.parse(response).data;
  },

  async start(conversationId: string, organizationId: string): Promise<WhatsAppCall> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/conversations/${segment(conversationId)}/calls`,
      { method: "POST", organizationId, body: {} },
    );
    return whatsappCallResponseSchema.parse(response).data;
  },

  async command(callId: string, action: "accept" | "reject" | "end", organizationId: string): Promise<WhatsAppCall> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/calls/${segment(callId)}/${action}`,
      { method: "POST", organizationId, body: {} },
    );
    return whatsappCallResponseSchema.parse(response).data;
  },

  async mediaTicket(callId: string, organizationId: string): Promise<{ url: string; expires_at: string }> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/calls/${segment(callId)}/media-ticket`,
      { method: "POST", organizationId, body: {} },
    );
    return whatsappCallMediaTicketSchema.parse(response);
  },

  async recordingURLs(callId: string, organizationId: string) {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/calls/${segment(callId)}/recording`,
      { organizationId },
    );
    const record = whatsappCallRecordingResponseSchema.parse(response).data;
    for (const url of [record.incoming_url, record.outgoing_url]) {
      if (url && !url.startsWith("https://")) throw new Error("Endereço de gravação inválido");
    }
    return record;
  },

  async saveLeadContact(sessionId: string, leadId: string, organizationId: string): Promise<void> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/sessions/${segment(sessionId)}/contacts/save`,
      { method: "POST", organizationId, body: { leadId } },
    );
    whatsappContactSaveResponseSchema.parse(response);
  },

  async saveConversationContact(conversationId: string, fullName: string, organizationId: string): Promise<void> {
    const response = await vimobAPIRequest<unknown>(
      `/v1/whatsapp/conversations/${segment(conversationId)}/contacts/save`,
      { method: "POST", organizationId, body: { fullName: whatsappContactNameSchema.parse(fullName) } },
    );
    whatsappContactSaveResponseSchema.parse(response);
  },
};
