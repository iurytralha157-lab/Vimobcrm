export type BillingIntentMethod = "PIX" | "BOLETO" | "CREDIT_CARD";

export const supportedBillingPeriodMonths = [1, 6, 12] as const;

export type BillingPeriodMonths = (typeof supportedBillingPeriodMonths)[number];

export type CheckoutCreditCard = {
  holderName?: string;
  holderCpfCnpj?: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
};

function readCardField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function passesLuhn(number: string) {
  let sum = 0;
  let doubleDigit = false;

  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

export function normalizeCheckoutCreditCard(
  value: unknown,
  now = new Date(),
): CheckoutCreditCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const input = value as Record<string, unknown>;
  const rawNumber = readCardField(input.number);
  const rawCcv = readCardField(input.ccv);
  const holderName = readCardField(input.holder_name);
  const holderCpfCnpj = readCardField(input.holder_cpf_cnpj).replace(/\D/g, "");
  if (!/^[\d\s-]+$/.test(rawNumber) || !/^\d{3,4}$/.test(rawCcv)) {
    return null;
  }

  const number = rawNumber.replace(/[\s-]/g, "");
  const expiryMonth = readCardField(input.expiry_month).padStart(2, "0");
  const expiryYear = readCardField(input.expiry_year);
  const ccv = rawCcv;

  if (
    holderName.length > 100 ||
    (holderCpfCnpj.length > 0 && ![11, 14].includes(holderCpfCnpj.length)) ||
    !/^\d{13,19}$/.test(number) ||
    !passesLuhn(number) ||
    !/^(0[1-9]|1[0-2])$/.test(expiryMonth) ||
    !/^\d{4}$/.test(expiryYear) ||
    !/^\d{3,4}$/.test(ccv)
  ) {
    return null;
  }

  const expiration = Number(expiryYear) * 12 + Number(expiryMonth);
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  if (expiration < current) return null;

  return {
    ...(holderName ? { holderName } : {}),
    ...(holderCpfCnpj ? { holderCpfCnpj } : {}),
    number,
    expiryMonth,
    expiryYear,
    ccv,
  };
}

export function normalizeCheckoutClientIp(value: unknown) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 45) return null;

  const ipv4Parts = candidate.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return candidate;
  }

  if (
    candidate.includes(":") &&
    /^[0-9a-f:]+$/i.test(candidate) &&
    !candidate.includes(":::")
  ) {
    return candidate;
  }

  return null;
}

export const checkoutPlanSelect =
  "id,name,price,billing_cycle,description,billing_periods,display_features,max_users,max_leads,max_whatsapp_sessions" as const;

export function isBillingPeriodMonths(
  value: unknown,
): value is BillingPeriodMonths {
  return supportedBillingPeriodMonths.some((period) => period === value);
}

export function normalizeBillingPeriodMonths(
  value: unknown,
): BillingPeriodMonths | null {
  if (value === undefined) return 1;
  return isBillingPeriodMonths(value) ? value : null;
}

export function billingCheckoutIntentRpcArgs(
  organizationId: string,
  billingMethod: BillingIntentMethod,
  billingPeriodMonths: BillingPeriodMonths,
  expectedPlanId?: string | null,
  expectedMonthlyPrice?: number | null,
) {
  return {
    p_organization_id: organizationId,
    p_billing_method: billingMethod,
    p_billing_period_months: billingPeriodMonths,
    p_expected_plan_id: expectedPlanId || null,
    p_expected_monthly_price: expectedMonthlyPrice ?? null,
  };
}

export function asaasSubscriptionCycle(value: BillingPeriodMonths) {
  switch (value) {
    case 1:
      return "MONTHLY";
    case 6:
      return "SEMIANNUALLY";
    case 12:
      return "YEARLY";
  }
}

export function providerRecoveryPath(
  method: BillingIntentMethod,
  externalReference: string,
) {
  const resource = method === "CREDIT_CARD" ? "subscriptions" : "payments";
  const query = new URLSearchParams({
    externalReference,
    limit: "10",
    offset: "0",
  });
  return `/${resource}?${query.toString()}`;
}

export function hostedCheckoutRecoveryPath(checkoutId: string) {
  return `/checkouts/${encodeURIComponent(checkoutId)}`;
}

type BillingProviderRecoveryCandidate = {
  id?: string;
  externalReference?: string;
  customer?: string;
  billingType?: string;
  value?: number;
  dueDate?: string;
  subscription?: string;
  cycle?: string;
  nextDueDate?: string;
  status?: string;
  deleted?: boolean;
};

export type BillingProviderRecoverySelection<T> =
  | { outcome: "found"; resource: T }
  | { outcome: "ambiguous" | "mismatch" | "not_found" };

function normalizedProviderValue(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "";
}

function isCanonicalIsoDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function providerAmountMatches(expected: number, actual: number | undefined) {
  return Number.isFinite(expected) && Number.isFinite(actual) &&
    actual === expected;
}

function providerIdentityMatches(
  expected: string,
  actual: string | undefined,
) {
  return expected.length > 0 && actual === expected;
}

export function selectBillingProviderRecoveryCandidate<
  T extends BillingProviderRecoveryCandidate,
>(input: {
  method: BillingIntentMethod;
  externalReference: string;
  expectedCustomerId: string;
  expectedAmount: number;
  expectedBillingPeriodMonths: BillingPeriodMonths;
  candidates: readonly T[];
  hasMore?: boolean;
}): BillingProviderRecoverySelection<T> {
  if (input.hasMore || input.candidates.length > 1) {
    return { outcome: "ambiguous" };
  }
  if (input.candidates.length === 0) return { outcome: "not_found" };

  const candidate = input.candidates[0];
  const commonIdentityMatches = Boolean(candidate.id?.trim()) &&
    providerIdentityMatches(
      input.externalReference,
      candidate.externalReference,
    ) &&
    providerIdentityMatches(input.expectedCustomerId, candidate.customer) &&
    providerAmountMatches(input.expectedAmount, candidate.value) &&
    candidate.deleted !== true;
  if (!commonIdentityMatches) return { outcome: "mismatch" };

  if (input.method === "CREDIT_CARD") {
    const subscriptionMatches =
      normalizedProviderValue(candidate.billingType) === "CREDIT_CARD" &&
      normalizedProviderValue(candidate.cycle) ===
        asaasSubscriptionCycle(input.expectedBillingPeriodMonths) &&
      normalizedProviderValue(candidate.status) === "ACTIVE" &&
      isCanonicalIsoDate(candidate.nextDueDate);
    return subscriptionMatches
      ? { outcome: "found", resource: candidate }
      : { outcome: "mismatch" };
  }

  const paymentMatches =
    normalizedProviderValue(candidate.billingType) === input.method &&
    isCanonicalIsoDate(candidate.dueDate) &&
    !candidate.subscription?.trim();
  return paymentMatches
    ? { outcome: "found", resource: candidate }
    : { outcome: "mismatch" };
}

export function selectBillingSubscriptionPaymentCandidate<
  T extends BillingProviderRecoveryCandidate,
>(input: {
  subscriptionId: string;
  externalReference: string;
  expectedCustomerId: string;
  expectedAmount: number;
  candidates: readonly T[];
  hasMore?: boolean;
}): BillingProviderRecoverySelection<T> {
  if (input.hasMore || input.candidates.length > 1) {
    return { outcome: "ambiguous" };
  }
  if (input.candidates.length === 0) return { outcome: "not_found" };

  const candidate = input.candidates[0];
  const matches = Boolean(candidate.id?.trim()) &&
    providerIdentityMatches(input.subscriptionId, candidate.subscription) &&
    providerIdentityMatches(
      input.externalReference,
      candidate.externalReference,
    ) &&
    providerIdentityMatches(input.expectedCustomerId, candidate.customer) &&
    normalizedProviderValue(candidate.billingType) === "CREDIT_CARD" &&
    providerAmountMatches(input.expectedAmount, candidate.value) &&
    isCanonicalIsoDate(candidate.dueDate);

  return matches
    ? { outcome: "found", resource: candidate }
    : { outcome: "mismatch" };
}

export function providerFailureIsDeterministic(status: number) {
  if (status < 400 || status >= 500) return false;
  return status !== 408 && status !== 409 && status !== 425 && status !== 429;
}

export type AsaasPaymentDisposition =
  | "payable"
  | "processing"
  | "settled"
  | "retryable"
  | "cancelled"
  | "assisted"
  | "unknown"
  | "bank_slip_artifact_invalid";

export type AsaasPaymentCheckoutState =
  | "pending"
  | "processing"
  | "settled"
  | "retry"
  | "cancelled"
  | "assisted";

const payableAsaasPaymentStatuses = new Set([
  "CREATED",
  "PENDING",
  "OVERDUE",
  "DUNNING_REQUESTED",
  "DUNNING_RECEIVED",
]);
const processingAsaasPaymentStatuses = new Set([
  "AWAITING_RISK_ANALYSIS",
  "APPROVED_BY_RISK_ANALYSIS",
]);
const settledAsaasPaymentStatuses = new Set([
  "CONFIRMED",
  "RECEIVED",
  "RECEIVED_IN_CASH",
  "REFUND_DENIED",
]);
const retryableAsaasPaymentStatuses = new Set([
  "CREDIT_CARD_CAPTURE_REFUSED",
]);
const cancelledAsaasPaymentStatuses = new Set([
  "CANCELED",
  "CANCELLED",
  "DELETED",
]);
const assistedAsaasPaymentStatuses = new Set([
  "REFUNDED",
  "REFUND_REQUESTED",
  "REFUND_IN_PROGRESS",
  "PARTIALLY_REFUNDED",
  "RECEIVED_IN_CASH_UNDONE",
  "CHARGEBACK",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
  "REPROVED_BY_RISK_ANALYSIS",
]);

export function asaasPaymentDisposition(
  status: string | null | undefined,
  input: { bankSlipArtifactInvalid?: boolean } = {},
): AsaasPaymentDisposition {
  if (input.bankSlipArtifactInvalid) return "bank_slip_artifact_invalid";

  const normalized = normalizedProviderValue(status);
  if (payableAsaasPaymentStatuses.has(normalized)) return "payable";
  if (processingAsaasPaymentStatuses.has(normalized)) return "processing";
  if (settledAsaasPaymentStatuses.has(normalized)) return "settled";
  if (retryableAsaasPaymentStatuses.has(normalized)) return "retryable";
  if (cancelledAsaasPaymentStatuses.has(normalized)) return "cancelled";
  if (assistedAsaasPaymentStatuses.has(normalized)) return "assisted";
  return "unknown";
}

export function asaasPaymentRequiresAssistance(
  status: string | null | undefined,
) {
  return asaasPaymentDisposition(status) === "assisted";
}

export function asaasPaymentCanReceiveCheckoutAttempt(
  status: string | null | undefined,
) {
  const disposition = asaasPaymentDisposition(status);
  return disposition === "payable" || disposition === "retryable";
}

export function asaasPaymentCheckoutState(
  status: string | null | undefined,
  input: { bankSlipArtifactInvalid?: boolean } = {},
): AsaasPaymentCheckoutState {
  switch (asaasPaymentDisposition(status, input)) {
    case "payable":
      return "pending";
    case "processing":
      return "processing";
    case "settled":
      return "settled";
    case "retryable":
    case "bank_slip_artifact_invalid":
      return "retry";
    case "cancelled":
      return "cancelled";
    case "assisted":
    case "unknown":
      return "assisted";
  }
}

export type AuthoritativePaymentCheckoutState = {
  authoritative: boolean;
  state: AsaasPaymentCheckoutState;
  source: "provider_snapshot" | "local_snapshot" | "unreconciled";
};

export function authoritativePaymentCheckoutState(input: {
  providerState: AsaasPaymentCheckoutState;
  reconciliationOutcome?: string | null;
  localState?: AsaasPaymentCheckoutState | null;
  localCheckoutClosed?: boolean;
}): AuthoritativePaymentCheckoutState {
  if (input.reconciliationOutcome === "applied") {
    return {
      authoritative: true,
      state: input.providerState,
      source: "provider_snapshot",
    };
  }

  // A stale provider observation may lose a race to a stronger local terminal
  // transition. Paid is terminal by itself; cancellation is authoritative only
  // after the exact checkout intent has also been closed locally.
  if (input.localState === "settled") {
    return {
      authoritative: true,
      state: "settled",
      source: "local_snapshot",
    };
  }
  if (input.localState === "cancelled" && input.localCheckoutClosed) {
    return {
      authoritative: true,
      state: "cancelled",
      source: "local_snapshot",
    };
  }

  return {
    authoritative: false,
    state: "assisted",
    source: "unreconciled",
  };
}

export function asaasBankSlipArtifactIsInvalid(input: {
  billingType?: string | null;
  webhookEvent?: string | null;
  providerDueDate?: string | null;
  recordedDueDate?: string | null;
}) {
  return normalizedProviderValue(input.billingType) === "BOLETO" &&
    normalizedProviderValue(input.webhookEvent) ===
      "PAYMENT_BANK_SLIP_CANCELLED" &&
    isCanonicalIsoDate(input.providerDueDate) &&
    input.providerDueDate === input.recordedDueDate;
}

export type AsaasCheckoutPaymentIntegrity =
  | "valid"
  | "deleted"
  | "payment_mismatch"
  | "customer_mismatch"
  | "subscription_mismatch"
  | "billing_type_mismatch"
  | "amount_mismatch"
  | "due_date_mismatch"
  | "external_reference_mismatch";

export function asaasCheckoutPaymentIntegrity(input: {
  expectedPaymentId: string;
  expectedCustomerId: string;
  expectedSubscriptionId?: string | null;
  expectedBillingType: BillingIntentMethod;
  expectedAmount: number;
  expectedDueDate: string;
  expectedExternalReference?: string | null;
  providerPaymentId?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerBillingType?: string | null;
  providerAmount?: number | null;
  providerDueDate?: string | null;
  providerExternalReference?: string | null;
  providerDeleted?: boolean;
}): AsaasCheckoutPaymentIntegrity {
  if (
    !providerIdentityMatches(
      input.expectedPaymentId,
      input.providerPaymentId || undefined,
    )
  ) {
    return "payment_mismatch";
  }
  if (
    !providerIdentityMatches(
      input.expectedCustomerId,
      input.providerCustomerId || undefined,
    )
  ) {
    return "customer_mismatch";
  }
  if (
    (input.providerSubscriptionId || null) !==
      (input.expectedSubscriptionId || null)
  ) {
    return "subscription_mismatch";
  }
  if (
    normalizedProviderValue(input.providerBillingType) !==
      input.expectedBillingType
  ) {
    return "billing_type_mismatch";
  }
  if (
    input.providerAmount === null || input.providerAmount === undefined ||
    !providerAmountMatches(input.expectedAmount, input.providerAmount)
  ) {
    return "amount_mismatch";
  }
  if (
    !isCanonicalIsoDate(input.expectedDueDate) ||
    input.providerDueDate !== input.expectedDueDate
  ) {
    return "due_date_mismatch";
  }
  if (
    input.expectedExternalReference !== null &&
    input.expectedExternalReference !== undefined &&
    !providerIdentityMatches(
      input.expectedExternalReference,
      input.providerExternalReference || undefined,
    )
  ) {
    return "external_reference_mismatch";
  }
  return input.providerDeleted ? "deleted" : "valid";
}

export type CardPaymentRecoveryAction =
  | "settled"
  | "retry"
  | "cancelled"
  | "assisted"
  | "wait";

export function cardPaymentRecoveryAction(
  status: string | null | undefined,
): CardPaymentRecoveryAction {
  const normalized = normalizedProviderValue(status);
  const disposition = asaasPaymentDisposition(normalized);
  if (disposition === "settled") return "settled";
  if (normalized === "OVERDUE" || disposition === "retryable") return "retry";
  if (disposition === "cancelled") return "cancelled";
  if (disposition === "assisted" || disposition === "unknown") {
    return "assisted";
  }
  return "wait";
}

export function billingPaymentCancellationAction(input: {
  status?: string | null;
  billingType?: string | null;
  deleted?: boolean;
}): CardPaymentRecoveryAction {
  if (input.deleted) return "cancelled";

  const normalizedStatus = normalizedProviderValue(input.status);
  if (normalizedStatus === "BANK_SLIP_CANCELLED") {
    return normalizedProviderValue(input.billingType) === "BOLETO"
      ? "wait"
      : "assisted";
  }

  const disposition = asaasPaymentDisposition(normalizedStatus);
  if (disposition === "settled") return "settled";
  if (disposition === "cancelled") return "cancelled";
  if (disposition === "assisted" || disposition === "unknown") {
    return "assisted";
  }
  return "wait";
}

export const billingCheckoutCancellationGraceMs = 5 * 60 * 1000;

export function cardSubscriptionRecoveryAction(
  status: string | null | undefined,
  input: {
    providerRequestStartedAt?: string | null;
    createdAt?: string | null;
  },
  nowMs = Date.now(),
): CardPaymentRecoveryAction {
  if (status?.trim()) return cardPaymentRecoveryAction(status);

  const startedAt = Date.parse(
    input.providerRequestStartedAt || input.createdAt || "",
  );
  return Number.isFinite(startedAt) &&
      nowMs - startedAt >= billingCheckoutCancellationGraceMs
    ? "retry"
    : "wait";
}

export function cardSubscriptionRequiresDeletion(
  action: CardPaymentRecoveryAction,
) {
  return action === "retry" || action === "cancelled";
}

export type ProviderlessCheckoutCancellationAction =
  | "not_providerless"
  | "retry_later"
  | "recover_then_cancel";

type ProviderlessCheckoutCancellationInput = {
  status?: string | null;
  providerRequestStartedAt?: string | null;
  createdAt?: string | null;
  paymentId?: string | null;
  subscriptionId?: string | null;
  checkoutId?: string | null;
};

function providerlessCheckoutStartedAt(
  input: ProviderlessCheckoutCancellationInput,
) {
  return Date.parse(input.providerRequestStartedAt || input.createdAt || "");
}

export function providerlessCheckoutRetryAfterSeconds(
  input: ProviderlessCheckoutCancellationInput,
  nowMs = Date.now(),
) {
  const startedAt = providerlessCheckoutStartedAt(input);
  if (!Number.isFinite(startedAt)) return 5;

  const remainingMs = billingCheckoutCancellationGraceMs - (nowMs - startedAt);
  return Math.max(
    1,
    Math.min(
      billingCheckoutCancellationGraceMs / 1000,
      Math.ceil(remainingMs / 1000),
    ),
  );
}

export function providerlessCheckoutCancellationAction(
  input: ProviderlessCheckoutCancellationInput,
  nowMs = Date.now(),
): ProviderlessCheckoutCancellationAction {
  if (
    input.status?.trim().toLowerCase() !== "creating" ||
    input.paymentId || input.subscriptionId || input.checkoutId
  ) {
    return "not_providerless";
  }

  const startedAt = providerlessCheckoutStartedAt(input);
  if (!Number.isFinite(startedAt)) return "retry_later";

  return nowMs - startedAt >= billingCheckoutCancellationGraceMs
    ? "recover_then_cancel"
    : "retry_later";
}

export function subscriptionPaymentsPath(subscriptionId: string) {
  return `/subscriptions/${
    encodeURIComponent(subscriptionId)
  }/payments?limit=100&offset=0`;
}
