import {
  apiGrupoOLXImportReportListResponseSchema,
  apiGrupoOLXImportReportResponseSchema,
  apiGrupoOLXIntegrationResponseSchema,
  apiGrupoOLXPublicationListResponseSchema,
  apiIntegrationListResponseSchema,
  apiIntegrationResponseSchema,
  apiMetaWebhookHealthResponseSchema,
  apiOptionalGrupoOLXIntegrationResponseSchema,
  apiOptionalIntegrationResponseSchema,
  deleteMetaFormConfigInputSchema,
  grupoOLXIntegrationInputSchema,
  grupoOLXPublicationsInputSchema,
  imoviewIntegrationInputSchema,
  metaMarketingSyncInputSchema,
  metaMarketingSyncResponseSchema,
  parseDomainInput,
  toggleMetaFormConfigInputSchema,
  validateDomainResponse,
  vistaIntegrationInputSchema,
  metaFormConfigInputSchema,
  metaConversionFeedbackInputSchema,
  sendMetaMessageInputSchema,
} from '@/lib/validation';
import { vimobAPIRequest } from './vimob-client';

type Envelope<T> = {
  data: T;
};

export type IntegrationJSON = Record<string, unknown>;

export type GrupoOLXIntegrationInput = {
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
};

export const integrationsAPI = {
  async invokeFunction<T>(name: string, body: Record<string, unknown>, organizationId?: string | null) {
    return vimobAPIRequest<T>(`/v1/integrations/functions/${name}`, {
      method: 'POST',
      organizationId,
      body,
    });
  },

  async metaOAuthAction<T>(body: Record<string, unknown>, organizationId?: string | null) {
    return vimobAPIRequest<T>('/v1/integrations/meta/oauth/actions', {
      method: 'POST',
      organizationId,
      body,
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
    });
    return validateDomainResponse(
      metaMarketingSyncResponseSchema,
      response,
      'integrations.meta.marketing.sync',
    );
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
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx', {
      organizationId,
    });
    return validateDomainResponse(
      apiOptionalGrupoOLXIntegrationResponseSchema,
      response,
      'integrations.grupo-olx.get',
    ).data;
  },

  async saveGrupoOLX(input: GrupoOLXIntegrationInput, organizationId?: string | null) {
    const body = parseDomainInput(grupoOLXIntegrationInputSchema, input, 'integrations.grupo-olx.save');
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx', {
      method: 'PUT',
      organizationId,
      body,
    });
    return validateDomainResponse(apiGrupoOLXIntegrationResponseSchema, response, 'integrations.grupo-olx.save').data;
  },

  async activateGrupoOLX(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx/activate', {
      method: 'POST',
      organizationId,
    });
    return validateDomainResponse(apiGrupoOLXIntegrationResponseSchema, response, 'integrations.grupo-olx.activate').data;
  },

  async pauseGrupoOLX(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx/pause', {
      method: 'POST',
      organizationId,
    });
    return validateDomainResponse(apiGrupoOLXIntegrationResponseSchema, response, 'integrations.grupo-olx.pause').data;
  },

  async regenerateGrupoOLXFeedToken(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx/regenerate-feed-token', {
      method: 'POST',
      organizationId,
    });
    return validateDomainResponse(apiGrupoOLXIntegrationResponseSchema, response, 'integrations.grupo-olx.regenerate-feed-token').data;
  },

  async regenerateGrupoOLXWebhookToken(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx/regenerate-webhook-token', {
      method: 'POST',
      organizationId,
    });
    return validateDomainResponse(apiGrupoOLXIntegrationResponseSchema, response, 'integrations.grupo-olx.regenerate-webhook-token').data;
  },

  async listGrupoOLXPublications(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx/publications', {
      organizationId,
    });
    return validateDomainResponse(apiGrupoOLXPublicationListResponseSchema, response, 'integrations.grupo-olx.publications.list').data;
  },

  async saveGrupoOLXPublications(input: { publications: GrupoOLXPublicationInput[] }, organizationId?: string | null) {
    const body = parseDomainInput(grupoOLXPublicationsInputSchema, input, 'integrations.grupo-olx.publications.save');
    const response = await vimobAPIRequest<unknown>('/v1/integrations/portals/grupo-olx/publications', {
      method: 'PUT',
      organizationId,
      body,
    });
    return validateDomainResponse(apiGrupoOLXPublicationListResponseSchema, response, 'integrations.grupo-olx.publications.save').data;
  },

  async listGrupoOLXImportReports(organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      '/v1/integrations/portals/grupo-olx/import-reports',
      { organizationId },
    );
    return validateDomainResponse(
      apiGrupoOLXImportReportListResponseSchema,
      response,
      'integrations.grupo-olx.import-reports.list',
    ).data;
  },

  async replayGrupoOLXImportReport(reportId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<unknown>(
      `/v1/integrations/portals/grupo-olx/import-reports/${encodeURIComponent(reportId)}/replay`,
      { method: 'POST', organizationId },
    );
    return validateDomainResponse(
      apiGrupoOLXImportReportResponseSchema,
      response,
      'integrations.grupo-olx.import-reports.replay',
    ).data;
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

  async listMetaPageForms<T = IntegrationJSON>(pageId: string, organizationId?: string | null) {
    return vimobAPIRequest<{ forms: T[] }>(
      `/v1/integrations/meta/pages/${encodeURIComponent(pageId)}/forms`,
      { organizationId },
    );
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
