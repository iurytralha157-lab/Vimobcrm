import { vimobAPIRequest } from './vimob-client';
import { apiWebhookListResponseSchema, apiWebhookResponseSchema, entityIdSchema, parseDomainInput, validateDomainResponse, webhookCreateInputSchema, webhookUpdateInputSchema } from '@/lib/validation';

type Envelope<T> = {
  data: T;
};

export type WebhookIntegration = {
  id: string;
  organization_id: string;
  name: string;
  type: 'incoming' | 'outgoing';
  api_token: string;
  webhook_url: string | null;
  target_pipeline_id: string | null;
  target_team_id: string | null;
  target_stage_id: string | null;
  target_tag_ids: string[];
  target_property_id: string | null;
  field_mapping: Record<string, string>;
  is_active: boolean;
  leads_received: number;
  last_lead_at: string | null;
  last_triggered_at: string | null;
  trigger_events: string[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
  pipeline?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
  stage?: { id: string; name: string; color: string } | null;
  property?: { id: string; code: string; title: string | null } | null;
  creator?: { id: string; name: string } | null;
};

export type CreateWebhookInput = {
  name: string;
  type: 'incoming' | 'outgoing';
  target_pipeline_id?: string | null;
  target_team_id?: string | null;
  target_stage_id?: string | null;
  target_tag_ids?: string[];
  target_property_id?: string | null;
  field_mapping?: Record<string, string>;
  webhook_url?: string | null;
  trigger_events?: string[];
};

export type UpdateWebhookInput = Partial<CreateWebhookInput> & {
  id: string;
  is_active?: boolean;
};

export const webhooksAPI = {
  async list(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<WebhookIntegration[]>>('/v1/webhooks', {
      organizationId,
    });
    validateDomainResponse(apiWebhookListResponseSchema, response, 'webhooks.list');
    return response.data;
  },

  async create(input: CreateWebhookInput, organizationId?: string | null) {
    const body = parseDomainInput(webhookCreateInputSchema, input, 'webhooks.create');
    const response = await vimobAPIRequest<Envelope<WebhookIntegration>>('/v1/webhooks', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiWebhookResponseSchema, response, 'webhooks.create');
    return response.data;
  },

  async update(input: UpdateWebhookInput, organizationId?: string | null) {
    const validated = parseDomainInput(webhookUpdateInputSchema, input, 'webhooks.update');
    const { id, ...body } = validated;
    const response = await vimobAPIRequest<Envelope<WebhookIntegration>>(`/v1/webhooks/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    });
    validateDomainResponse(apiWebhookResponseSchema, response, 'webhooks.update');
    return response.data;
  },

  async delete(id: string, organizationId?: string | null) {
    const webhookId = parseDomainInput(entityIdSchema, id, 'webhooks.delete.id');
    await vimobAPIRequest<null>(`/v1/webhooks/${webhookId}`, {
      method: 'DELETE',
      organizationId,
    });
  },

  async regenerateToken(id: string, organizationId?: string | null) {
    const webhookId = parseDomainInput(entityIdSchema, id, 'webhooks.regenerate-token.id');
    const response = await vimobAPIRequest<Envelope<WebhookIntegration>>(`/v1/webhooks/${webhookId}/regenerate-token`, {
      method: 'POST',
      organizationId,
    });
    validateDomainResponse(apiWebhookResponseSchema, response, 'webhooks.regenerate-token');
    return response.data;
  },
};
