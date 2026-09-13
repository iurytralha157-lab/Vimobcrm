import { vimobAPIRequest } from '@/lib/api/vimob-client';

export const integrationFunctionsAPI = {
  async invokeFunction<T>(name: string, body: Record<string, unknown>, organizationId?: string | null) {
    return vimobAPIRequest<T>(`/v1/integrations/functions/${name}`, {
      method: 'POST',
      organizationId,
      body,
    });
  },
};
