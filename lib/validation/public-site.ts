import { z } from "zod";

import {
  PUBLIC_SITE_SEARCH_FILTER_KEYS,
  PUBLIC_TRACKING_EVENT_TYPES,
  type PublicSiteSearchFilterKey,
} from "../site/public-tracking";
import { PUBLIC_CONTACT_SYNTHETIC_SESSION_PREFIX } from "../site/public-session";
import { uuidSchema } from "./common";

const optionalEmptyText = (maximum: number, message?: string) =>
  z.string().trim().max(maximum, message).optional().or(z.literal(""));

const optionalNullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();

const publicVisitorSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => !value.startsWith(PUBLIC_CONTACT_SYNTHETIC_SESSION_PREFIX),
    "Session id uses a reserved prefix",
  );

export const publicSiteContactSchema = z
  .object({
    organization_id: uuidSchema,
    name: z
      .string()
      .trim()
      .min(2, "Informe seu nome")
      .max(120, "Nome muito longo"),
    email: z
      .string()
      .trim()
      .email("E-mail invalido")
      .max(254, "E-mail muito longo")
      .optional()
      .or(z.literal("")),
    phone: z
      .string()
      .trim()
      .max(30, "Telefone muito longo")
      .refine(
        (value) => (value.match(/\d/g) ?? []).length >= 8,
        "Informe um telefone valido",
      ),
    message: z
      .string()
      .trim()
      .min(2, "Informe uma mensagem")
      .max(1_000, "Mensagem muito longa"),
    best_time: optionalEmptyText(80, "Horario muito longo"),
    privacy_accepted: z.literal(true, {
      errorMap: () => ({
        message: "Aceite a politica de privacidade para continuar",
      }),
    }),
    privacy_url: optionalEmptyText(300),
    property_id: uuidSchema.optional(),
    property_code: z.string().trim().max(80).optional(),
    session_id: publicVisitorSessionIdSchema.nullable().optional(),
    submission_id: z.string().trim().min(8).max(120),
    website: optionalEmptyText(200),
    landing_page: optionalEmptyText(500),
    referrer: optionalNullableText(1_000),
    utm_source: optionalNullableText(300),
    utm_medium: optionalNullableText(300),
    utm_campaign: optionalNullableText(300),
    utm_term: optionalNullableText(300),
    utm_content: optionalNullableText(300),
    gclid: optionalNullableText(300),
    fbclid: optionalNullableText(300),
  })
  .strict();

// Compatibility alias: both the form and API adapter now use the same schema
// instance instead of maintaining separate validation behavior.
export const publicContactInputSchema = publicSiteContactSchema;

export type PublicSiteContactInput = z.infer<typeof publicSiteContactSchema>;

const publicSearchFilterShape = Object.fromEntries(
  PUBLIC_SITE_SEARCH_FILTER_KEYS.map((key) => [
    key,
    z.string().trim().min(1).max(300).optional(),
  ]),
) as Record<PublicSiteSearchFilterKey, z.ZodOptional<z.ZodString>>;

export const publicTrackingFiltersSchema = z
  .object(publicSearchFilterShape)
  .strict();

export const publicTrackingMetadataSchema = z
  .object({
    duration_seconds: z.number().int().min(1).max(86_400).optional(),
    filters: publicTrackingFiltersSchema.optional(),
    action: z.string().trim().min(1).max(120).optional(),
    placement: z.string().trim().min(1).max(80).optional(),
    os: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const publicTrackingInputSchema = z
  .object({
    organization_id: uuidSchema,
    event_type: z.enum(PUBLIC_TRACKING_EVENT_TYPES),
    page_path: z.string().trim().min(1).max(2_000),
    page_title: optionalNullableText(300),
    referrer: optionalNullableText(2_000),
    session_id: publicVisitorSessionIdSchema,
    property_id: uuidSchema.nullable().optional(),
    device_type: z.enum(["desktop", "mobile", "tablet"]).nullable().optional(),
    browser: z
      .enum(["chrome", "firefox", "safari", "edge", "other"])
      .nullable()
      .optional(),
    screen_width: z.number().int().min(0).max(100_000).nullable().optional(),
    screen_height: z.number().int().min(0).max(100_000).nullable().optional(),
    utm_source: optionalNullableText(300),
    utm_medium: optionalNullableText(300),
    utm_campaign: optionalNullableText(300),
    gclid: optionalNullableText(300),
    fbclid: optionalNullableText(300),
    metadata: publicTrackingMetadataSchema.default({}),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.event_type === "page_duration" &&
      input.metadata.duration_seconds === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duration_seconds is required for page_duration",
        path: ["metadata", "duration_seconds"],
      });
    }

    if (
      input.event_type !== "page_duration" &&
      input.metadata.duration_seconds !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duration_seconds is only accepted for page_duration",
        path: ["metadata", "duration_seconds"],
      });
    }

    if (
      input.event_type !== "property_search" &&
      input.metadata.filters !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "filters are only accepted for property_search",
        path: ["metadata", "filters"],
      });
    }

    if (
      input.event_type !== "cta_click" &&
      input.event_type !== "whatsapp_click" &&
      (input.metadata.action !== undefined ||
        input.metadata.placement !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action and placement are only accepted for click events",
        path: ["metadata"],
      });
    }

    const metadataBytes = new TextEncoder().encode(
      JSON.stringify(input.metadata),
    ).byteLength;
    if (metadataBytes > 16 * 1_024) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: 16 * 1_024,
        inclusive: true,
        type: "array",
        message: "Tracking metadata exceeds 16 KiB",
        path: ["metadata"],
      });
    }
  });

export type PublicTrackingInput = z.infer<typeof publicTrackingInputSchema>;

export const publicContactResponseSchema = z
  .object({
    success: z.literal(true),
    lead_id: uuidSchema.optional(),
    reentry: z.boolean().optional(),
    idempotent: z.boolean().optional(),
    filtered: z.boolean().optional(),
  })
  .strict();

export type PublicContactResponse = z.infer<typeof publicContactResponseSchema>;

export const publicTrackingResponseSchema = z
  .object({ ok: z.literal(true) })
  .strict();

export type PublicTrackingResponse = z.infer<
  typeof publicTrackingResponseSchema
>;
