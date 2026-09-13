import { formatWholePtBRCurrency } from '../../../../lib/utils/formatting';

export type PublicPlan = {
  id?: string;
  slug?: string;
  name?: string;
  price?: number;
  reference_price?: number | null;
  discount_percentage?: number | null;
  display_order?: number | null;
  billing_periods?: number[] | null;
  billing_cycle?: string | null;
  description?: string | null;
  trial_enabled?: boolean | null;
  trial_days?: number | null;
  max_users?: number | null;
  max_whatsapp_sessions?: number | null;
  modules?: string[] | null;
  display_features?: string[] | null;
};

export type PublicPlansResponse = {
  data?: PublicPlan[];
  error?: string;
};

export type OnboardingPlanOption = {
  id?: string;
  slug: string;
  signupPath: "trial" | "paid";
  name: string;
  price: string;
  originalPrice?: number | null;
  discount?: number | null;
  displayOrder?: number | null;
  description: string;
  billingCycle?: string | null;
  trialEnabled?: boolean | null;
  trialDays?: number | null;
  maxUsers?: number | null;
  maxWhatsappSessions?: number | null;
  modules?: string[];
  features?: string[];
};

function normalizePlanName(name: string) {
  return name.replace(/^Vimob\s+/i, "").trim() || name;
}

function formatBillingCycle(cycle?: string | null) {
  const normalized = String(cycle || "").toLowerCase();
  if (normalized === "monthly" || normalized === "mensal" || normalized === "month") return "/mes";
  if (normalized === "yearly" || normalized === "annual" || normalized === "anual" || normalized === "year") return "/ano";
  return "";
}

function formatPlanPrice(price?: number, cycle?: string | null) {
  if (typeof price !== "number" || !Number.isFinite(price)) return "Sob consulta";
  const formatted = formatWholePtBRCurrency(price);
  return formatted + formatBillingCycle(cycle);
}

function normalizePlanFeatures(features?: string[] | null) {
  if (!Array.isArray(features)) return [];

  return Array.from(
    new Set(
      features
        .filter((feature): feature is string => typeof feature === "string")
        .map((feature) => feature.trim())
        .filter(Boolean),
    ),
  );
}

function normalizePositiveNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeDisplayOrder(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function comparePlansByDisplayOrder(
  first: OnboardingPlanOption,
  second: OnboardingPlanOption,
) {
  if (first.displayOrder === null || first.displayOrder === undefined) {
    return second.displayOrder === null || second.displayOrder === undefined ? 0 : 1;
  }

  if (second.displayOrder === null || second.displayOrder === undefined) return -1;
  return first.displayOrder - second.displayOrder;
}

export function mapPublicPlan(plan: PublicPlan): OnboardingPlanOption | null {
  const slug = plan.slug?.trim();
  const name = plan.name?.trim();

  if (!slug || !name) return null;

  const trialDays = plan.trial_days ?? null;
  const isTrial = Boolean(plan.trial_enabled) && Number(trialDays || 0) > 0;
  const modules = Array.isArray(plan.modules) ? plan.modules.filter(Boolean) : [];

  return {
    id: plan.id,
    slug,
    signupPath: isTrial ? "trial" : "paid",
    name: normalizePlanName(name),
    price: formatPlanPrice(plan.price, plan.billing_cycle),
    originalPrice: normalizePositiveNumber(plan.reference_price),
    discount: normalizePositiveNumber(plan.discount_percentage),
    displayOrder: normalizeDisplayOrder(plan.display_order),
    description: plan.description?.trim() || "",
    billingCycle: plan.billing_cycle ?? null,
    trialEnabled: Boolean(plan.trial_enabled),
    trialDays,
    maxUsers: plan.max_users ?? null,
    maxWhatsappSessions: plan.max_whatsapp_sessions ?? null,
    modules,
    features: normalizePlanFeatures(plan.display_features),
  };
}
