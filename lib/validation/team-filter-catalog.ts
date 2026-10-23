import { z } from 'zod';
import { apiEnvelopeSchema, uuidSchema } from '@/lib/validation/common';

// Filter selections do not edit teams. Keep their read projection independent
// of the revision required by the management and membership-write contracts.
export const teamFilterCatalogSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  organization_id: uuidSchema,
  is_active: z.boolean().optional(),
  members: z.array(z.object({
    user_id: uuidSchema,
    is_leader: z.boolean().optional(),
  })).optional(),
});

export const teamFilterCatalogResponseSchema = apiEnvelopeSchema(z.array(teamFilterCatalogSchema));
export type TeamFilterCatalog = z.infer<typeof teamFilterCatalogSchema>;
