import { z } from "zod";
import { nonNegativeIntegerSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";
import { dynamicRecordSchema } from "@/lib/validation/final-domains";


export const auditLogFiltersSchema = z
  .object({
    organizationId: uuidSchema.optional(),
    userId: uuidSchema.optional(),
    action: z.string().trim().max(120).optional(),
    entityType: z.string().trim().max(120).optional(),
    startDate: timestampSchema.optional(),
    endDate: timestampSchema.optional(),
  })
  .strict();
export const auditLogListInputSchema = z
  .object({
    filters: auditLogFiltersSchema.optional(),
    page: z.number().int().min(1).max(10_000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    organizationId: uuidSchema.nullish(),
  })
  .strict();
const auditLogSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema.nullish(),
    user_id: uuidSchema.nullish(),
    action: z.string(),
    entity_type: z.string(),
    entity_id: z.string().nullish(),
    old_data: dynamicRecordSchema.nullish(),
    new_data: dynamicRecordSchema.nullish(),
    diff: dynamicRecordSchema.nullish(),
    source: z.string().nullish(),
    metadata: dynamicRecordSchema.nullish(),
    ip_address: z.string().nullish(),
    user_agent: z.string().nullish(),
    created_at: timestampSchema,
  })
  .passthrough();
export const apiAuditLogListResponseSchema = z
  .object({
    data: z.array(auditLogSchema),
    count: nonNegativeIntegerSchema,
    totalPages: nonNegativeIntegerSchema,
  })
  .passthrough();

export const auditFeedEventPayloadSchema = z
  .object({
    organizationId: uuidSchema,
  })
  .passthrough();
