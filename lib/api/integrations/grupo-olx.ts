import {
  apiGrupoOLXImportReportListResponseSchema,
  apiGrupoOLXImportReportResponseSchema,
  apiGrupoOLXIntegrationResponseSchema,
  apiGrupoOLXPublicationListResponseSchema,
  apiOptionalGrupoOLXIntegrationResponseSchema,
  grupoOLXIntegrationInputSchema,
  grupoOLXPublicationsInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest } from '@/lib/api/vimob-client';

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

export const grupoOLXIntegrationsAPI = {
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
};
