import {
  apiIntegrationResponseSchema,
  apiOptionalIntegrationResponseSchema,
  parseDomainInput,
  validateDomainResponse,
  vistaIntegrationInputSchema,
} from '@/lib/validation';
import { vimobAPIRequest } from '@/lib/api/vimob-client';
import type { Envelope, IntegrationJSON } from './shared';

export const vistaIntegrationsAPI = {
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
};
