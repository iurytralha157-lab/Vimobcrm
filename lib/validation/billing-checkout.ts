import { z } from "zod";
import { uuidSchema } from "@/lib/validation/common";
import { safePathSegmentSchema } from "@/lib/validation/final-domains";


export const paymentCheckoutQuerySchema = z
  .object({
    token: z.string().trim().min(8).max(2_000).nullish(),
    organization_id: uuidSchema.nullish(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.token || value.organization_id),
    "Informe token ou organização",
  );
export const checkoutBillingProfileSessionSchema = z
  .object({
    organization_id: uuidSchema,
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(180),
    cpf_cnpj: z.string().trim().max(32),
    phone: z.string().trim().max(32),
    created_at: z.number().int().nonnegative(),
  })
  .strict();
export const checkoutBillingDraftSessionSchema = z
  .object({
    checkout_token: z
      .string()
      .trim()
      .regex(/^(?:[a-f0-9]{32}|[a-f0-9]{48}|[a-f0-9]{64})$/i),
    organization_id: uuidSchema,
    name: z.string().max(200),
    email: z.string().max(320),
    cpf_cnpj: z.string().max(32),
    phone: z.string().max(32),
    country: z.literal("BR"),
    postal_code: z.string().max(20),
    address: z.string().max(200),
    address_number: z.string().max(40),
    address_complement: z.string().max(120),
    neighborhood: z.string().max(120),
    city: z.string().max(120),
    state: z.string().max(2),
    updated_at: z.number().int().nonnegative(),
  })
  .strict();
export const paymentStatusQuerySchema = z
  .object({
    checkout_token: z.string().trim().min(8).max(2_000).optional(),
    organization_id: uuidSchema.optional(),
    intent_id: safePathSegmentSchema.nullish(),
    payment_id: safePathSegmentSchema.nullish(),
    subscription_id: safePathSegmentSchema.nullish(),
    card_update_job_id: uuidSchema.nullish(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.checkout_token) !== Boolean(value.organization_id),
    "Informe somente o checkout ou a organização",
  );
export const paymentMutationInputSchema = z
  .object({
    checkout_token: z.string().trim().min(8).max(2_000).optional(),
    organization_id: uuidSchema.optional(),
    intent_id: safePathSegmentSchema.nullish(),
    payment_id: safePathSegmentSchema.nullish(),
    subscription_id: safePathSegmentSchema.nullish(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.checkout_token) !== Boolean(value.organization_id),
    "Informe somente o checkout ou a organização",
  );
