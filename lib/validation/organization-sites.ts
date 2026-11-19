import { z } from "zod";
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";

const siteGoogleAnalyticsIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(?:G-[A-Z0-9]{4,32}|UA-[0-9]+-[0-9]+)$/)
  .nullable();
const siteGoogleTagManagerIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^GTM-[A-Z0-9]{4,32}$/)
  .nullable();
const siteGoogleSearchConsoleVerificationSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{10,255}$/)
  .nullable();

const siteAssetTypeSchema = z.enum([
  "logo",
  "footer_logo",
  "favicon",
  "about",
  "hero",
  "banner",
  "watermark",
]);
const browserFileSchema = z.custom<File>(
  (value) => typeof File !== "undefined" && value instanceof File,
  "Arquivo invalido",
);
export const siteAssetInputSchema = z
  .object({
    file: browserFileSchema,
    type: siteAssetTypeSchema,
  })
  .strict();
export const siteSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use pelo menos 3 caracteres")
  .max(63, "Use no máximo 63 caracteres")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Use apenas letras minúsculas, números e hífens",
  );
export const siteCustomDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Informe um domínio válido")
  .max(253, "O domínio é muito longo")
  .refine((value) => {
    if (
      value.includes("://") ||
      value.includes("/") ||
      value.includes(":") ||
      value.includes("..")
    )
      return false;
    const labels = value.split(".");
    if (labels.length < 2 || labels.at(-1)?.match(/^\d+$/)) return false;
    return labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    );
  }, "Informe somente o domínio, sem https://, caminhos ou portas");
const organizationSiteSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    is_active: z.boolean(),
    maintenance_mode: z.boolean(),
    maintenance_message: z.string().max(500).nullable(),
    subdomain: siteSlugSchema.nullable(),
    custom_domain: siteCustomDomainSchema.nullable(),
    domain_verified: z.boolean(),
    domain_verified_at: timestampSchema.nullable(),
    domain_verification_token: uuidSchema,
    site_title: z.string().trim().max(180).nullable(),
    site_description: z.string().trim().max(500).nullable(),
    footer_logo_url: z.string().trim().url().max(2_000).refine((value) => {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    }, "Use uma URL HTTP(S) válida").nullable().optional(),
    google_analytics_id: siteGoogleAnalyticsIdSchema,
    google_search_console_verification:
      siteGoogleSearchConsoleVerificationSchema.optional(),
    gtm_id: siteGoogleTagManagerIdSchema,
    site_theme: z.string(),
    background_color: z.string(),
    text_color: z.string(),
    card_color: z.string(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .passthrough();
export const organizationSiteMutationSchema = organizationSiteSchema
  .omit({
    id: true,
    organization_id: true,
    created_at: true,
    updated_at: true,
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Informe ao menos uma alteracao",
  );
const siteMenuItemSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    label: z.string(),
    link_type: z.enum(["page", "filter", "external"]),
    href: z.string(),
    position: nonNegativeIntegerSchema,
    open_in_new_tab: z.boolean(),
    is_active: z.boolean(),
  })
  .passthrough();
export const siteMenuItemInputSchema = siteMenuItemSchema
  .omit({
    id: true,
    organization_id: true,
  })
  .partial({ open_in_new_tab: true, is_active: true })
  .strict();
export const siteMenuItemUpdateSchema = siteMenuItemSchema
  .partial()
  .extend({
    id: uuidSchema,
  })
  .strict();
const siteSearchFilterSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    filter_key: z.string(),
    label: z.string(),
    position: nonNegativeIntegerSchema,
    is_active: z.boolean(),
  })
  .passthrough();
export const siteSearchFilterInputSchema = siteSearchFilterSchema
  .pick({
    filter_key: true,
    label: true,
    position: true,
    is_active: true,
  })
  .strict();
export const siteSearchFilterUpdateSchema = siteSearchFilterSchema
  .partial()
  .extend({ id: uuidSchema })
  .strict();
export const siteReorderInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({ id: uuidSchema, position: nonNegativeIntegerSchema })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const apiOrganizationSiteResponseSchema = apiEnvelopeSchema(
  organizationSiteSchema,
);
export const apiOptionalOrganizationSiteResponseSchema = apiEnvelopeSchema(
  organizationSiteSchema.nullable(),
);
export const apiSiteMenuItemResponseSchema =
  apiEnvelopeSchema(siteMenuItemSchema);
export const apiSiteMenuItemListResponseSchema = apiEnvelopeSchema(
  z.array(siteMenuItemSchema),
);
export const apiSiteSearchFilterResponseSchema = apiEnvelopeSchema(
  siteSearchFilterSchema,
);
export const apiSiteSearchFilterListResponseSchema = apiEnvelopeSchema(
  z.array(siteSearchFilterSchema),
);
export const apiSiteAssetResponseSchema = apiEnvelopeSchema(
  z.object({ url: z.string().url() }).passthrough(),
);
export const apiDomainVerificationResponseSchema = apiEnvelopeSchema(
  z
    .object({
      domain: siteCustomDomainSchema,
      verified: z.boolean(),
      checked_at: timestampSchema,
      reason: z
        .enum(["challenge_unavailable", "challenge_mismatch"])
        .optional(),
    })
    .strict(),
);
