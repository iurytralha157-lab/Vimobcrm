import { vimobAPIRequest } from './vimob-client'
import type { Contact, ContactListFilters } from '@/hooks/use-contacts-list'
import { apiContactListResponseSchema, contactListQuerySchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

type Envelope<T> = {
  data: T
}

// Full export pages can take longer to stream after their HTTP headers arrive.
const CONTACT_EXPORT_REQUEST_TIMEOUT_MS = 60_000

export const contactsAPI = {
  async list(
    filters: ContactListFilters,
    organizationId?: string | null,
    options?: { signal?: AbortSignal },
  ) {
    const parsedQuery = parseDomainInput(contactListQuerySchema, { ...filters, mode: filters.mode || 'compact' }, 'contacts.list')
    const { tagIds, ...query } = parsedQuery
    const response = await vimobAPIRequest<Envelope<Contact[]>>('/v1/contacts', {
      organizationId,
      query: {
        ...query,
        tagIds: tagIds?.join(','),
      },
      signal: options?.signal,
      timeoutMs: parsedQuery.mode === 'export' ? CONTACT_EXPORT_REQUEST_TIMEOUT_MS : undefined,
    })
    validateDomainResponse(apiContactListResponseSchema, response, 'contacts.list')

    return response.data
  },
}
