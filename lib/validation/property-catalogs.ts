import { z } from "zod";
import { apiEnvelopeSchema, nonNegativeIntegerSchema, timestampSchema, uuidSchema } from "@/lib/validation/common";
import { finiteNullableNumber, nullableString } from "@/lib/validation/shared-schema-values";


export const propertyCatalogCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    icon: z.string().trim().max(255).nullish(),
  })
  .strict();
export const propertyCatalogSeedInputSchema = z
  .object({
    names: z.array(z.string().trim().min(1).max(180)).min(1).max(500),
  })
  .strict();
const propertyCatalogItemSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
  })
  .passthrough();
export const apiPropertyCatalogResponseSchema = apiEnvelopeSchema(
  propertyCatalogItemSchema,
);
export const apiPropertyCatalogListResponseSchema = apiEnvelopeSchema(
  z.array(propertyCatalogItemSchema),
);
export const apiPropertyImageResponseSchema = apiEnvelopeSchema(
  z
    .object({
      url: z.string().url(),
      path: z.string().min(1),
      bucket: z.string().min(1),
      contentType: z.string().min(1),
      size: nonNegativeIntegerSchema,
    })
    .passthrough(),
);

export const propertyCityInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    uf: z.string().trim().length(2).toUpperCase().optional(),
  })
  .strict();
export const propertyCityUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    uf: z.union([z.string().trim().length(2).toUpperCase(), z.literal(""), z.null()]).optional(),
    expected_updated_at: z.string().trim().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (input) => input.name !== undefined || input.uf !== undefined,
    "Informe ao menos uma alteracao",
  );
export const propertyNeighborhoodInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    city_id: uuidSchema,
  })
  .strict();
export const propertyNeighborhoodUpdateInputSchema = propertyNeighborhoodInputSchema
  .partial()
  .extend({
    expected_updated_at: z.string().trim().datetime({ offset: true }),
  })
  .refine(
    (input) => input.name !== undefined || input.city_id !== undefined,
    "Informe ao menos uma alteracao",
  );
export const propertyCondominiumInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    city_id: uuidSchema.optional(),
    neighborhood_id: uuidSchema.optional(),
    address: z.string().trim().max(300).optional(),
    photo_url: z
      .string()
      .trim()
      .max(1_000)
      .url()
      .regex(/^https?:\/\//i, "Use uma URL HTTP ou HTTPS")
      .optional(),
    cep: z.string().trim().max(20).optional(),
    number: z.string().trim().max(40).optional(),
    complement: z.string().trim().max(160).optional(),
    default_condominium_fee: z.number().finite().min(0).optional(),
    has_concierge: z.boolean().optional(),
    concierge_type: z.string().trim().max(80).optional(),
    notes: z.string().max(1_200).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  })
  .strict();
export const propertyCondominiumUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    city_id: z.union([uuidSchema, z.literal(""), z.null()]).optional(),
    neighborhood_id: z.union([uuidSchema, z.literal(""), z.null()]).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    photo_url: z.union([
      z.string().trim().max(1_000).url().regex(/^https?:\/\//i, "Use uma URL HTTP ou HTTPS"),
      z.literal(""),
      z.null(),
    ]).optional(),
    cep: z.string().trim().max(20).nullable().optional(),
    number: z.string().trim().max(40).nullable().optional(),
    complement: z.string().trim().max(160).nullable().optional(),
    default_condominium_fee: z.number().finite().min(0).nullable().optional(),
    has_concierge: z.boolean().optional(),
    concierge_type: z.string().trim().max(80).nullable().optional(),
    notes: z.string().max(1_200).nullable().optional(),
    latitude: z.number().finite().min(-90).max(90).nullable().optional(),
    longitude: z.number().finite().min(-180).max(180).nullable().optional(),
    expected_updated_at: z.string().trim().datetime({ offset: true }),
  })
  .strict()
  .refine(
    (input) => Object.keys(input).some((key) => key !== "expected_updated_at"),
    "Informe ao menos uma alteracao",
  );
export const propertyCatalogDeleteInputSchema = z
  .object({
    expected_updated_at: z.string().trim().datetime({ offset: true }),
  })
  .strict();
const propertyCitySchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    uf: nullableString,
    is_active: z.boolean(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    catalog_source: z.enum(["catalog", "property"]).optional(),
    property_count: nonNegativeIntegerSchema.optional(),
  })
  .passthrough();
const propertyNeighborhoodSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    city_id: uuidSchema.nullable(),
    name: z.string(),
    is_active: z.boolean(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    catalog_source: z.enum(["catalog", "property"]).optional(),
    property_count: nonNegativeIntegerSchema.optional(),
  })
  .passthrough();
const propertyCondominiumSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    is_active: z.boolean(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    catalog_source: z.enum(["catalog", "property"]).optional(),
    property_count: nonNegativeIntegerSchema.optional(),
  })
  .passthrough();
export const apiPropertyCityResponseSchema =
  apiEnvelopeSchema(propertyCitySchema);
export const apiPropertyCityListResponseSchema = apiEnvelopeSchema(
  z.array(propertyCitySchema),
);
export const apiPropertyNeighborhoodResponseSchema = apiEnvelopeSchema(
  propertyNeighborhoodSchema,
);
export const apiPropertyNeighborhoodListResponseSchema = apiEnvelopeSchema(
  z.array(propertyNeighborhoodSchema),
);
export const apiPropertyCondominiumResponseSchema = apiEnvelopeSchema(
  propertyCondominiumSchema,
);
export const apiPropertyCondominiumListResponseSchema = apiEnvelopeSchema(
  z.array(propertyCondominiumSchema),
);

const propertyOwnerInputShape = {
  name: z.string().trim().min(1).max(160),
  phone_residential: z.string().trim().max(40).optional(),
  phone_commercial: z.string().trim().max(40).optional(),
  cellphone: z.string().trim().max(40).optional(),
  email: z.union([z.string().trim().email(), z.literal("")]).optional(),
  media_source: z.string().trim().max(80).optional(),
  notify_email: z.boolean().optional(),
  notes: z.string().max(1_200).optional(),
};
const validateCatalogOwnerNotificationEmail = (
  owner: { notify_email?: boolean; email?: string },
  context: z.RefinementCtx,
) => {
  if (owner.notify_email && !owner.email?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["email"],
      message: "Informe o email para ativar notificacoes",
    });
  }
};
export const propertyOwnerInputSchema = z
  .object(propertyOwnerInputShape)
  .strict()
  .superRefine(validateCatalogOwnerNotificationEmail);
export const propertyOwnerCatalogUpdateInputSchema = z
  .object({
    ...propertyOwnerInputShape,
    expected_updated_at: z.string().trim().datetime({ offset: true }),
  })
  .strict()
  .superRefine(validateCatalogOwnerNotificationEmail);
export const propertyOwnerPageQuerySchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(100),
    cursor: z.string().min(1).max(2_048).nullable().optional(),
  })
  .strict();
const propertyOwnerSchema = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    name: z.string(),
    is_active: z.boolean(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .passthrough();
export const apiPropertyOwnerResponseSchema =
  apiEnvelopeSchema(propertyOwnerSchema);
export const apiPropertyOwnerPageResponseSchema = apiEnvelopeSchema(
  z.array(propertyOwnerSchema),
)
  .extend({
    next_cursor: z.string().min(1).nullable().optional(),
    total_count: nonNegativeIntegerSchema.optional(),
  })
  .passthrough();
const propertyCaptorSchema = z
  .object({
    id: uuidSchema,
    name: nullableString,
    email: nullableString,
    whatsapp: nullableString,
    avatar_url: nullableString,
  })
  .passthrough();
const propertySiteInfoSchema = z
  .object({
    subdomain: nullableString,
    custom_domain: nullableString,
    domain_verified: z.boolean().nullable(),
  })
  .passthrough();
const propertySummarySchema = z
  .object({
    id: uuidSchema,
    code: nullableString,
    title: nullableString,
    preco: finiteNullableNumber,
  })
  .passthrough();
export const apiPropertyCaptorResponseSchema = apiEnvelopeSchema(
  propertyCaptorSchema.nullable(),
);
export const apiPropertySiteInfoResponseSchema = apiEnvelopeSchema(
  propertySiteInfoSchema.nullable(),
);
export const apiPropertySummaryListResponseSchema = apiEnvelopeSchema(
  z.array(propertySummarySchema),
);
