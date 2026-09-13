import { vimobAPIRequest } from '@/lib/api/vimob-client'
import {
  apiOrganizationPresenceResponseSchema,
  organizationPresenceListInputSchema,
  parseDomainInput,
  validateDomainResponse,
  type OrganizationPresenceData,
} from '@/lib/validation'

type UserPresenceListOptions = {
  signal?: AbortSignal
}
export const userPresenceAPI = {
  async list(
    organizationId: string,
    options: UserPresenceListOptions = {},
  ): Promise<OrganizationPresenceData> {
    const input = parseDomainInput(
      organizationPresenceListInputSchema,
      { organizationId },
      'user-presence.list',
    )

    const response = await vimobAPIRequest<unknown>('/v1/user-presence', {
      organizationId: input.organizationId,
      signal: options.signal,
    })

    return validateDomainResponse(
      apiOrganizationPresenceResponseSchema,
      response,
      'user-presence.list',
    ).data
  },
}
