import {
  resolveBillingPaymentStatus,
  shouldTreatHistoryStatusAsCurrent,
} from "./checkout-ui-state";
import { formatLocalizedBRLCurrency } from "../utils/formatting";

export type BillingPage = "subscriptions" | "payments" | "methods" | "plans";

export type BillingStatusPresentation = {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
};

export type PaymentHistoryPresentationItem = {
  id: string;
  asaas_payment_id: string;
  asaas_subscription_id: string | null;
  billing_type: string | null;
  status: string | null;
  value: number | null;
  bank_slip_registration_cancelled: boolean;
  sync_state: "cached" | "current" | "provider_unavailable";
};

const billingPages = new Set<BillingPage>([
  "subscriptions",
  "payments",
  "methods",
  "plans",
]);

const subscriptionStatuses: Record<string, BillingStatusPresentation> = {
  active: { label: "Ativa", variant: "default" },
  trial: { label: "Período de teste", variant: "secondary" },
  pending: { label: "Pendente", variant: "destructive" },
  pending_payment: { label: "Pagamento pendente", variant: "destructive" },
  overdue: { label: "Em atraso", variant: "destructive" },
  past_due: { label: "Em atraso", variant: "destructive" },
  suspended: { label: "Suspensa", variant: "destructive" },
  blocked: { label: "Bloqueada", variant: "destructive" },
  cancelled: { label: "Cancelada", variant: "outline" },
  canceled: { label: "Cancelada", variant: "outline" },
  expired: { label: "Expirada", variant: "destructive" },
};

export function getBillingPage(value: string | null): BillingPage {
  return value && billingPages.has(value as BillingPage)
    ? (value as BillingPage)
    : "payments";
}

export function normalizeBillingPeriodMonths(
  value: number | null | undefined,
  billingCycle?: string | null,
): 1 | 6 | 12 {
  if (value === 6 || value === 12) return value;
  if (value === 1) return 1;

  const normalizedCycle = billingCycle?.trim().toLowerCase();
  return ["yearly", "annual", "anual"].includes(normalizedCycle || "") ? 12 : 1;
}

export function formatBillingPeriod(months: 1 | 6 | 12) {
  if (months === 1) return "1 mês";
  return `${months} meses`;
}

export function formatBillingFrequency(months: 1 | 6 | 12) {
  return months === 1 ? "Mensal" : `A cada ${formatBillingPeriod(months)}`;
}

export function formatPaymentMethod(billingType: string | null | undefined) {
  if (billingType === "CREDIT_CARD") return "Cartão";
  if (billingType === "PIX") return "Pix";
  if (billingType === "BOLETO") return "Boleto";
  return "—";
}

export function hasCancelledBankSlipRegistration(
  payment: PaymentHistoryPresentationItem,
) {
  return payment.bank_slip_registration_cancelled;
}

export function formatBillingMoney(value: number | null | undefined) {
  return formatLocalizedBRLCurrency(Number(value || 0));
}

export function shortBillingReference(value: string | null | undefined) {
  return value && value.length > 18
    ? `${value.slice(0, 10)}…${value.slice(-6)}`
    : value || "Não definida";
}

export function getSubscriptionStatus(status: string): BillingStatusPresentation {
  return (
    subscriptionStatuses[status] || {
      label: status,
      variant: "outline",
    }
  );
}

export function getPaymentStatus(
  payment: PaymentHistoryPresentationItem,
  refreshFailed = false,
): BillingStatusPresentation {
  const syncState = refreshFailed ? "provider_unavailable" : payment.sync_state;
  if (!shouldTreatHistoryStatusAsCurrent({ syncState, refreshFailed })) {
    if (syncState === "cached") {
      return { label: "Conferindo", variant: "secondary" };
    }
    return { label: "Não confirmado", variant: "secondary" };
  }

  const presentation = resolveBillingPaymentStatus(
    payment.status,
    hasCancelledBankSlipRegistration(payment),
  );

  if (presentation.tone === "success") {
    return { label: presentation.label, variant: "default" };
  }
  if (presentation.tone === "danger") {
    return { label: presentation.label, variant: "destructive" };
  }
  if (presentation.state === "pending" || presentation.state === "cancelled") {
    return { label: presentation.label, variant: "outline" };
  }
  return { label: presentation.label, variant: "secondary" };
}

export function filterPaymentHistory<T extends PaymentHistoryPresentationItem>(
  history: T[],
  query: string,
  refreshErrors: Record<string, string>,
): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  if (!normalizedQuery) return history;

  return history.filter((item) => {
    const status = getPaymentStatus(item, Boolean(refreshErrors[item.id]));
    return [
      item.asaas_payment_id,
      item.asaas_subscription_id,
      item.billing_type,
      item.status,
      status.label,
      formatBillingMoney(item.value),
    ].some((value) =>
      value?.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
    );
  });
}
