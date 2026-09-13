import { SYSTEM_MODULES, type SystemModuleKey } from "@/config/constants";
import type { SubscriptionPlan } from "@/hooks/use-admin-plans";

const DEFAULT_PLAN_MODULES: SystemModuleKey[] = ["crm", "properties", "whatsapp", "agenda"];

export type PlanFormState = {
  slug: string;
  name: string;
  description: string;
  price: string;
  billing_cycle: string;
  trial_enabled: boolean;
  trial_days: string;
  max_users: string;
  max_leads: string;
  max_whatsapp_sessions: string;
  modules: SystemModuleKey[];
  is_active: boolean;
  is_public: boolean;
};

const SYSTEM_MODULE_KEY_SET = new Set<string>(SYSTEM_MODULES.map((module) => module.key));

export function isSystemModuleKey(module: unknown): module is SystemModuleKey {
  return typeof module === "string" && SYSTEM_MODULE_KEY_SET.has(module);
}
export const DEFAULT_PLAN_FORM: PlanFormState = {
  slug: "",
  name: "",
  description: "",
  price: "0",
  billing_cycle: "monthly",
  trial_enabled: false,
  trial_days: "",
  max_users: "",
  max_leads: "",
  max_whatsapp_sessions: "",
  modules: DEFAULT_PLAN_MODULES,
  is_active: true,
  is_public: true,
};

export function slugifyPlanName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stringFromNullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

export function normalizePlanModules(modules: string[] | null | undefined) {
  return (modules || []).filter(isSystemModuleKey);
}

export function planToFormState(plan: SubscriptionPlan): PlanFormState {
  return {
    slug: plan.slug || "",
    name: plan.name || "",
    description: plan.description || "",
    price: String(plan.price || 0),
    billing_cycle: plan.billing_cycle || "monthly",
    trial_enabled: Boolean(plan.trial_enabled),
    trial_days: stringFromNullableNumber(plan.trial_days),
    max_users: stringFromNullableNumber(plan.max_users),
    max_leads: stringFromNullableNumber(plan.max_leads),
    max_whatsapp_sessions: stringFromNullableNumber(plan.max_whatsapp_sessions),
    modules: normalizePlanModules(plan.modules),
    is_active: plan.is_active !== false,
    is_public: plan.is_public !== false,
  };
}

export function parseNumberInput(value: string, fallback = 0) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseNullableNumberInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isValidNumberInput(
  value: string,
  options: { allowEmpty?: boolean; integer?: boolean; min?: number; max?: number } = {},
) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return options.allowEmpty === true;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return false;
  if (options.integer && !Number.isInteger(parsed)) return false;
  if (options.min !== undefined && parsed < options.min) return false;
  if (options.max !== undefined && parsed > options.max) return false;
  return true;
}

export function planFormToPayload(form: PlanFormState) {
  return {
    slug: form.slug.trim() || slugifyPlanName(form.name),
    name: form.name.trim(),
    description: form.description.trim() || null,
    price: parseNumberInput(form.price),
    billing_cycle: form.billing_cycle.trim() || "monthly",
    trial_enabled: form.trial_enabled,
    trial_days: parseNullableNumberInput(form.trial_days),
    max_users: parseNullableNumberInput(form.max_users),
    max_leads: parseNullableNumberInput(form.max_leads),
    max_whatsapp_sessions: parseNullableNumberInput(form.max_whatsapp_sessions),
    modules: form.modules,
    is_active: form.is_active,
    is_public: form.is_public,
  };
}
