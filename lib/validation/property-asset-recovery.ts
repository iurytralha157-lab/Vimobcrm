import { z } from 'zod'
import { propertyAssetCreateInputSchema } from './property-workspace'

export const pendingPropertyAssetSchema = z.object({
  version: z.literal(1),
  actorId: z.string().min(1),
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  input: propertyAssetCreateInputSchema,
}).strict().refine(value => Boolean(value.input.storage_path), 'Pending upload requires its original path')

export type PendingPropertyAsset = z.output<typeof pendingPropertyAssetSchema>
