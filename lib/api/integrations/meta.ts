import {
  apiIntegrationListResponseSchema,
  apiIntegrationResponseSchema,
  apiMetaWebhookHealthResponseSchema,
  deleteMetaFormConfigInputSchema,
  metaConversionFeedbackInputSchema,
  metaFormConfigInputSchema,
  metaMarketingSyncInputSchema,
  metaMarketingSyncResponseSchema,
  metaLeadRecoveryPreviewInputSchema,
  metaLeadRecoveryApplyInputSchema,
  metaLeadRecoveryPreviewResponseSchema,
  metaLeadRecoveryApplyResponseSchema,
  metaPageFormsActionResponseSchema,
  parseDomainInput,
  sendMetaMessageInputSchema,
  toggleMetaFormConfigInputSchema,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest } from '@/lib/api/vimob-client';
import type { Envelope, IntegrationJSON } from './shared';

// A Marketing import can legitimately paginate several Meta resources and the
// server bounds one window at 135 seconds. Keep the browser deadline slightly
// above that contract instead of inheriting the generic 12-second API timeout.
const META_MARKETING_SYNC_TIMEOUT_MS = 150_000;
// The connect action can use the backend's full 45-second budget while it
// validates the Page, subscribes its webhook and persists the integration.
const META_OAUTH_CONNECT_TIMEOUT_MS = 60_000;
const META_LEAD_RECOVERY_TIMEOUT_MS = 90_000;

export const metaIntegrationsAPI = {
  async metaOAuthAction<T>(body: Record<string, unknown>, organizationId?: string | null) {
    return vimobAPIRequest<T>('/v1/integrations/meta/oauth/actions', {
      method: 'POST',
      organizationId,
      body,
      ...(body.action === 'connect_page' ? { timeoutMs: META_OAUTH_CONNECT_TIMEOUT_MS } : {}),
    });
  },

  async syncMetaMarketing(input: unknown, organizationId?: string | null) {
    const body = parseDomainInput(
      metaMarketingSyncInputSchema,
      input,
      'integrations.meta.marketing.sync',
    );
    const response = await vimobAPIRequest<unknown>('/v1/integrations/meta/marketing/sync', {
      method: 'POST',
      organizationId,
      body,
      timeoutMs: META_MARKETING_SYNC_TIMEOUT_MS,
    });
    return validateDomainResponse(
      metaMarketingSyncResponseSchema,
      response,
      'integrations.meta.marketing.sync',
    );
  },

  async listMetaIntegrations(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/meta', {
      organizationId,
    });
    validateDomainResponse(apiIntegrationListResponseSchema, response, 'integrations.meta.list');
    return response.data;
  },

  async saveMetaConversionFeedback(
    input: {
      integrationId: string;
      datasetId?: string | null;
      datasetName?: string | null;
      datasetAccessToken?: string | null;
      enabled: boolean;
      replayRecentFacts: boolean;
      testEventCode?: string;
    },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(
      metaConversionFeedbackInputSchema,
      input,
      'integrations.meta.conversion-feedback.save',
    );
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>(
      '/v1/integrations/meta/conversion-feedback',
      {
        method: 'PUT',
        organizationId,
        body,
      },
    );
    validateDomainResponse(
      apiIntegrationResponseSchema,
      response,
      'integrations.meta.conversion-feedback.save',
    );
    return response.data;
  },

  async getMetaOAuthFlow(flowId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>(`/v1/integrations/meta/oauth-flows/${flowId}`, {
      organizationId,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.meta.oauth-flow');
    return response.data;
  },

  async listMetaPageForms(pageId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      `/v1/integrations/meta/pages/${encodeURIComponent(pageId)}/forms`,
      { organizationId },
    );
    return validateDomainResponse(
      metaPageFormsActionResponseSchema,
      response,
      'integrations.meta.page-forms.list',
    );
  },

  async previewMetaLeadRecovery(pageId: string, formId: string, input: { date: string }, organizationId?: string | null) {
    const body = parseDomainInput(metaLeadRecoveryPreviewInputSchema, input, 'integrations.meta.lead-recovery.preview');
    const response = await vimobAPIRequest<unknown>(
      `/v1/integrations/meta/pages/${encodeURIComponent(pageId)}/forms/${encodeURIComponent(formId)}/leads/recovery-preview`,
      { method: 'POST', organizationId, body, timeoutMs: META_LEAD_RECOVERY_TIMEOUT_MS },
    );
    return validateDomainResponse(metaLeadRecoveryPreviewResponseSchema, response, 'integrations.meta.lead-recovery.preview');
  },

  async recoverMetaLead(pageId: string, formId: string, input: { date: string; leadgenId: string }, organizationId?: string | null) {
    const body = parseDomainInput(metaLeadRecoveryApplyInputSchema, input, 'integrations.meta.lead-recovery.apply');
    const response = await vimobAPIRequest<unknown>(
      `/v1/integrations/meta/pages/${encodeURIComponent(pageId)}/forms/${encodeURIComponent(formId)}/leads/recover`,
      { method: 'POST', organizationId, body, timeoutMs: META_LEAD_RECOVERY_TIMEOUT_MS },
    );
    return validateDomainResponse(metaLeadRecoveryApplyResponseSchema, response, 'integrations.meta.lead-recovery.apply');
  },

  async listMetaFormConfigs(integrationId?: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/meta/form-configs', {
      organizationId,
      query: { integrationId },
    });
    validateDomainResponse(apiIntegrationListResponseSchema, response, 'integrations.meta.form-configs.list');
    return response.data;
  },

  async saveMetaFormConfig(input: IntegrationJSON, organizationId?: string | null) {
    const body = parseDomainInput(metaFormConfigInputSchema, input, 'integrations.meta.form-configs.save');
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/meta/form-configs', {
      method: 'POST',
      organizationId,
      body,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.meta.form-configs.save');
    return response.data;
  },

  async toggleMetaFormConfig(input: { integrationId: string; formId: string; isActive: boolean }, organizationId?: string | null) {
    const body = parseDomainInput(toggleMetaFormConfigInputSchema, input, 'integrations.meta.form-configs.toggle');
    return vimobAPIRequest<{ ok: boolean }>('/v1/integrations/meta/form-configs', {
      method: 'PATCH',
      organizationId,
      body,
    });
  },

  async deleteMetaFormConfig(input: { integrationId: string; formId: string }, organizationId?: string | null) {
    const query = parseDomainInput(deleteMetaFormConfigInputSchema, input, 'integrations.meta.form-configs.delete');
    await vimobAPIRequest<null>('/v1/integrations/meta/form-configs', {
      method: 'DELETE',
      organizationId,
      query,
    });
  },

  async metaWebhookHealth(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<{ counts: Record<string, number>; lastError: string | null; missing: boolean }>>(
      '/v1/integrations/meta/webhook-health',
      { organizationId },
    );
    validateDomainResponse(apiMetaWebhookHealthResponseSchema, response, 'integrations.meta.webhook-health');
    return response.data;
  },

  async listMetaConversations<T = IntegrationJSON>(pageId?: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/integrations/meta/conversations', {
      organizationId,
      query: { pageId },
    });
    return response.data;
  },

  async listMetaMessages<T = IntegrationJSON>(conversationId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/integrations/meta/conversations/${conversationId}/messages`, {
      organizationId,
    });
    return response.data;
  },

  async sendMetaMessage<T = IntegrationJSON>(
    conversationId: string,
    input: { text: string; idempotencyKey: string },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(sendMetaMessageInputSchema, input, 'integrations.meta.messages.send');
    const response = await vimobAPIRequest<Envelope<T>>(
      `/v1/integrations/meta/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        organizationId,
        body,
      },
    );
    return response.data;
  },
};
