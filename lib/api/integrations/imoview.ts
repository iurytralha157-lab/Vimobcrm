import {
  apiIntegrationResponseSchema,
  apiOptionalIntegrationResponseSchema,
  imoviewIntegrationInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation';
import { vimobAPIRequest } from '@/lib/api/vimob-client';
import type { Envelope, IntegrationJSON } from './shared';

export const imoviewIntegrationsAPI = {
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
};
