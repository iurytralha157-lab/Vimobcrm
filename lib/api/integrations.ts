import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type IntegrationJSON = Record<string, unknown>;

export const integrationsAPI = {
  async invokeFunction<T>(name: string, body: Record<string, unknown>, organizationId?: string | null) {
    return vimobAPIRequest<T>(`/v1/integrations/functions/${name}`, {
      method: 'POST',
      organizationId,
      body,
    });
  },

  async getVista(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON | null>>('/v1/integrations/vista', {
      organizationId,
    });
    return response.data;
  },

  async saveVista(input: { api_url: string; api_key: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/vista', {
      method: 'PUT',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async deleteVista(organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/integrations/vista', {
      method: 'DELETE',
      organizationId,
    });
  },

  async getImoview(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON | null>>('/v1/integrations/imoview', {
      organizationId,
    });
    return response.data;
  },

  async saveImoview(input: { api_key: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/imoview', {
      method: 'PUT',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async deleteImoview(organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/integrations/imoview', {
      method: 'DELETE',
      organizationId,
    });
  },

  async listMetaIntegrations(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/meta', {
      organizationId,
    });
    return response.data;
  },

  async listMetaFormConfigs(integrationId?: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/meta/form-configs', {
      organizationId,
      query: { integrationId },
    });
    return response.data;
  },

  async saveMetaFormConfig(input: IntegrationJSON, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/meta/form-configs', {
      method: 'POST',
      organizationId,
      body: input,
    });
    return response.data;
  },

  async toggleMetaFormConfig(input: { integrationId: string; formId: string; isActive: boolean }, organizationId?: string | null) {
    return vimobAPIRequest<{ ok: boolean }>('/v1/integrations/meta/form-configs', {
      method: 'PATCH',
      organizationId,
      body: input,
    });
  },

  async deleteMetaFormConfig(input: { integrationId: string; formId: string }, organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/integrations/meta/form-configs', {
      method: 'DELETE',
      organizationId,
      query: input,
    });
  },

  async metaWebhookHealth(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<{ counts: Record<string, number>; lastError: string | null; missing: boolean }>>(
      '/v1/integrations/meta/webhook-health',
      { organizationId },
    );
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
};
