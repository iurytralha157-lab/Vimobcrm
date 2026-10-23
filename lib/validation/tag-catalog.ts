import { z } from 'zod'
import { apiEnvelopeSchema, uuidSchema } from '@/lib/validation/common'

// Pickers need no editing revision or usage counters. Older full-catalog
// responses remain readable without inventing a revision for management writes.
export const tagCatalogSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string(),
  organization_id: uuidSchema,
})

export const tagCatalogResponseSchema = apiEnvelopeSchema(z.array(tagCatalogSchema))
export type TagCatalog = z.infer<typeof tagCatalogSchema>
