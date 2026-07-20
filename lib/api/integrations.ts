import {
  apiIntegrationListResponseSchema,
  apiIntegrationResponseSchema,
  apiMetaWebhookHealthResponseSchema,
  apiOptionalIntegrationResponseSchema,
  deleteMetaFormConfigInputSchema,
  grupoOLXIntegrationInputSchema,
  grupoOLXPublicationsInputSchema,
  imoviewIntegrationInputSchema,
  parseDomainInput,
  toggleMetaFormConfigInputSchema,
  validateDomainResponse,
  vistaIntegrationInputSchema,
  metaFormConfigInputSchema,
} from '@/lib/validation';
import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type IntegrationJSON = Record<string, unknown>;

export type GrupoOLXIntegrationInput = {
  isActive?: boolean;
  leadWebhookSecret?: string;
  defaultPipelineId?: string | null;
  defaultStageId?: string | null;
  defaultAssignedUserId?: string | null;
  defaultRoundRobinId?: string | null;
  settings?: Record<string, unknown>;
};

export type GrupoOLXPublicationInput = {
  propertyId: string;
  clientListingId?: string;
  publicationType?: string;
  isEnabled?: boolean;
};

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
    validateDomainResponse(apiOptionalIntegrationResponseSchema, response, 'integrations.vista.get');
    return response.data;
  },

  async saveVista(input: { api_url: string; api_key: string }, organizationId?: string | null) {
    const body = parseDomainInput(vistaIntegrationInputSchema, input, 'integrations.vista.save');
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/vista', {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.vista.save');
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
    validateDomainResponse(apiOptionalIntegrationResponseSchema, response, 'integrations.imoview.get');
    return response.data;
  },

  async saveImoview(input: { api_key: string }, organizationId?: string | null) {
    const body = parseDomainInput(imoviewIntegrationInputSchema, input, 'integrations.imoview.save');
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/imoview', {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.imoview.save');
    return response.data;
  },

  async deleteImoview(organizationId?: string | null) {
    await vimobAPIRequest<null>('/v1/integrations/imoview', {
      method: 'DELETE',
      organizationId,
    });
  },

  async getGrupoOLX(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON | null>>('/v1/integrations/portals/grupo-olx', {
      organizationId,
    });
    validateDomainResponse(apiOptionalIntegrationResponseSchema, response, 'integrations.grupo-olx.get');
    return response.data;
  },

  async saveGrupoOLX(input: GrupoOLXIntegrationInput, organizationId?: string | null) {
    const body = parseDomainInput(grupoOLXIntegrationInputSchema, input, 'integrations.grupo-olx.save');
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/portals/grupo-olx', {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.grupo-olx.save');
    return response.data;
  },

  async activateGrupoOLX(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/portals/grupo-olx/activate', {
      method: 'POST',
      organizationId,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.grupo-olx.activate');
    return response.data;
  },

  async regenerateGrupoOLXFeedToken(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/portals/grupo-olx/regenerate-feed-token', {
      method: 'POST',
      organizationId,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.grupo-olx.regenerate-feed-token');
    return response.data;
  },

  async regenerateGrupoOLXWebhookToken(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>('/v1/integrations/portals/grupo-olx/regenerate-webhook-token', {
      method: 'POST',
      organizationId,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.grupo-olx.regenerate-webhook-token');
    return response.data;
  },

  async listGrupoOLXPublications(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/portals/grupo-olx/publications', {
      organizationId,
    });
    validateDomainResponse(apiIntegrationListResponseSchema, response, 'integrations.grupo-olx.publications.list');
    return response.data;
  },

  async saveGrupoOLXPublications(input: { publications: GrupoOLXPublicationInput[] }, organizationId?: string | null) {
    const body = parseDomainInput(grupoOLXPublicationsInputSchema, input, 'integrations.grupo-olx.publications.save');
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/portals/grupo-olx/publications', {
      method: 'PUT',
      organizationId,
      body,
    });
    validateDomainResponse(apiIntegrationListResponseSchema, response, 'integrations.grupo-olx.publications.save');
    return response.data;
  },

  async listMetaIntegrations(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON[]>>('/v1/integrations/meta', {
      organizationId,
    });
    validateDomainResponse(apiIntegrationListResponseSchema, response, 'integrations.meta.list');
    return response.data;
  },

  async getMetaOAuthFlow(flowId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<IntegrationJSON>>(`/v1/integrations/meta/oauth-flows/${flowId}`, {
      organizationId,
    });
    validateDomainResponse(apiIntegrationResponseSchema, response, 'integrations.meta.oauth-flow');
    return response.data;
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
};
