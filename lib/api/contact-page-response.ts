import { z } from 'zod'
import type { Contact } from '@/hooks/use-contacts-list'
import type { ContactPage } from '@/lib/api/contacts'
import { validateDomainResponse } from '@/lib/validation/common'
import { apiContactListResponseSchema, apiContactPageResponseSchema } from '@/lib/validation/crm-support'

type PageRequest = { mode: 'compact' | 'full' | 'export'; page: number; limit: number }
type PageRead = { kind: 'page'; page: ContactPage } | { kind: 'legacy'; data: Contact[]; total: number | null }

/** Only the compact listing can use the legacy per-row count. Export stays strict. */
export function readContactPageResponse(response: unknown, request: PageRequest): PageRead {
  const hasPageFields = response !== null && typeof response === 'object'
    && ['total', 'page', 'limit', 'exportVersion'].some(key => key in response)
  if (request.mode !== 'compact' || hasPageFields) {
    validateDomainResponse(apiContactPageResponseSchema, response, 'contacts.list-page')
    return { kind: 'page', page: response as ContactPage }
  }

  const legacySchema = apiContactListResponseSchema.superRefine(({ data }, context) => {
    if (data.length === 0) return
    const total = data[0].total_count
    if (data.length > request.limit || total < (request.page - 1) * request.limit + data.length
      || data.some(contact => contact.total_count !== total)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['data'], message: 'A contagem da lista não corresponde à página recebida' })
    }
  })
  const validated = validateDomainResponse(legacySchema, response, 'contacts.list-page')
  return {
    // Keep the full legacy projection, like contactsAPI.list, after validation.
    kind: 'legacy', data: (response as { data: Contact[] }).data,
    // A later empty page cannot establish whether the entire filtered set is empty.
    total: validated.data[0]?.total_count ?? (request.page === 1 ? 0 : null),
  }
}
