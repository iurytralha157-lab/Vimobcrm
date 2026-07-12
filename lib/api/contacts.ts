import { vimobAPIRequest } from './vimob-client'
import type { Contact, ContactListFilters } from '@/hooks/use-contacts-list'
import { apiContactListResponseSchema, contactListQuerySchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

type Envelope<T> = {
  data: T
}

export const contactsAPI = {
  async list(filters: ContactListFilters, organizationId?: string | null) {
    const query = parseDomainInput(contactListQuerySchema, { ...filters, mode: filters.mode || 'compact' }, 'contacts.list')
    const response = await vimobAPIRequest<Envelope<Contact[]>>('/v1/contacts', {
      organizationId,
      query,
    })
    validateDomainResponse(apiContactListResponseSchema, response, 'contacts.list')

    return response.data
  },
}
