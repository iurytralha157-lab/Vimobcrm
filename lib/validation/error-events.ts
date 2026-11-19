import { z } from "zod";
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";
import { dynamicRecordSchema } from "@/lib/validation/final-domains";


export const errorSeveritySchema = z.enum([
  "debug",
  "info",
  "warning",
  "error",
  "critical",
]);
export const errorSourceSchema = z.enum(["frontend", "backend", "api"]);
export const reportErrorEventInputSchema = z
  .object({
    organizationId: uuidSchema.nullish(),
    requestId: z.string().max(255).optional(),
    source: errorSourceSchema.optional(),
    severity: errorSeveritySchema.optional(),
    category: z.string().max(180).optional(),
    message: z.string().trim().min(1).max(20_000),
    errorCode: z.string().max(180).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    method: z.string().max(20).optional(),
    path: z.string().max(4_000).optional(),
    route: z.string().max(4_000).optional(),
    component: z.string().max(500).optional(),
    stack: z.string().max(100_000).optional(),
    stackHash: z.string().max(255).optional(),
    fingerprint: z.string().max(500).optional(),
    url: z.string().max(4_000).optional(),
    userAgent: z.string().max(2_000).optional(),
    browserContext: dynamicRecordSchema.optional(),
    metadata: dynamicRecordSchema.optional(),
  })
  .strict();
export const errorEventFiltersSchema = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(100_000).optional(),
    search: z.string().trim().max(120).optional(),
    severity: z.union([errorSeveritySchema, z.literal("all")]).optional(),
    source: z.union([errorSourceSchema, z.literal("all")]).optional(),
    organizationId: uuidSchema.optional(),
    fingerprint: z.string().max(160).optional(),
    unresolved: z.boolean().optional(),
  })
  .strict();
const errorEventSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema.optional(),
    userId: uuidSchema.optional(),
    requestId: z.string().max(160).optional(),
    source: errorSourceSchema,
    severity: errorSeveritySchema,
    category: z.string().max(80).optional(),
    message: z.string().max(2_000),
    errorCode: z.string().max(120).optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    method: z.string().max(12).optional(),
    path: z.string().max(500).optional(),
    route: z.string().max(500).optional(),
    component: z.string().max(180).optional(),
    stack: z.string().max(8_000).optional(),
    stackHash: z.string().max(80).optional(),
    fingerprint: z.string().max(160),
    url: z.string().max(1_000).optional(),
    userAgent: z.string().max(500).optional(),
    browserContext: dynamicRecordSchema,
    metadata: dynamicRecordSchema,
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.optional(),
    resolvedBy: uuidSchema.optional(),
    resolutionNote: z.string().max(500).optional(),
  })
  .passthrough();
export const apiErrorEventResponseSchema = apiEnvelopeSchema(errorEventSchema);
export const apiErrorEventListResponseSchema = z
  .object({
    data: z.array(errorEventSchema),
    total: nonNegativeIntegerSchema,
    limit: nonNegativeIntegerSchema,
    offset: nonNegativeIntegerSchema,
  })
  .passthrough();
