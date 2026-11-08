import assert from "node:assert/strict";
import test from "node:test";
import { propertyCreateInputSchema, propertyListQuerySchema, propertyUpdateInputSchema } from "./properties";
import { apiPortfolioSettingsResponseSchema, portfolioSettingsUpdateInputSchema } from "./property-portfolio-settings";
import { apiPropertyKeyMovementPageSchema, propertyKeyMovementListQuerySchema } from "./property-workspace";

const base = { title: "Casa", tipo_de_imovel: "Casa", tipo_de_negocio: "Venda" };
const version = { expected_updated_at: "2026-11-05T10:00:00Z" };

test("existing property clients that omit portfolio fields stay valid", () => {
  assert.equal(propertyCreateInputSchema.safeParse(base).success, true);
  assert.equal(propertyUpdateInputSchema.safeParse({ ...version, title: "Novo" }).success, true);
});

test("third party rules match the API", () => {
  const create = (extra: object) => propertyCreateInputSchema.safeParse({ ...base, ...extra }).success;
  assert.equal(create({ portfolio_type: "third_party" }), false);
  assert.equal(create({ portfolio_type: "third_party", third_party_kind: "partner" }), false);
  assert.equal(create({ portfolio_type: "third_party", third_party_kind: "partner", partner_name: "Parceira", commission_split_percent: 40 }), true);
  assert.equal(create({ portfolio_type: "third_party", third_party_kind: "private_owner" }), true);
  assert.equal(create({ portfolio_type: "third_party", third_party_kind: "private_owner", commission_split_percent: 101 }), false);
  assert.equal(create({ partner_name: "Parceira" }), false);
  assert.equal(create({ portfolio_type: "other" }), false);
  assert.equal(propertyUpdateInputSchema.safeParse({ ...version, commission_split_percent: 12.5 }).success, true);
  assert.equal(propertyListQuerySchema.safeParse({ portfolio_type: "launch" }).success, true);
  assert.equal(propertyListQuerySchema.safeParse({ portfolio_type: "x" }).success, false);
});

test("portfolio settings accept a partial patch and reject unknown keys and bad ranges", () => {
  const parse = (settings: unknown, revision: unknown = 1) => portfolioSettingsUpdateInputSchema.safeParse({ settings, revision }).success;
  assert.equal(parse({ general: { min_photos: 5 } }), true);
  assert.equal(parse({ rentals: { adjustment_index: "IGP-M", guarantees: ["Fiador"] } }), true);
  assert.equal(parse({ general: { unknown: 1 } }), false);
  assert.equal(parse({ unknown: {} }), false);
  assert.equal(parse({ general: { min_photos: 21 } }), false);
  assert.equal(parse({ general: {} }, -1), false);
});

test("response parsers accept the documented shapes", () => {
  const settings = {
    general: { auto_code: true, required_fields: 0, duplicate_warning: true, min_completeness_pct: 0, min_photos: 0, price_review_days: 90 },
    ready: { require_authorization: false, authorization_warning_days: 30, exclusivity_days: 90, default_sale_commission_pct: 6 },
    launches: { commission_pct: 4, table_warning_days: 30, reservation_hours: 48, reservation_approver: "manager", broker_sees_sold: true },
    rentals: { adjustment_index: "IPCA", guarantees: [], admin_fee_pct: 10, first_rent_fee_pct: 100, require_inspection: true, contract_warning_days: 60 },
    third_party: { default_split_pct: 50, require_authorization: true, partnership_days: 180, publish_on_site: false, show_partner_to_brokers: false },
    condominiums: { brokers_can_create: false, apply_default_fee: false },
    locations: { brokers_can_create_neighborhood: false, default_address_visibility: "full" },
    owners: { email_notices: false, monthly_report: false },
    keys: { return_hours: 24, late_alert: true, require_reason: false, locations: [] },
    publication: { auto_publish: false, default_channels: [], watermark: false, manager_approval: false },
  };
  const parsed = apiPortfolioSettingsResponseSchema.safeParse({ data: { settings, revision: 0, updated_at: null, updated_by: null } });
  assert.equal(parsed.success, true);
  assert.equal(propertyKeyMovementListQuerySchema.safeParse({ limit: 20, type: "registration" }).success, true);
  assert.equal(propertyKeyMovementListQuerySchema.safeParse({ type: "other" }).success, false);
  assert.equal(apiPropertyKeyMovementPageSchema.safeParse({ data: [], next_cursor: null, meta: { can_view_key_custody: false } }).success, true);
});
