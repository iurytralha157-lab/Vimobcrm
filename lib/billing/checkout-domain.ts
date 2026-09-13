import type {
  ChargeResult,
  CheckoutInfo,
  PersistedCardUpdateJob,
  PublicCheckoutPlan,
  PublicCheckoutPlansResponse,
} from "./checkout-types";
import { formatLocalizedBRLCurrency } from "../utils/formatting";

const CARD_UPDATE_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const SUPPORTED_BILLING_PERIODS = new Set([1, 6, 12]);

export async function checkoutCardRequestFingerprint(parts: string[]) {
  const payload = new TextEncoder().encode(parts.join("\u001f"));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", payload),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function cardUpdateSessionStorageKey(identity: string) {
  const digest = await checkoutCardRequestFingerprint([
    "vimob:billing-card-update",
    identity,
  ]);
  return `vimob:billing-card-update:${digest}`;
}

export function parsePersistedCardUpdateJob(
  value: string | null,
  now = Date.now(),
) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedCardUpdateJob>;
    if (
      parsed.version !== 1 ||
      typeof parsed.jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(parsed.jobId) ||
      (parsed.mode !== "settled_payment" && parsed.mode !== "saved_only") ||
      typeof parsed.createdAt !== "number" ||
      !Number.isSafeInteger(parsed.createdAt) ||
      now - parsed.createdAt > CARD_UPDATE_SESSION_TTL_MS ||
      parsed.createdAt > now + 60_000 ||
      (parsed.paymentId !== null && typeof parsed.paymentId !== "string") ||
      (parsed.subscriptionId !== null &&
        typeof parsed.subscriptionId !== "string")
    ) {
      return null;
    }
    if (
      parsed.mode === "settled_payment" &&
      (!parsed.paymentId || parsed.paymentId.length > 255)
    ) return null;
    if (parsed.subscriptionId && parsed.subscriptionId.length > 255) return null;
    return parsed as PersistedCardUpdateJob;
  } catch {
    return null;
  }
}

export function formatCurrency(value: number) {
  return formatLocalizedBRLCurrency(Number.isFinite(value) ? value : 0);
}

export function isSupportedBillingPeriod(period: number) {
  return SUPPORTED_BILLING_PERIODS.has(period);
}

export function normalizeBillingPeriods(periods?: number[] | null) {
  if (!Array.isArray(periods)) return [];

  return Array.from(
    new Set(
      periods.filter(
        (period): period is number =>
          typeof period === "number" &&
          Number.isInteger(period) &&
          isSupportedBillingPeriod(period),
      ),
    ),
  ).sort((first, second) => first - second);
}

export function normalizePublicCheckoutPlans(
  plans?: PublicCheckoutPlan[] | null,
) {
  if (!Array.isArray(plans)) return [];

  return plans
    .filter(
      (item) => item.id && item.slug && item.name && Number(item.price) > 0,
    )
    .sort(
      (first, second) =>
        Number(first.display_order ?? 0) - Number(second.display_order ?? 0),
    );
}

export async function fetchPublicCheckoutPlans(signal?: AbortSignal) {
  const response = await fetch("/api/onboarding/plans", {
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = (await response
    .json()
    .catch(() => null)) as PublicCheckoutPlansResponse | null;
  if (!response.ok || !Array.isArray(payload?.data)) {
    throw new Error(payload?.error || "Não foi possível carregar os planos.");
  }

  return normalizePublicCheckoutPlans(payload.data);
}

export function formatPeriod(period: number) {
  return `${period} ${period === 1 ? "mês" : "meses"}`;
}

export function formatPeriodLabel(period: number) {
  if (period === 1) return "Mensal";
  if (period === 6) return "Semestral";
  return "Anual";
}

export function formatBoletoDueDate(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function isCheckoutActivated(checkout: CheckoutInfo) {
  if (checkout.checkout_access?.can_manage_payment_method) return false;
  if (checkout.checkout_access?.scope === "payment") {
    return checkout.checkout_access.payment_settled;
  }
  return Boolean(
    checkout.plan &&
      checkout.organization.subscription_status === "active" &&
      checkout.organization.plan_id === checkout.plan.id &&
      !checkout.organization.pending_plan_id,
  );
}

export function isProcessingResult(
  result: ChargeResult,
): result is Extract<ChargeResult, { processing: true }> {
  return "processing" in result && result.processing === true;
}

export function getHTTPStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) ? status : null;
}

export function isCardFailureStatus(value?: string | null) {
  const normalized = value?.trim().toUpperCase() || "";
  return [
    "CREDIT_CARD_CAPTURE_REFUSED",
    "REFUSED",
    "DECLINED",
    "OVERDUE",
  ].includes(normalized);
}

export type CardInput = {
  holderName: string;
  holderDocument: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};

export function validateCardInput(input: CardInput, now = new Date()) {
  if (input.holderName.trim().length < 2) {
    return "Informe o nome impresso no cartão.";
  }
  if (![11, 14].includes(input.holderDocument.replace(/\D/g, "").length)) {
    return "Informe o CPF ou CNPJ do titular do cartão.";
  }

  const number = input.number.replace(/\D/g, "");
  if (number.length < 13 || number.length > 19) {
    return "Informe um número de cartão válido.";
  }

  let sum = 0;
  let shouldDouble = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  if (sum % 10 !== 0) return "Informe um número de cartão válido.";

  const month = Number(input.expiryMonth);
  const year = Number(input.expiryYear);
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !/^\d{4}$/.test(input.expiryYear)
  ) {
    return "Confira a validade do cartão.";
  }
  if (
    year < now.getFullYear() ||
    (year === now.getFullYear() && month < now.getMonth() + 1)
  ) {
    return "O cartão informado está vencido.";
  }
  if (!/^\d{3,4}$/.test(input.ccv)) {
    return "Informe um código de segurança válido.";
  }
  return null;
}
