import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import { readContactPageResponse } from '@/lib/api/contact-page-response'
import type { Contact, ContactListFilters } from '@/hooks/use-contacts-list'
import { apiContactListResponseSchema, contactListQuerySchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

type Envelope<T> = {
  data: T
}

export type ContactPage = {
  data: Contact[]
  total: number
  page: number
  limit: number
  exportVersion?: string
}

export const contactsAPI = {
  async listPage(
    filters: ContactListFilters & { expectedExportVersion?: string },
    organizationId?: string | null,
    options?: VimobAPIRequestIntent,
  ): Promise<ContactPage> {
    const parsedQuery = parseDomainInput(contactListQuerySchema, {
      ...filters, page: filters.page ?? 1, limit: filters.limit ?? 25,
      mode: filters.mode || 'compact', responseMode: 'page',
    }, 'contacts.list-page')
    const { tagIds, ...query } = parsedQuery
    const requestOptions = {
      ...options,
      organizationId,
      query: { ...query, tagIds: tagIds?.join(',') },
    }
    const assertActive = () => {
      if (requestOptions.signal?.aborted) throw new DOMException('Leitura de contatos cancelada', 'AbortError')
    }
    const pageRequest = { mode: parsedQuery.mode, page: parsedQuery.page!, limit: parsedQuery.limit! }
    const response = await vimobAPIRequest<unknown>('/v1/contacts', requestOptions)
    assertActive()
    const read = readContactPageResponse(response, pageRequest)
    if (read.kind === 'page') return read.page
    let total = read.total
    if (total === null) {
      // An empty later legacy page has no row carrying total_count. Read just
      // one first-page row with the same filters, organization and request intent.
      const countResponse = await vimobAPIRequest<unknown>('/v1/contacts', {
        ...requestOptions, query: { ...requestOptions.query, page: 1, limit: 1 },
      })
      assertActive()
      const countRead = readContactPageResponse(countResponse, { ...pageRequest, page: 1, limit: 1 })
      total = countRead.kind === 'page' ? countRead.page.total : countRead.total!
    }
    return { data: read.data, total, page: pageRequest.page, limit: pageRequest.limit }
  },
  async list(
    filters: ContactListFilters,
    organizationId?: string | null,
    options?: VimobAPIRequestIntent,
  ) {
    const parsedQuery = parseDomainInput(contactListQuerySchema, { ...filters, mode: filters.mode || 'compact' }, 'contacts.list')
    const { tagIds, ...query } = parsedQuery
    const response = await vimobAPIRequest<Envelope<Contact[]>>('/v1/contacts', {
      ...options,
      organizationId,
      query: {
        ...query,
        tagIds: tagIds?.join(','),
      },
    })
    validateDomainResponse(apiContactListResponseSchema, response, 'contacts.list')

    return response.data
  },
}
