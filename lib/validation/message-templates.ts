import { z } from "zod";
import { apiEnvelopeSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";


export const messageTemplateCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    content: z.string().trim().min(1).max(20_000),
    category: z.string().trim().max(120).optional(),
    variables: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .strict();
export const messageTemplateUpdateInputSchema = messageTemplateCreateInputSchema
  .partial()
  .omit({ variables: true })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Informe ao menos uma alteracao",
  );
const messageTemplateSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    content: z.string(),
    category: z.string(),
    variables: z.array(z.string()),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .passthrough();
export const apiMessageTemplateResponseSchema = apiEnvelopeSchema(
  messageTemplateSchema,
);
export const apiMessageTemplateListResponseSchema = apiEnvelopeSchema(
  z.array(messageTemplateSchema),
);
