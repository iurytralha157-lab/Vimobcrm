import { z } from "zod";
import { optionalUUID } from "@/lib/validation/shared-schema-values";
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";


export const outgoingWebhookEventSchema = z.enum([
  "lead.created",
  "lead.reentered",
]);

const outgoingWebhookURLSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Use uma URL HTTPS",
  });

const webhookMutationSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    type: z.enum(["incoming", "outgoing"]),
    target_pipeline_id: optionalUUID,
    target_team_id: optionalUUID,
    target_stage_id: optionalUUID,
    target_tag_ids: z.array(uuidSchema).max(500).optional(),
    target_property_id: optionalUUID,
    field_mapping: z
      .record(z.string(), z.string().trim().min(1).max(120))
      .superRefine((value, ctx) => {
        if (Object.keys(value).length > 100) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Use no maximo 100 mapeamentos",
          });
        }
        if (
          Object.keys(value).some(
            (key) => key.trim().length === 0 || key.trim().length > 120,
          )
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Nomes de mapeamento devem ter entre 1 e 120 caracteres",
          });
        }
      })
      .optional(),
    webhook_url: outgoingWebhookURLSchema.nullish(),
    trigger_events: z
      .array(outgoingWebhookEventSchema)
      .max(2)
      .refine((events) => new Set(events).size === events.length, {
        message: "Eventos duplicados nao sao permitidos",
      })
      .optional(),
  })
  .strict();
export const webhookCreateInputSchema = webhookMutationSchema.superRefine(
  (input, ctx) => {
    if (input.type === "outgoing") {
      if (!input.webhook_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["webhook_url"],
          message: "URL obrigatoria para webhook de saida",
        });
      }
      if (!input.trigger_events?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trigger_events"],
          message: "Selecione ao menos um evento",
        });
      }
    } else if (input.webhook_url || input.trigger_events?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["webhook_url"],
        message: "Webhook de entrada nao aceita destino de saida",
      });
    }
  },
);
export const webhookUpdateInputSchema = webhookMutationSchema
  .omit({ type: true })
  .partial()
  .extend({
    id: uuidSchema,
    is_active: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 1,
    "Informe ao menos uma alteracao",
  );

export const publicAPIIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[\x21-\x7E]+$/);

export const publicAPILeadInputSchema = z
  .object({
    name: z.string().trim().min(2).max(180),
    phone: z.string().trim().max(32),
    email: z.string().trim().email().max(320).optional(),
    message: z.string().trim().max(10_000).optional(),
    property_id: uuidSchema.optional(),
    property_code: z.string().trim().max(120).optional(),
    source_detail: z.string().trim().max(240).optional(),
    campaign_id: z.string().trim().max(240).optional(),
    campaign_name: z.string().trim().max(500).optional(),
    adset_id: z.string().trim().max(240).optional(),
    adset_name: z.string().trim().max(500).optional(),
    ad_id: z.string().trim().max(240).optional(),
    ad_name: z.string().trim().max(500).optional(),
    form_id: z.string().trim().max(240).optional(),
    form_name: z.string().trim().max(500).optional(),
    utm_source: z.string().trim().max(500).optional(),
    utm_medium: z.string().trim().max(500).optional(),
    utm_campaign: z.string().trim().max(500).optional(),
    utm_content: z.string().trim().max(500).optional(),
    utm_term: z.string().trim().max(500).optional(),
    occurred_at: z.string().trim().datetime({ offset: true }).optional(),
    custom_fields: z
      .record(z.string(), z.string().trim().max(1_000))
      .superRefine((value, ctx) => {
        if (Object.keys(value).length > 50) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Use no maximo 50 campos personalizados",
          });
        }
        if (
          Object.keys(value).some(
            (key) => key.trim().length === 0 || key.trim().length > 120,
          )
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Nomes de campos personalizados devem ter entre 1 e 120 caracteres",
          });
        }
      })
      .optional(),
  })
  .strict()
  .refine(
    (value) => {
      const digits = value.phone.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15;
    },
    {
      path: ["phone"],
      message: "Telefone deve ter entre 10 e 15 digitos",
    },
  );
const webhookSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    type: z.enum(["incoming", "outgoing"]),
    api_token: z.string(),
    is_active: z.boolean(),
    leads_received: nonNegativeIntegerSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .passthrough();
export const apiWebhookResponseSchema = apiEnvelopeSchema(webhookSchema);
export const apiWebhookListResponseSchema = apiEnvelopeSchema(
  z.array(webhookSchema),
);
