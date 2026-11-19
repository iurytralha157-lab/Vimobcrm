import { z } from "zod";
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";
import { finiteNullableNumber, jsonValueSchema, nullableString } from "@/lib/validation/shared-schema-values";


const conversationLeadDetailSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    phone: nullableString,
    email: nullableString,
    created_at: timestampSchema,
    updated_at: z.string().datetime({ offset: true }).optional(),
    deal_status: z.string(),
    tags: z.array(
      z
        .object({
          tag: z
            .object({ id: uuidSchema, name: z.string(), color: z.string() })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const apiConversationLeadDetailResponseSchema = apiEnvelopeSchema(
  conversationLeadDetailSchema,
);

export const leadAttachmentCreateInputSchema = z
  .object({
    lead_id: uuidSchema,
    file_name: z.string().trim().min(1).max(500),
    file_url: z.string().trim().url().max(4_000),
    file_type: z.string().trim().max(255).optional(),
    file_size: z
      .number()
      .int()
      .min(0)
      .max(1024 * 1024 * 1024)
      .optional(),
    message_id: uuidSchema.optional(),
  })
  .strict();
const leadAttachmentSchema = z
  .object({
    id: uuidSchema,
    lead_id: uuidSchema,
    file_name: z.string(),
    file_url: z.string().nullable(),
    availability: z.enum(['ready', 'signing_unavailable', 'not_requested']).optional(),
    file_type: nullableString,
    file_size: z.number().int().min(0).nullable(),
    created_at: timestampSchema,
    created_by: uuidSchema.nullable(),
    message_id: uuidSchema.nullable(),
  })
  .passthrough().superRefine((attachment, ctx) => {
    if ((attachment.availability === 'signing_unavailable' || attachment.availability === 'not_requested') && attachment.file_url !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file_url'], message: 'Documento indisponível não deve expor uma URL' });
    if (attachment.availability === 'ready' && !attachment.file_url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file_url'], message: 'Documento disponível exige uma URL' });
  });
export const apiLeadAttachmentResponseSchema =
  apiEnvelopeSchema(leadAttachmentSchema);
export const apiLeadAttachmentListResponseSchema = apiEnvelopeSchema(
  z.array(leadAttachmentSchema),
);

const leadEnrichmentSchema = z
  .object({
    lead_id: uuidSchema,
    tags: z.array(
      z
        .object({ id: uuidSchema, name: nullableString, color: nullableString })
        .passthrough(),
    ),
    tasks_count: z
      .object({
        pending: nonNegativeIntegerSchema,
        completed: nonNegativeIntegerSchema,
      })
      .passthrough(),
    assignee: z
      .object({
        id: uuidSchema,
        name: nullableString,
        avatar_url: nullableString,
      })
      .passthrough()
      .nullable(),
    interest_property: z
      .object({
        id: uuidSchema,
        code: nullableString,
        title: nullableString,
        preco: finiteNullableNumber,
      })
      .passthrough()
      .nullable(),
    lead_meta: z.array(z.object({ lead_id: uuidSchema }).passthrough()),
  })
  .passthrough();
export const apiLeadEnrichmentListResponseSchema = apiEnvelopeSchema(
  z.array(leadEnrichmentSchema),
);
const leadMetaSchema = z
  .object({
    id: uuidSchema,
    lead_id: uuidSchema,
    raw_payload: jsonValueSchema,
    created_at: timestampSchema,
  })
  .passthrough();
export const apiLeadMetaResponseSchema = apiEnvelopeSchema(
  leadMetaSchema.nullable(),
);

export const leadTaskTypeSchema = z.enum(["call", "message", "email", "note"]);
export const leadTaskCreateInputSchema = z
  .object({
    lead_id: uuidSchema,
    day_offset: z.number().int().min(0).max(3_650),
    type: leadTaskTypeSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().max(10_000).optional(),
    due_date: timestampSchema.optional(),
  })
  .strict();
export const leadTaskPatchInputSchema = z
  .object({
    is_done: z.boolean().optional(),
    outcome: z.string().trim().max(500).optional(),
    outcome_notes: z.string().max(10_000).optional(),
    leadId: uuidSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Informe ao menos uma alteracao",
  );
export const cadenceTaskCompletionInputSchema = z
  .object({
    leadId: uuidSchema,
    taskId: uuidSchema.optional(),
    templateTaskId: uuidSchema.optional(),
    dayOffset: z.number().int().min(0).max(3_650).optional(),
    type: leadTaskTypeSchema.optional(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(10_000).optional(),
    outcome: z.string().trim().max(500).optional(),
      outcomeNotes: z.string().refine(value => Array.from(value.trim()).length <= 1_000,
        'Use até 1.000 caracteres nas anotações do resultado.').optional(),
  })
  .strict()
  .refine((value) => Boolean(value.taskId || value.templateTaskId), {
    path: ["taskId"],
    message: "Informe a tarefa materializada ou a tarefa do modelo",
  });
const leadTaskSchema = z
  .object({ id: uuidSchema, lead_id: uuidSchema })
  .passthrough();
export const apiLeadTaskResponseSchema = apiEnvelopeSchema(leadTaskSchema);
export const apiLeadTaskListResponseSchema = apiEnvelopeSchema(
  z.array(leadTaskSchema),
);
export const apiLeadVisibilityResponseSchema = apiEnvelopeSchema(
  z
    .object({
      canViewAll: z.boolean(),
      teamMemberIds: z.array(uuidSchema).optional(),
      userId: uuidSchema.optional(),
    })
    .passthrough(),
);
