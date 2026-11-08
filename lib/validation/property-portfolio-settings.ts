import { z } from "zod";
import { apiEnvelopeSchema } from "./common";

// Mirrors portfolioSettingsSchema in apps/api/internal/properties/portfolio_settings.go.
// These settings are stored only: they do not change publication or edit behaviour.
const percent = z.number().finite().min(0).max(100);
const days = z.number().int().min(0).max(3650);
const hours = z.number().int().min(1).max(8760);
const textList = z.array(z.string().trim().min(1).max(80)).max(30);

const portfolioSettingsShape = {
  general: z.object({
    auto_code: z.boolean(),
    required_fields: z.number().int().min(0).max(100),
    duplicate_warning: z.boolean(),
    min_completeness_pct: z.number().int().min(0).max(100),
    min_photos: z.number().int().min(0).max(20),
    price_review_days: days,
  }),
  ready: z.object({
    require_authorization: z.boolean(),
    authorization_warning_days: days,
    exclusivity_days: days,
    default_sale_commission_pct: percent,
  }),
  launches: z.object({
    commission_pct: percent,
    table_warning_days: days,
    reservation_hours: hours,
    reservation_approver: z.enum(["manager", "admin"]),
    broker_sees_sold: z.boolean(),
  }),
  rentals: z.object({
    adjustment_index: z.enum(["IPCA", "IGP-M", "INPC"]),
    guarantees: textList,
    admin_fee_pct: percent,
    first_rent_fee_pct: percent,
    require_inspection: z.boolean(),
    contract_warning_days: days,
  }),
  third_party: z.object({
    default_split_pct: percent,
    require_authorization: z.boolean(),
    partnership_days: days,
    publish_on_site: z.boolean(),
    show_partner_to_brokers: z.boolean(),
  }),
  condominiums: z.object({
    brokers_can_create: z.boolean(),
    apply_default_fee: z.boolean(),
  }),
  locations: z.object({
    brokers_can_create_neighborhood: z.boolean(),
    default_address_visibility: z.enum(["full", "partial", "neighborhood"]),
  }),
  owners: z.object({
    email_notices: z.boolean(),
    monthly_report: z.boolean(),
  }),
  keys: z.object({
    return_hours: hours,
    late_alert: z.boolean(),
    require_reason: z.boolean(),
    locations: textList,
  }),
  publication: z.object({
    auto_publish: z.boolean(),
    default_channels: textList,
    watermark: z.boolean(),
    manager_approval: z.boolean(),
  }),
};

export const portfolioSettingsSchema = z.object(portfolioSettingsShape);

const portfolioSettingsPatchSchema = z
  .object({
    general: portfolioSettingsShape.general.partial().strict().optional(),
    ready: portfolioSettingsShape.ready.partial().strict().optional(),
    launches: portfolioSettingsShape.launches.partial().strict().optional(),
    rentals: portfolioSettingsShape.rentals.partial().strict().optional(),
    third_party: portfolioSettingsShape.third_party.partial().strict().optional(),
    condominiums: portfolioSettingsShape.condominiums.partial().strict().optional(),
    locations: portfolioSettingsShape.locations.partial().strict().optional(),
    owners: portfolioSettingsShape.owners.partial().strict().optional(),
    keys: portfolioSettingsShape.keys.partial().strict().optional(),
    publication: portfolioSettingsShape.publication.partial().strict().optional(),
  })
  .strict();

export const portfolioSettingsUpdateInputSchema = z
  .object({
    settings: portfolioSettingsPatchSchema,
    revision: z.number().int().min(0),
  })
  .strict();

export const portfolioSettingsEnvelopeSchema = z.object({
  settings: portfolioSettingsSchema,
  revision: z.number().int().min(0),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
});

export const apiPortfolioSettingsResponseSchema = apiEnvelopeSchema(portfolioSettingsEnvelopeSchema);

export type PortfolioSettings = z.infer<typeof portfolioSettingsSchema>;
export type PortfolioSettingsUpdateInput = z.input<typeof portfolioSettingsUpdateInputSchema>;
export type PortfolioSettingsEnvelope = z.infer<typeof portfolioSettingsEnvelopeSchema>;
