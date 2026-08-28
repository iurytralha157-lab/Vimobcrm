"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import NextImage from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  LockKeyhole,
  Pencil,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AuthLogo } from "@/components/features/auth/auth-logo";
import { CardPaymentFields } from "@/components/features/auth/CardPaymentFields";
import { SignupCheckoutRecoveryBanner } from "@/components/features/onboarding/SignupCheckoutRecoveryBanner";
import { VimobLoader } from "@/components/shared/loading";
import { toast } from "sonner";
import { paymentsAPI } from "@/lib/api/payments";
import { settingsAPI } from "@/lib/api/settings";
import { createUUID } from "@/lib/client-id";
import {
  BRAND_HEADER_LAYOUT,
  DEFAULT_AUTHENTICATED_ROUTE,
} from "@/config/constants";
import {
  clearCheckoutBillingDraftSession,
  consumeCheckoutBillingProfileSession,
  loadCheckoutBillingDraftSession,
  saveCheckoutBillingDraftSession,
} from "@/lib/billing/checkout-profile-session";
import {
  type CheckoutPaymentReceiptReference,
  parseCheckoutPaymentReceiptReference,
} from "@/lib/billing/payment-receipt";
import {
  type CardRecurrenceSignal,
  type CardRecurrenceState,
  parseCheckoutPaymentMethod,
  resolveCardRecurrenceState,
} from "@/lib/billing/checkout-ui-state";
import { checkoutBillingDetailsSchema } from "@/lib/validation";

interface CheckoutInfo {
  organization: {
    id: string;
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    subscription_status: string | null;
    plan_id: string | null;
    pending_plan_id: string | null;
  };
  plan: {
    id: string;
    name: string;
    price: number;
    billing_cycle: string | null;
    description: string | null;
    billing_periods: number[];
    display_features: string[];
    max_users: number | null;
    max_whatsapp_sessions: number | null;
  } | null;
  billing_profile?: {
    name: string;
    email: string;
    cpf_cnpj: string;
    phone: string;
    country: "BR";
    postal_code: string;
    address: string;
    address_number: string;
    address_complement: string;
    neighborhood: string;
    city: string;
    state: string;
  };
  billing_profile_summary?: {
    complete: boolean;
    name: string;
    email: string;
    cpf_cnpj: string;
    phone: string;
    country: "BR";
    postal_code: string;
    address: string;
    address_number: string;
    address_complement: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null;
  checkout_access?: {
    scope: "organization" | "payment";
    can_change_plan: boolean;
    can_manage_payment_method?: boolean;
    use_stored_billing_profile: boolean;
    payment_status: string | null;
    payment_settled: boolean;
    recurrence_saved?: boolean;
    recurrence_processing?: boolean;
    recurrence_save_failed?: boolean;
    requires_payment_method_update?: boolean;
    bank_slip_registration_cancelled?: boolean;
  };
  active_checkout?: ActiveCheckout | null;
}

type ActiveCheckout = {
  intent_id: string;
  plan_id: string;
  billing_method: PaymentMethod;
  status: string;
  billing_period_months: number;
  amount: number;
  payment_id: string | null;
  subscription_id: string | null;
  checkout_id: string | null;
  provider_status: string | null;
  card_last4: string | null;
  created_at: string;
  updated_at: string;
};

type PublicCheckoutPlan = {
  id?: string;
  slug?: string;
  name?: string;
  price?: number;
  billing_cycle?: string | null;
  billing_periods?: number[] | null;
  description?: string | null;
  display_features?: string[] | null;
  display_order?: number | null;
  max_users?: number | null;
  max_whatsapp_sessions?: number | null;
};

type PublicCheckoutPlansResponse = {
  data?: PublicCheckoutPlan[];
  error?: string;
};

type CheckoutPlanChangeResponse = {
  ok?: boolean;
  message?: string;
  requiresPayment?: boolean;
  plan?: PublicCheckoutPlan;
};

interface PixResult {
  type: "PIX";
  payment_id: string;
  invoice_url?: string;
  qr_code?: string;
  qr_payload?: string;
  value: number;
}

type CardResult =
  | {
    type: "CREDIT_CARD";
    hosted: true;
    checkout_id: string;
    checkout_url: string;
    status: string;
    message?: string;
  }
  | {
    type: "CREDIT_CARD";
    hosted: false;
    subscription_id?: string | null;
    payment_id?: string;
    settled?: boolean;
    saved_only?: boolean;
    recurrence_saved?: boolean;
    recurrence_processing?: boolean;
    recurrence_save_failed?: boolean;
    requires_payment_method_update?: boolean;
    processing?: boolean;
    code?: string;
    card_update_job_id?: string;
    status: string;
    card_last4?: string;
    message?: string;
  };

interface BoletoResult {
  type: "BOLETO";
  payment_id: string;
  invoice_url?: string;
  bank_slip_url?: string;
  identification_field?: string;
  bar_code?: string;
  due_date: string | null;
  value: number;
}

type CancelPaymentResult = {
  success?: boolean;
  error?: string;
};

type PaymentMethod = "PIX" | "BOLETO" | "CREDIT_CARD";

async function checkoutCardRequestFingerprint(parts: string[]) {
  const payload = new TextEncoder().encode(parts.join("\u001f"));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", payload),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const cardUpdateSessionTtlMs = 24 * 60 * 60 * 1_000;

type PersistedCardUpdateJob = {
  version: 1;
  jobId: string;
  mode: "settled_payment" | "saved_only";
  paymentId: string | null;
  subscriptionId: string | null;
  createdAt: number;
};

async function cardUpdateSessionStorageKey(identity: string) {
  const digest = await checkoutCardRequestFingerprint([
    "vimob:billing-card-update",
    identity,
  ]);
  return `vimob:billing-card-update:${digest}`;
}

function parsePersistedCardUpdateJob(value: string | null) {
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
      Date.now() - parsed.createdAt > cardUpdateSessionTtlMs ||
      parsed.createdAt > Date.now() + 60_000 ||
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
    if (
      parsed.subscriptionId && parsed.subscriptionId.length > 255
    ) return null;
    return parsed as PersistedCardUpdateJob;
  } catch {
    return null;
  }
}

type PaymentRecoveryState =
  | "creating"
  | "pending"
  | "processing"
  | "settled"
  | "retry"
  | "assisted"
  | "cancelled";

type PaymentStatusResponse = {
  checkout: ActiveCheckout | null;
  state: PaymentRecoveryState;
  code?: string;
  message?: string;
  payment?: {
    id: string;
    status: string;
    billing_type: string;
    value: number;
    due_date: string | null;
    payment_date: string | null;
    invoice_url: string | null;
  };
  pix?: {
    qr_code?: string | null;
    qr_payload?: string | null;
  };
  boleto?: {
    bank_slip_url?: string | null;
    identification_field?: string | null;
    bar_code?: string | null;
  };
  receipt?: unknown;
  recurrence_saved?: boolean;
  recurrence_processing?: boolean;
  recurrence_save_failed?: boolean;
  requires_payment_method_update?: boolean;
  bank_slip_registration_cancelled?: boolean;
  card_update?: {
    job_id: string;
    mode?: "settled_payment" | "saved_only";
    state: "queued" | "succeeded" | "cancelled" | "failed" | "manual_review";
    status?: string;
    card_last4?: string;
    last_error_code?: string;
    next_attempt_at?: string;
    updated_at?: string;
    completed_at?: string;
  };
};

type ChargeRequest = {
  idempotency_key?: string;
  billing_type: PaymentMethod;
  billing_profile_mode?: "manual" | "stored";
  holder_email?: string;
  holder_cpf_cnpj?: string;
  holder_phone?: string;
  billing_period_months: number;
  expected_plan_id: string;
  expected_monthly_price: number;
  checkout_token?: string;
  organization_id?: string | null;
  holder_name?: string;
  holder_postal_code?: string;
  holder_address?: string;
  holder_address_number?: string;
  holder_address_complement?: string;
  holder_neighborhood?: string;
  holder_city?: string;
  holder_state?: string;
  holder_country?: "BR";
  card?: {
    holder_name: string;
    holder_cpf_cnpj: string;
    number: string;
    expiry_month: string;
    expiry_year: string;
    ccv: string;
  };
};

type ChargeResult =
  | ({ success: true } & PixResult)
  | ({ success: true } & BoletoResult)
  | ({ success: true } & CardResult)
  | {
    success: true;
    type: PaymentMethod;
    processing: true;
    status: "CREATING" | "RECOVERING";
    intent_id?: string;
    payment_id?: string;
    subscription_id?: string;
    settled?: boolean;
    recurrence_saved?: boolean;
    recurrence_processing?: boolean;
    recurrence_save_failed?: boolean;
    requires_payment_method_update?: boolean;
    saved_only?: boolean;
    code?: string;
    card_update_job_id?: string;
    message?: string;
  }
  | { success?: false; error?: string };

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});
const supportedBillingPeriods = new Set([1, 6, 12]);

function formatCurrency(value: number) {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function normalizeBillingPeriods(periods?: number[] | null) {
  if (!Array.isArray(periods)) return [];

  return Array.from(
    new Set(
      periods.filter(
        (period): period is number =>
          typeof period === "number" &&
          Number.isInteger(period) &&
          supportedBillingPeriods.has(period),
      ),
    ),
  ).sort((first, second) => first - second);
}

function normalizePublicCheckoutPlans(plans?: PublicCheckoutPlan[] | null) {
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

async function fetchPublicCheckoutPlans(signal?: AbortSignal) {
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

function formatPeriod(period: number) {
  return `${period} ${period === 1 ? "mês" : "meses"}`;
}

function formatPeriodLabel(period: number) {
  if (period === 1) return "Mensal";
  if (period === 6) return "Semestral";
  return "Anual";
}

function formatBoletoDueDate(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

async function copyPaymentCode(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error(
      "Não foi possível copiar automaticamente. Selecione o código e copie manualmente.",
    );
  }
}

function isCheckoutActivated(checkout: CheckoutInfo) {
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

function isProcessingResult(
  result: ChargeResult,
): result is Extract<ChargeResult, { processing: true }> {
  return "processing" in result && result.processing === true;
}

function getHTTPStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isInteger(status) ? status : null;
}

function waitFor(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds)
  );
}

function isCardFailureStatus(value?: string | null) {
  const normalized = value?.trim().toUpperCase() || "";
  return [
    "CREDIT_CARD_CAPTURE_REFUSED",
    "REFUSED",
    "DECLINED",
    "OVERDUE",
  ].includes(normalized);
}

function validateCardInput(input: {
  holderName: string;
  holderDocument: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}) {
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
  const now = new Date();
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

function CheckoutPageShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="app-shell min-h-screen bg-[var(--app-background)] text-[var(--app-text-primary)]">
      <header className="sticky top-0 z-30 bg-[var(--app-background)]">
        <div
          className="mx-auto flex h-[72px] w-full items-center justify-between px-4 sm:px-6 lg:px-8"
          style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
        >
          <div className="inline-flex min-h-11 w-fit items-center">
            <AuthLogo theme="adaptive" width={BRAND_HEADER_LAYOUT.logoWidth} />
          </div>
          <div className="flex h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-4 text-xs font-light text-[var(--app-text-secondary)]">
            <ShieldCheck
              className="h-4 w-4 text-primary/70"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            Checkout seguro
          </div>
        </div>
      </header>
      <main
        className="mx-auto w-full px-4 pb-8 pt-5 sm:px-6 sm:pb-10 sm:pt-7 lg:px-8"
        style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
      >
        {children}
      </main>
    </div>
  );
}

type BillingDetailsFieldsProps = {
  name: string;
  email: string;
  document: string;
  phone: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onDocumentChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPostalCodeChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onAddressNumberChange: (value: string) => void;
  onAddressComplementChange: (value: string) => void;
  onNeighborhoodChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onStateChange: (value: string) => void;
};

function BillingDetailsFields({
  name,
  email,
  document,
  phone,
  postalCode,
  address,
  addressNumber,
  addressComplement,
  neighborhood,
  city,
  state,
  disabled,
  onNameChange,
  onEmailChange,
  onDocumentChange,
  onPhoneChange,
  onPostalCodeChange,
  onAddressChange,
  onAddressNumberChange,
  onAddressComplementChange,
  onNeighborhoodChange,
  onCityChange,
  onStateChange,
}: BillingDetailsFieldsProps) {
  const inputClassName =
    "h-10 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 py-0 !text-[12px] font-light text-[var(--app-text-secondary)] shadow-none placeholder:text-[var(--app-text-secondary)] placeholder:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-offset-0";
  const labelClassName = "sr-only";

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-3">
        <Label htmlFor="billing-holder-name" className={labelClassName}>
          Nome ou razão social
        </Label>
        <Input
          id="billing-holder-name"
          autoComplete="name"
          required
          minLength={2}
          placeholder="Nome ou razão social"
          value={name}
          disabled={disabled}
          onChange={(event) => onNameChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-email" className={labelClassName}>
          E-mail
        </Label>
        <Input
          id="billing-email"
          type="email"
          autoComplete="email"
          required
          placeholder="E-mail"
          value={email}
          disabled={disabled}
          onChange={(event) => onEmailChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-document" className={labelClassName}>
          CPF/CNPJ
        </Label>
        <Input
          id="billing-document"
          inputMode="numeric"
          required
          pattern="[0-9.\/-]{11,18}"
          title="Informe um CPF ou CNPJ com 11 ou 14 números."
          placeholder="CPF/CNPJ"
          value={document}
          disabled={disabled}
          onChange={(event) => onDocumentChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-phone" className={labelClassName}>
          Celular
        </Label>
        <Input
          id="billing-phone"
          type="tel"
          autoComplete="tel"
          required
          placeholder="Celular"
          value={phone}
          disabled={disabled}
          onChange={(event) => onPhoneChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-country" className={labelClassName}>
          País de residência
        </Label>
        <Input
          id="billing-country"
          placeholder="País de residência"
          value="Brasil"
          readOnly
          disabled={disabled}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-postal-code" className={labelClassName}>
          CEP
        </Label>
        <Input
          id="billing-postal-code"
          inputMode="numeric"
          autoComplete="postal-code"
          required
          pattern="[0-9-]{8,9}"
          title="Informe um CEP com 8 números."
          placeholder="CEP"
          value={postalCode}
          disabled={disabled}
          onChange={(event) => onPostalCodeChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-4">
        <Label htmlFor="billing-address" className={labelClassName}>
          Endereço
        </Label>
        <Input
          id="billing-address"
          autoComplete="street-address"
          required
          minLength={3}
          placeholder="Endereço"
          value={address}
          disabled={disabled}
          onChange={(event) => onAddressChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="billing-address-number" className={labelClassName}>
          Número
        </Label>
        <Input
          id="billing-address-number"
          autoComplete="address-line2"
          required
          placeholder="Número"
          value={addressNumber}
          disabled={disabled}
          onChange={(event) => onAddressNumberChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-address-complement" className={labelClassName}>
          Complemento{" "}
          <span className="text-[var(--app-text-tertiary)]">(opcional)</span>
        </Label>
        <Input
          id="billing-address-complement"
          placeholder="Complemento (opcional)"
          value={addressComplement}
          disabled={disabled}
          onChange={(event) => onAddressComplementChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor="billing-neighborhood" className={labelClassName}>
          Bairro
        </Label>
        <Input
          id="billing-neighborhood"
          required
          placeholder="Bairro"
          value={neighborhood}
          disabled={disabled}
          onChange={(event) => onNeighborhoodChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-4">
        <Label htmlFor="billing-city" className={labelClassName}>
          Cidade
        </Label>
        <Input
          id="billing-city"
          autoComplete="address-level2"
          required
          placeholder="Cidade"
          value={city}
          disabled={disabled}
          onChange={(event) => onCityChange(event.target.value)}
          className={inputClassName}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="billing-state" className={labelClassName}>
          UF
        </Label>
        <Input
          id="billing-state"
          autoComplete="address-level1"
          required
          minLength={2}
          maxLength={2}
          placeholder="UF"
          value={state}
          disabled={disabled}
          onChange={(event) => onStateChange(event.target.value.toUpperCase())}
          className={inputClassName}
        />
      </div>
    </div>
  );
}

type CheckoutScreenProps = {
  organizationId?: string | null;
  checkoutToken?: string | null;
};

export default function Checkout(props: CheckoutScreenProps = {}) {
  const organizationId = props.organizationId?.trim() || null;
  const checkoutToken = organizationId
    ? null
    : props.checkoutToken?.trim() || null;
  const identity = organizationId
    ? `organization:${organizationId}`
    : `payment:${checkoutToken || "invalid"}`;

  return (
    <CheckoutContent
      key={identity}
      organizationId={organizationId}
      checkoutToken={checkoutToken}
    />
  );
}

function CheckoutContent({
  organizationId: organizationIdProp,
  checkoutToken: checkoutTokenProp,
}: CheckoutScreenProps = {}) {
  const organizationId = organizationIdProp?.trim() || null;
  const token = organizationId
    ? undefined
    : checkoutTokenProp?.trim() || undefined;
  const hasCheckoutIdentity = Boolean(token || organizationId);
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const managingPaymentMethod = Boolean(
    info?.checkout_access?.can_manage_payment_method,
  );
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [checkoutLoadError, setCheckoutLoadError] = useState<
    {
      message: string;
      notFound: boolean;
    } | null
  >(null);
  const [tab, setTab] = useState<PaymentMethod>("PIX");
  const [submitting, setSubmitting] = useState(false);
  const [submittedMethod, setSubmittedMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [processingMethod, setProcessingMethod] = useState<
    PaymentMethod | null
  >(null);
  const [pixResult, setPixResult] = useState<PixResult | null>(null);
  const [boletoResult, setBoletoResult] = useState<BoletoResult | null>(null);
  const [cancellingDirectPayment, setCancellingDirectPayment] = useState(false);
  const [directPollingExpired, setDirectPollingExpired] = useState(false);
  const [directPollingNonce, setDirectPollingNonce] = useState(0);
  const [activeCheckout, setActiveCheckout] = useState<ActiveCheckout | null>(
    null,
  );
  const [recoveryState, setRecoveryState] = useState<
    PaymentRecoveryState | null
  >(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [cardFailureMessage, setCardFailureMessage] = useState<string | null>(
    null,
  );
  const [recurrenceWarning, setRecurrenceWarning] = useState<string | null>(
    null,
  );
  const [recurrenceState, setRecurrenceState] = useState<CardRecurrenceState>(
    "unknown",
  );
  const [bankSlipRegistrationCancelled, setBankSlipRegistrationCancelled] =
    useState(false);
  const [recoveryIntentOverride, setRecoveryIntentOverride] = useState<
    string | null
  >(null);
  const [recoveryPaymentOverride, setRecoveryPaymentOverride] = useState<
    string | null
  >(null);
  const [directCardSubscriptionId, setDirectCardSubscriptionId] = useState<
    string | null
  >(null);
  const [directCardUpdateJobId, setDirectCardUpdateJobId] = useState<
    string | null
  >(null);
  const [directCardUpdateMode, setDirectCardUpdateMode] = useState<
    "settled_payment" | "saved_only" | null
  >(null);
  const [paid, setPaid] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState<
    CheckoutPaymentReceiptReference | null
  >(null);
  const [paymentReceiptLoading, setPaymentReceiptLoading] = useState(false);
  const [awaitingCardConfirmation, setAwaitingCardConfirmation] = useState(
    false,
  );
  const [selectedPeriodMonths, setSelectedPeriodMonths] = useState<
    number | null
  >(null);
  const [billingDetailsConfirmed, setBillingDetailsConfirmed] = useState(false);
  const [planSelectorOpen, setPlanSelectorOpen] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<PublicCheckoutPlan[]>(
    [],
  );
  const [plansLoading, setPlansLoading] = useState(false);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const periodSectionRef = useRef<HTMLElement>(null);
  const paymentFormRef = useRef<HTMLFormElement>(null);
  const planChangeInFlightRef = useRef(false);
  const paymentRequestInFlightRef = useRef(false);
  const cardRequestIdentityRef = useRef<
    {
      fingerprint: string;
      idempotencyKey: string;
    } | null
  >(null);
  const checkoutLoadGenerationRef = useRef(0);
  const cardUpdateStorageKeyRef = useRef<Promise<string> | null>(null);
  const cardUpdateStorageIdentity = organizationId
    ? `organization:${organizationId}`
    : token
    ? `payment:${token}`
    : null;

  const clearCardRequestIdentity = useCallback(() => {
    cardRequestIdentityRef.current = null;
  }, []);

  const getCardUpdateStorageKey = useCallback(() => {
    if (!cardUpdateStorageIdentity) return null;
    cardUpdateStorageKeyRef.current ??= cardUpdateSessionStorageKey(
      cardUpdateStorageIdentity,
    );
    return cardUpdateStorageKeyRef.current;
  }, [cardUpdateStorageIdentity]);

  const rememberCardUpdateJob = useCallback(async (
    job: Omit<PersistedCardUpdateJob, "version" | "createdAt">,
  ) => {
    const key = getCardUpdateStorageKey();
    if (!key) return;
    try {
      window.sessionStorage.setItem(
        await key,
        JSON.stringify(
          {
            version: 1,
            ...job,
            createdAt: Date.now(),
          } satisfies PersistedCardUpdateJob,
        ),
      );
    } catch {
      // Polling remains available in the current render even when browser
      // storage is unavailable or full.
    }
  }, [getCardUpdateStorageKey]);

  const forgetCardUpdateJob = useCallback(async () => {
    const key = getCardUpdateStorageKey();
    if (!key) return;
    try {
      window.sessionStorage.removeItem(await key);
    } catch {
      // Storage cleanup is best effort; every restored job is server-verified.
    }
  }, [getCardUpdateStorageKey]);

  const readCheckoutInfo = useCallback(async () => {
    if (organizationId) {
      return paymentsAPI.checkoutBillingProfile<CheckoutInfo>(organizationId);
    }
    if (token) {
      return paymentsAPI.checkoutInfo<CheckoutInfo>({ token });
    }
    throw new Error("Checkout invalido.");
  }, [organizationId, token]);

  const receiptPaymentId = activeCheckout?.payment_id ||
    pixResult?.payment_id ||
    boletoResult?.payment_id ||
    recoveryPaymentOverride ||
    null;

  const capturePaymentReceipt = useCallback((value: unknown) => {
    const receipt = parseCheckoutPaymentReceiptReference(value);
    if (receipt) setPaymentReceipt(receipt);
    return receipt;
  }, []);

  const refreshPaymentReceipt = useCallback(async () => {
    if (!hasCheckoutIdentity) return null;

    setPaymentReceiptLoading(true);
    try {
      const status = await paymentsAPI.paymentStatus<PaymentStatusResponse>({
        checkoutToken: token,
        organizationId,
        paymentId: receiptPaymentId,
      });
      return capturePaymentReceipt(status.receipt);
    } catch {
      // Payment activation stays successful even if this optional read fails.
      // The immutable receipt remains available through the delivery channels.
      return null;
    } finally {
      setPaymentReceiptLoading(false);
    }
  }, [
    capturePaymentReceipt,
    hasCheckoutIdentity,
    organizationId,
    receiptPaymentId,
    token,
  ]);

  // Shared billing profile used by Pix, boleto and card.
  const [holderEmail, setHolderEmail] = useState("");
  const [holderCpf, setHolderCpf] = useState("");
  const [holderPhone, setHolderPhone] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderPostalCode, setHolderPostalCode] = useState("");
  const [holderAddress, setHolderAddress] = useState("");
  const [holderAddressNumber, setHolderAddressNumber] = useState("");
  const [holderAddressComplement, setHolderAddressComplement] = useState("");
  const [holderNeighborhood, setHolderNeighborhood] = useState("");
  const [holderCity, setHolderCity] = useState("");
  const [holderState, setHolderState] = useState("");

  // Card data stays only in React memory until it is sent once to Asaas.
  // It is never copied to sessionStorage, localStorage or the Vimob database.
  const [cardHolderName, setCardHolderName] = useState("");
  const [cardHolderDocument, setCardHolderDocument] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiryMonth, setCardExpiryMonth] = useState("");
  const [cardExpiryYear, setCardExpiryYear] = useState("");
  const [cardCcv, setCardCcv] = useState("");

  const clearPaymentState = useCallback((clearCard = false) => {
    setActiveCheckout(null);
    setPixResult(null);
    setBoletoResult(null);
    setProcessingMethod(null);
    setRecoveryState(null);
    setRecoveryMessage(null);
    setCardFailureMessage(null);
    setRecurrenceWarning(null);
    setRecurrenceState("unknown");
    setBankSlipRegistrationCancelled(false);
    setRecoveryIntentOverride(null);
    setRecoveryPaymentOverride(null);
    setDirectCardSubscriptionId(null);
    setDirectCardUpdateJobId(null);
    setDirectCardUpdateMode(null);
    setPaymentReceipt(null);
    setPaymentReceiptLoading(false);
    setAwaitingCardConfirmation(false);
    setDirectPollingExpired(false);
    if (clearCard) {
      setCardNumber("");
      setCardExpiryMonth("");
      setCardExpiryYear("");
      setCardCcv("");
    }
  }, []);

  const applyCardRecurrenceSignal = useCallback(
    (signal: CardRecurrenceSignal, message?: string | null) => {
      const nextState = resolveCardRecurrenceState(signal);
      setRecurrenceState(nextState);

      if (nextState === "saved") {
        setRecurrenceWarning(null);
      } else if (nextState === "processing") {
        setRecurrenceWarning(
          message ||
            "Pagamento confirmado. O cartão ainda está sendo conciliado para as próximas cobranças.",
        );
      } else if (nextState === "failed") {
        setRecurrenceWarning(
          message ||
            "Pagamento confirmado, mas o cartão recorrente não foi salvo. Atualize a forma de pagamento antes da próxima cobrança.",
        );
      }

      return nextState;
    },
    [],
  );

  const hydrateActiveCheckout = useCallback(
    (checkout?: ActiveCheckout | null) => {
      if (!checkout) {
        clearPaymentState();
        return;
      }

      setActiveCheckout(checkout);
      setBillingDetailsConfirmed(true);
      if (supportedBillingPeriods.has(checkout.billing_period_months)) {
        setSelectedPeriodMonths(checkout.billing_period_months);
      }
      setTab(checkout.billing_method);
      setRecoveryMessage(null);
      setDirectPollingExpired(false);

      if (checkout.billing_method === "CREDIT_CARD") {
        setCardNumber("");
        setCardExpiryMonth("");
        setCardExpiryYear("");
        setCardCcv("");
        setDirectCardSubscriptionId(checkout.subscription_id);
        setAwaitingCardConfirmation(true);
        setProcessingMethod(null);
        if (isCardFailureStatus(checkout.provider_status)) {
          setCardFailureMessage(
            "O cartão foi recusado. Cancele esta tentativa para informar outro cartão.",
          );
          setDirectPollingExpired(true);
        }
        return;
      }

      setProcessingMethod(checkout.billing_method);
    },
    [clearPaymentState],
  );

  useEffect(() => {
    const generation = ++checkoutLoadGenerationRef.current;
    let active = true;
    const isCurrentGeneration = () =>
      active && checkoutLoadGenerationRef.current === generation;

    void (async () => {
      setLoading(true);
      setCheckoutLoadError(null);
      try {
        if (!hasCheckoutIdentity) {
          setInfo(null);
          setCheckoutLoadError({
            message: "O link deste checkout é inválido.",
            notFound: true,
          });
          return;
        }

        const data = await readCheckoutInfo();
        if (!isCurrentGeneration()) return;
        let initialPaymentStatus: PaymentStatusResponse | null = null;
        let initialPaymentStatusError: string | null = null;
        if (
          data.checkout_access?.scope === "payment" &&
          token &&
          !data.checkout_access.payment_settled
        ) {
          try {
            initialPaymentStatus = await paymentsAPI.paymentStatus<
              PaymentStatusResponse
            >({
              checkoutToken: token,
              paymentId: data.active_checkout?.payment_id || null,
            });
          } catch (error) {
            if (!isCurrentGeneration()) return;
            initialPaymentStatusError = getErrorMessage(error) ||
              "Não foi possível confirmar o estado desta cobrança agora.";
          }
        }
        if (!isCurrentGeneration()) return;
        setInfo(data);
        const checkoutParams = new URLSearchParams(window.location.search);
        const preferredPaymentMethod = parseCheckoutPaymentMethod(
          checkoutParams.get("method"),
        );
        const paymentScoped = data.checkout_access?.scope === "payment";
        if (paymentScoped) {
          clearPaymentState();
          const bankRegistrationCancelled = Boolean(
            initialPaymentStatus?.bank_slip_registration_cancelled ||
              initialPaymentStatus?.code ===
                "bank_slip_registration_cancelled" ||
              data.checkout_access?.bank_slip_registration_cancelled,
          );
          setBankSlipRegistrationCancelled(bankRegistrationCancelled);
          if (initialPaymentStatus) {
            setRecoveryState(initialPaymentStatus.state);
            setRecoveryMessage(
              bankRegistrationCancelled
                ? "O boleto expirou ou teve o registro bancário cancelado. Gere um novo boleto ou escolha outra forma de pagamento."
                : initialPaymentStatus.message || null,
            );
            capturePaymentReceipt(initialPaymentStatus.receipt);

            if (initialPaymentStatus.state === "settled") {
              setPaid(true);
            } else if (initialPaymentStatus.state === "cancelled") {
              setDirectPollingExpired(true);
            } else if (initialPaymentStatus.state === "assisted") {
              setDirectPollingExpired(true);
            }
          } else if (initialPaymentStatusError) {
            setRecoveryState("assisted");
            setRecoveryMessage(initialPaymentStatusError);
            setDirectPollingExpired(true);
          }
          const scopedMethod = data.active_checkout?.billing_method;
          if (
            scopedMethod === "CREDIT_CARD" &&
            (initialPaymentStatus?.state === "settled" ||
              data.checkout_access?.payment_settled)
          ) {
            applyCardRecurrenceSignal(
              initialPaymentStatus || data.checkout_access || {},
              initialPaymentStatus?.message,
            );
          }
          if (
            scopedMethod &&
            ["PIX", "BOLETO", "CREDIT_CARD"].includes(scopedMethod)
          ) {
            setTab(scopedMethod);
          }
          if (
            data.active_checkout &&
            supportedBillingPeriods.has(
              data.active_checkout.billing_period_months,
            )
          ) {
            setSelectedPeriodMonths(data.active_checkout.billing_period_months);
          }
          if (
            data.active_checkout &&
            (initialPaymentStatus?.state === "processing" ||
              ["AWAITING_RISK_ANALYSIS", "AUTHORIZED", "PROCESSING"].includes(
                (data.checkout_access?.payment_status || "").toUpperCase(),
              ))
          ) {
            setRecoveryIntentOverride(data.active_checkout.intent_id || null);
            setRecoveryPaymentOverride(data.active_checkout.payment_id || null);
            setProcessingMethod(data.active_checkout.billing_method);
          }
        } else {
          if (data.checkout_access?.can_manage_payment_method) {
            setTab("CREDIT_CARD");
          } else if (!data.active_checkout && preferredPaymentMethod) {
            setTab(preferredPaymentMethod);
          }
          hydrateActiveCheckout(data.active_checkout);
        }
        const availablePeriods = normalizeBillingPeriods(
          data.plan?.billing_periods,
        );
        if (!data.active_checkout) {
          setSelectedPeriodMonths(
            availablePeriods.includes(1) ? 1 : (availablePeriods[0] ?? null),
          );
        }
        const storedProfile =
          data.checkout_access?.use_stored_billing_profile &&
            data.billing_profile_summary?.complete
            ? data.billing_profile_summary
            : null;
        if (storedProfile) {
          setHolderName(storedProfile.name);
          setHolderEmail(storedProfile.email);
          setHolderCpf(storedProfile.cpf_cnpj);
          setHolderPhone(storedProfile.phone);
          setHolderPostalCode(storedProfile.postal_code);
          setHolderAddress(storedProfile.address);
          setHolderAddressNumber(storedProfile.address_number);
          setHolderAddressComplement(storedProfile.address_complement);
          setHolderNeighborhood(storedProfile.neighborhood);
          setHolderCity(storedProfile.city);
          setHolderState(storedProfile.state);
          setBillingDetailsConfirmed(true);
        } else {
          const authorizedProfile = data.billing_profile || null;
          const sessionProfile = consumeCheckoutBillingProfileSession(
            data.organization.id,
          );
          if (authorizedProfile) {
            setHolderName(authorizedProfile.name);
            setHolderEmail(authorizedProfile.email);
            setHolderCpf(authorizedProfile.cpf_cnpj);
            setHolderPhone(authorizedProfile.phone);
            setHolderPostalCode(authorizedProfile.postal_code);
            setHolderAddress(authorizedProfile.address);
            setHolderAddressNumber(authorizedProfile.address_number);
            setHolderAddressComplement(authorizedProfile.address_complement);
            setHolderNeighborhood(authorizedProfile.neighborhood);
            setHolderCity(authorizedProfile.city);
            setHolderState(authorizedProfile.state);
          } else if (sessionProfile) {
            setHolderName(sessionProfile.name);
            setHolderEmail(sessionProfile.email);
            setHolderCpf(sessionProfile.cpf_cnpj);
            setHolderPhone(sessionProfile.phone);
          }
          const draftProfile = token
            ? loadCheckoutBillingDraftSession(token, data.organization.id)
            : null;
          if (draftProfile) {
            setHolderName(draftProfile.name);
            setHolderEmail(draftProfile.email);
            setHolderCpf(draftProfile.cpf_cnpj);
            setHolderPhone(draftProfile.phone);
            setHolderPostalCode(draftProfile.postal_code);
            setHolderAddress(draftProfile.address);
            setHolderAddressNumber(draftProfile.address_number);
            setHolderAddressComplement(draftProfile.address_complement);
            setHolderNeighborhood(draftProfile.neighborhood);
            setHolderCity(draftProfile.city);
            setHolderState(draftProfile.state);
          }
          // An authenticated profile is only a convenience. Do not hold the
          // public checkout loading screen while Supabase resolves a session.
          if (token && !authorizedProfile) {
            void paymentsAPI
              .checkoutBillingProfile<CheckoutInfo>(data.organization.id)
              .then((authorizedInfo) => {
                if (!isCurrentGeneration()) return;
                const billingProfile = authorizedInfo.billing_profile;
                if (!billingProfile) return;
                setHolderName(
                  (current) => current || billingProfile.name || "",
                );
                setHolderEmail(
                  (current) => current || billingProfile.email || "",
                );
                setHolderCpf(
                  (current) => current || billingProfile.cpf_cnpj || "",
                );
                setHolderPhone(
                  (current) => current || billingProfile.phone || "",
                );
                setHolderPostalCode(
                  (current) => current || billingProfile.postal_code || "",
                );
                setHolderAddress(
                  (current) => current || billingProfile.address || "",
                );
                setHolderAddressNumber(
                  (current) => current || billingProfile.address_number || "",
                );
                setHolderAddressComplement(
                  (current) =>
                    current || billingProfile.address_complement || "",
                );
                setHolderNeighborhood(
                  (current) => current || billingProfile.neighborhood || "",
                );
                setHolderCity(
                  (current) => current || billingProfile.city || "",
                );
                setHolderState(
                  (current) => current || billingProfile.state || "",
                );
              })
              .catch(() => {
                // Public checkout remains usable without an authenticated session.
              });
          }
        }
        const checkoutOutcome = checkoutParams.get("checkout");
        if (data.checkout_access?.bank_slip_registration_cancelled) {
          setBankSlipRegistrationCancelled(true);
          setBoletoResult(null);
          setProcessingMethod(null);
          setRecoveryMessage(
            "O boleto expirou ou teve o registro bancário cancelado. Gere um novo boleto ou escolha outra forma de pagamento.",
          );
        }
        if (
          data.checkout_access?.recurrence_saved !== undefined ||
          data.checkout_access?.recurrence_processing !== undefined ||
          data.checkout_access?.recurrence_save_failed !== undefined ||
          data.checkout_access?.requires_payment_method_update !== undefined
        ) {
          applyCardRecurrenceSignal(data.checkout_access);
        }
        if (isCheckoutActivated(data)) {
          setPaid(true);
        } else if (checkoutOutcome === "success") {
          setAwaitingCardConfirmation(true);
          setProcessingMethod("CREDIT_CARD");
          toast.info("Pagamento enviado. Estamos aguardando a confirmação.");
        } else if (checkoutOutcome === "cancelled") {
          toast.info(
            "Checkout cancelado. Nenhuma nova assinatura foi ativada.",
          );
        } else if (checkoutOutcome === "expired") {
          if (token) clearCheckoutBillingDraftSession(token);
          toast.error(
            "O link de pagamento expirou. Gere um novo checkout para continuar.",
          );
        }
      } catch (error: unknown) {
        if (!isCurrentGeneration()) return;
        const message = getErrorMessage(error) ||
          "Não foi possível carregar o checkout agora.";
        setInfo(null);
        setCheckoutLoadError({
          message,
          notFound: getHTTPStatus(error) === 404,
        });
      } finally {
        if (isCurrentGeneration()) setLoading(false);
      }
    })();

    return () => {
      active = false;
      if (checkoutLoadGenerationRef.current === generation) {
        checkoutLoadGenerationRef.current += 1;
      }
    };
  }, [
    applyCardRecurrenceSignal,
    capturePaymentReceipt,
    clearPaymentState,
    hasCheckoutIdentity,
    hydrateActiveCheckout,
    loadAttempt,
    readCheckoutInfo,
    token,
  ]);

  useEffect(() => {
    if (
      loading || !info || !hasCheckoutIdentity || directCardUpdateJobId
    ) return;

    let active = true;
    void (async () => {
      const key = getCardUpdateStorageKey();
      if (!key) return;
      try {
        const resolvedKey = await key;
        const storedValue = window.sessionStorage.getItem(resolvedKey);
        const stored = parsePersistedCardUpdateJob(storedValue);
        if (!stored) {
          if (storedValue) window.sessionStorage.removeItem(resolvedKey);
          return;
        }
        if (!active) return;
        setDirectCardUpdateJobId(stored.jobId);
        setDirectCardUpdateMode(stored.mode);
        setRecoveryPaymentOverride(stored.paymentId);
        setDirectCardSubscriptionId(stored.subscriptionId);
        setRecurrenceState("processing");
        setRecoveryState("processing");
        setRecoveryMessage(
          "Retomamos a verificacao segura da atualizacao do cartao.",
        );
        setProcessingMethod(
          stored.mode === "settled_payment" ? "CREDIT_CARD" : null,
        );
        setDirectPollingExpired(false);
      } catch {
        // A missing/blocked session store does not weaken server-side fencing.
      }
    })();

    return () => {
      active = false;
    };
  }, [
    directCardUpdateJobId,
    getCardUpdateStorageKey,
    hasCheckoutIdentity,
    info,
    loading,
  ]);

  useEffect(() => {
    if (!paid) return;
    const timer = window.setTimeout(() => {
      void refreshPaymentReceipt();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [paid, refreshPaymentReceipt]);

  useEffect(() => {
    const organizationId = info?.organization.id;
    if (
      !token ||
      !organizationId ||
      loading ||
      paid ||
      info?.checkout_access?.use_stored_billing_profile
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      saveCheckoutBillingDraftSession(token, organizationId, {
        name: holderName,
        email: holderEmail,
        cpf_cnpj: holderCpf,
        phone: holderPhone,
        country: "BR",
        postal_code: holderPostalCode,
        address: holderAddress,
        address_number: holderAddressNumber,
        address_complement: holderAddressComplement,
        neighborhood: holderNeighborhood,
        city: holderCity,
        state: holderState,
      });
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [
    holderAddress,
    holderAddressComplement,
    holderAddressNumber,
    holderCity,
    holderCpf,
    holderEmail,
    holderName,
    holderNeighborhood,
    holderPhone,
    holderPostalCode,
    holderState,
    info?.organization.id,
    info?.checkout_access?.use_stored_billing_profile,
    loading,
    paid,
    token,
  ]);

  useEffect(() => {
    if (paid && token) clearCheckoutBillingDraftSession(token);
  }, [paid, token]);

  useEffect(() => {
    if (!planSelectorOpen || availablePlans.length > 0) return;

    const controller = new AbortController();
    const loadPlans = async () => {
      setPlansLoading(true);
      try {
        setAvailablePlans(await fetchPublicCheckoutPlans(controller.signal));
      } catch (error) {
        if (controller.signal.aborted) return;
        toast.error(getErrorMessage(error));
      } finally {
        if (!controller.signal.aborted) setPlansLoading(false);
      }
    };

    void loadPlans();
    return () => controller.abort();
  }, [availablePlans.length, planSelectorOpen]);

  const recoveryMethod: PaymentMethod | null = activeCheckout?.billing_method ||
    processingMethod ||
    (pixResult
      ? "PIX"
      : boletoResult
      ? "BOLETO"
      : awaitingCardConfirmation
      ? "CREDIT_CARD"
      : null);
  const recoveryIntentId = activeCheckout?.intent_id || recoveryIntentOverride;
  const recoveryPaymentId = activeCheckout?.payment_id ||
    pixResult?.payment_id ||
    boletoResult?.payment_id ||
    recoveryPaymentOverride ||
    null;
  const recoverySubscriptionId = activeCheckout?.subscription_id ||
    directCardSubscriptionId;

  // Provider status and organization activation are separate confirmations.
  // Recover the provider artifacts first, then keep checking the canonical
  // checkout until the selected plan is effectively promoted.
  useEffect(() => {
    if (
      !hasCheckoutIdentity ||
      !recoveryMethod ||
      (directCardUpdateJobId && directCardUpdateMode === "saved_only") ||
      (paid && recurrenceState !== "processing")
    ) {
      return;
    }

    let attempts = 0;
    let checking = false;
    let mounted = true;
    const maxAttempts = recoveryMethod === "CREDIT_CARD" ? 24 : 60;

    const checkRecovery = async () => {
      if (!mounted || checking || attempts >= maxAttempts) return;
      checking = true;
      attempts += 1;

      try {
        const statusResult = await paymentsAPI.paymentStatus<
          PaymentStatusResponse
        >({
          checkoutToken: token,
          organizationId,
          intentId: recoveryIntentId,
          paymentId: recoveryPaymentId,
          subscriptionId: recoverySubscriptionId,
        });
        if (!mounted) return;

        const checkout = statusResult.checkout;
        const method = checkout?.billing_method || recoveryMethod;
        const paymentId = checkout?.payment_id || statusResult.payment?.id ||
          recoveryPaymentId;
        const amount = statusResult.payment?.value ?? checkout?.amount ?? 0;
        setRecoveryState(statusResult.state);
        setRecoveryMessage(statusResult.message || null);
        capturePaymentReceipt(statusResult.receipt);

        if (
          statusResult.bank_slip_registration_cancelled ||
          statusResult.code === "bank_slip_registration_cancelled"
        ) {
          setBankSlipRegistrationCancelled(true);
          setBoletoResult(null);
          setProcessingMethod(null);
          setActiveCheckout(null);
          setRecoveryState("retry");
          setRecoveryMessage(
            "O boleto expirou ou teve o registro bancário cancelado. Gere um novo boleto ou escolha outra forma de pagamento.",
          );
          window.clearInterval(interval);
          return;
        }

        if (statusResult.state === "settled") {
          const recurrence = method === "CREDIT_CARD" && !directCardUpdateJobId
            ? applyCardRecurrenceSignal(statusResult, statusResult.message)
            : directCardUpdateJobId
            ? "processing"
            : "unknown";
          setPaid(true);
          setAwaitingCardConfirmation(false);
          setProcessingMethod(null);
          setCardFailureMessage(null);
          if (
            directCardUpdateJobId || method !== "CREDIT_CARD" ||
            recurrence !== "processing"
          ) {
            window.clearInterval(interval);
          }
          if (!capturePaymentReceipt(statusResult.receipt)) {
            void refreshPaymentReceipt();
          }
          if (!paid) toast.success("Pagamento confirmado! 🎉");
          return;
        }

        if (checkout) {
          setActiveCheckout(checkout);
          setTab(checkout.billing_method);
          if (supportedBillingPeriods.has(checkout.billing_period_months)) {
            setSelectedPeriodMonths(checkout.billing_period_months);
          }
          if (checkout.subscription_id) {
            setDirectCardSubscriptionId(checkout.subscription_id);
          }
        }

        if (statusResult.state === "cancelled") {
          clearPaymentState(true);
          window.clearInterval(interval);
          toast.info(
            "A tentativa anterior foi cancelada. Escolha uma nova forma de pagamento.",
          );
          return;
        }

        if (method === "PIX" && paymentId) {
          setPixResult((current) => ({
            type: "PIX",
            payment_id: paymentId,
            invoice_url: statusResult.payment?.invoice_url ||
              current?.invoice_url || "",
            qr_code: statusResult.pix?.qr_code || current?.qr_code || "",
            qr_payload: statusResult.pix?.qr_payload || current?.qr_payload ||
              "",
            value: amount || current?.value || 0,
          }));
          if (statusResult.pix?.qr_code || statusResult.pix?.qr_payload) {
            setProcessingMethod(null);
          }
        } else if (method === "BOLETO" && paymentId) {
          setBoletoResult((current) => ({
            type: "BOLETO",
            payment_id: paymentId,
            invoice_url: statusResult.payment?.invoice_url ||
              current?.invoice_url || "",
            bank_slip_url: statusResult.boleto?.bank_slip_url ||
              current?.bank_slip_url ||
              "",
            identification_field: statusResult.boleto?.identification_field ||
              current?.identification_field ||
              "",
            bar_code: statusResult.boleto?.bar_code || current?.bar_code || "",
            due_date: statusResult.payment?.due_date ?? current?.due_date ??
              null,
            value: amount || current?.value || 0,
          }));
          if (
            statusResult.payment?.invoice_url ||
            statusResult.boleto?.bank_slip_url ||
            statusResult.boleto?.identification_field ||
            statusResult.boleto?.bar_code
          ) {
            setProcessingMethod(null);
          }
        } else if (method === "CREDIT_CARD") {
          setAwaitingCardConfirmation(true);
          setProcessingMethod(null);
          const providerStatus = checkout?.provider_status ||
            statusResult.payment?.status;
          if (
            isCardFailureStatus(providerStatus) ||
            statusResult.state === "retry"
          ) {
            setCardFailureMessage(
              statusResult.message ||
                "O cartão foi recusado. Cancele esta tentativa para informar outro cartão.",
            );
            setDirectPollingExpired(true);
            window.clearInterval(interval);
            return;
          }
          if (statusResult.state === "assisted") {
            setCardFailureMessage(null);
            setDirectPollingExpired(true);
            window.clearInterval(interval);
            return;
          }
        }

        if (statusResult.state === "assisted") {
          setDirectPollingExpired(true);
          window.clearInterval(interval);
          return;
        }

        const canonicalInfo = await readCheckoutInfo();
        if (!mounted) return;
        setInfo(canonicalInfo);
        if (
          canonicalInfo.active_checkout &&
          canonicalInfo.checkout_access?.scope !== "payment"
        ) {
          setActiveCheckout(canonicalInfo.active_checkout);
          if (
            supportedBillingPeriods.has(
              canonicalInfo.active_checkout.billing_period_months,
            )
          ) {
            setSelectedPeriodMonths(
              canonicalInfo.active_checkout.billing_period_months,
            );
          }
        }
        if (isCheckoutActivated(canonicalInfo)) {
          setPaid(true);
          if (!capturePaymentReceipt(statusResult.receipt)) {
            void refreshPaymentReceipt();
          }
          setAwaitingCardConfirmation(false);
          setCardFailureMessage(null);
          window.clearInterval(interval);
          toast.success("Pagamento confirmado! 🎉");
        }
      } catch (error) {
        if (attempts >= 3 && mounted) {
          setRecoveryMessage(
            getErrorMessage(error) ||
              "Ainda não foi possível consultar a cobrança.",
          );
        }
        try {
          const canonicalInfo = await readCheckoutInfo();
          if (!mounted) return;
          setInfo(canonicalInfo);
          if (canonicalInfo.active_checkout) {
            setActiveCheckout(canonicalInfo.active_checkout);
            setBillingDetailsConfirmed(true);
            if (
              supportedBillingPeriods.has(
                canonicalInfo.active_checkout.billing_period_months,
              )
            ) {
              setSelectedPeriodMonths(
                canonicalInfo.active_checkout.billing_period_months,
              );
            }
          }
          if (isCheckoutActivated(canonicalInfo)) {
            setPaid(true);
            void refreshPaymentReceipt();
            setAwaitingCardConfirmation(false);
            setCardFailureMessage(null);
            window.clearInterval(interval);
            toast.success("Pagamento confirmado! 🎉");
          }
        } catch {
          // Both reads are retried by the next recovery cycle.
        }
      } finally {
        checking = false;
        if (attempts >= maxAttempts && mounted) {
          window.clearInterval(interval);
          setDirectPollingExpired(true);
          if (recurrenceState === "processing") {
            setRecurrenceWarning(
              "O pagamento está confirmado, mas a recorrência continua em conciliação. Consulte novamente antes de atualizar o cartão.",
            );
          } else {
            setRecoveryMessage(
              (current) =>
                current || "A confirmação está demorando mais que o esperado.",
            );
          }
        }
      }
    };

    const interval = window.setInterval(() => void checkRecovery(), 5_000);
    void checkRecovery();
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [
    clearPaymentState,
    capturePaymentReceipt,
    directPollingNonce,
    directCardUpdateJobId,
    directCardUpdateMode,
    hasCheckoutIdentity,
    organizationId,
    paid,
    applyCardRecurrenceSignal,
    recoveryIntentId,
    recoveryMethod,
    recoveryPaymentId,
    recoverySubscriptionId,
    recurrenceState,
    refreshPaymentReceipt,
    readCheckoutInfo,
    token,
  ]);

  useEffect(() => {
    if (!hasCheckoutIdentity || !directCardUpdateJobId) return;

    let mounted = true;
    let checking = false;
    let attempts = 0;
    const maxAttempts = 60;

    const checkCardUpdate = async () => {
      if (!mounted || checking || attempts >= maxAttempts) return;
      checking = true;
      attempts += 1;
      try {
        const status = await paymentsAPI.paymentStatus<PaymentStatusResponse>({
          checkoutToken: token,
          organizationId,
          paymentId: directCardUpdateMode === "settled_payment"
            ? recoveryPaymentId
            : null,
          cardUpdateJobId: directCardUpdateJobId,
        });
        if (!mounted) return;
        const update = status.card_update;
        if (!update || update.job_id !== directCardUpdateJobId) {
          throw new Error("A atualizaÃ§Ã£o do cartÃ£o nÃ£o foi localizada.");
        }

        setRecoveryMessage(status.message || null);
        if (update.state === "queued") {
          setRecurrenceState("processing");
          setRecoveryState("processing");
          return;
        }

        window.clearInterval(interval);
        clearCardRequestIdentity();
        if (update.state !== "manual_review") {
          await forgetCardUpdateJob();
        }
        if (update.state === "succeeded") {
          setRecurrenceState("saved");
          setRecurrenceWarning(null);
          setDirectCardUpdateJobId(null);
          setDirectCardUpdateMode(null);
          setProcessingMethod(null);
          setRecoveryState("settled");
          toast.success(
            status.message ||
              "CartÃ£o atualizado para as prÃ³ximas cobranÃ§as.",
          );
          if (directCardUpdateMode === "saved_only") {
            window.location.assign(
              "/settings?tab=subscription&billing=methods&saved=1",
            );
          }
          return;
        }

        const requiresAssistance = update.state === "manual_review";
        setRecurrenceState("failed");
        setRecoveryState(requiresAssistance ? "assisted" : "retry");
        setRecurrenceWarning(
          status.message ||
            (requiresAssistance
              ? "A atualizaÃ§Ã£o do cartÃ£o precisa de verificaÃ§Ã£o do suporte."
              : "O cartÃ£o nÃ£o foi atualizado. Confira os dados e tente novamente."),
        );
        setCardFailureMessage(status.message || null);
        setAwaitingCardConfirmation(false);
        if (requiresAssistance) {
          setProcessingMethod("CREDIT_CARD");
          setDirectPollingExpired(true);
        } else {
          setDirectCardUpdateJobId(null);
          setDirectCardUpdateMode(null);
          setProcessingMethod(null);
        }
      } catch (error) {
        if (mounted && attempts >= 3) {
          setRecoveryMessage(
            getErrorMessage(error) ||
              "Ainda nÃ£o foi possÃ­vel confirmar a atualizaÃ§Ã£o do cartÃ£o.",
          );
        }
      } finally {
        checking = false;
        if (mounted && attempts >= maxAttempts) {
          window.clearInterval(interval);
          setDirectPollingExpired(true);
          setRecoveryMessage(
            "A atualizaÃ§Ã£o continua em conciliaÃ§Ã£o. Tente consultar novamente em instantes.",
          );
        }
      }
    };

    const interval = window.setInterval(() => void checkCardUpdate(), 5_000);
    void checkCardUpdate();
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [
    clearCardRequestIdentity,
    directCardUpdateJobId,
    directCardUpdateMode,
    directPollingNonce,
    forgetCardUpdateJob,
    hasCheckoutIdentity,
    organizationId,
    recoveryPaymentId,
    token,
  ]);

  const handlePlanChange = async (nextPlan: PublicCheckoutPlan) => {
    if (
      !hasCheckoutIdentity ||
      !nextPlan.id ||
      !nextPlan.slug ||
      !nextPlan.name
    ) {
      return;
    }
    if (nextPlan.id === info?.plan?.id) {
      setPlanSelectorOpen(false);
      return;
    }
    if (
      planChangeInFlightRef.current ||
      paymentRequestInFlightRef.current ||
      pixResult ||
      boletoResult ||
      processingMethod ||
      activeCheckout ||
      submitting ||
      awaitingCardConfirmation ||
      paid
    ) {
      toast.error(
        "Cancele ou conclua a cobrança atual antes de trocar o plano.",
      );
      return;
    }

    planChangeInFlightRef.current = true;
    setChangingPlanId(nextPlan.id);
    let updateError: unknown = null;
    try {
      if (organizationId) {
        try {
          await settingsAPI.selectSubscriptionPlan(
            { plan_id: nextPlan.id },
            organizationId,
          );
        } catch (error) {
          updateError = error;
        }
      } else {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetch("/api/onboarding/checkout-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              checkoutToken: token,
              planSlug: nextPlan.slug,
            }),
            signal: controller.signal,
          });
          const payload = (await response
            .json()
            .catch(() => null)) as CheckoutPlanChangeResponse | null;
          if (!response.ok || !payload?.ok) {
            updateError = new Error(
              payload?.message || "Não foi possível trocar o plano.",
            );
          }
        } catch (error) {
          updateError = error;
        } finally {
          window.clearTimeout(timeout);
        }
      }

      // A lost HTTP response does not mean the mutation failed. Re-read the
      // canonical quote and reconcile what the server actually committed.
      let canonicalInfo: CheckoutInfo | null = null;
      for (const delay of [0, 500, 1_000, 2_000]) {
        if (delay > 0) await waitFor(delay);
        try {
          canonicalInfo = await readCheckoutInfo();
          const appliedPlanId = canonicalInfo.organization.pending_plan_id ||
            canonicalInfo.organization.plan_id;
          if (
            appliedPlanId === nextPlan.id &&
            canonicalInfo.plan?.id === nextPlan.id
          ) {
            break;
          }
        } catch (error) {
          updateError = updateError || error;
        }
      }

      if (canonicalInfo) {
        setInfo(canonicalInfo);
        hydrateActiveCheckout(canonicalInfo.active_checkout);
      }

      const appliedPlanId = canonicalInfo?.organization.pending_plan_id ||
        canonicalInfo?.organization.plan_id;
      const planApplied = appliedPlanId === nextPlan.id &&
        canonicalInfo?.plan?.id === nextPlan.id;
      if (!planApplied || !canonicalInfo?.plan) {
        throw (
          updateError ||
          new Error("O plano não pôde ser confirmado. Tente novamente.")
        );
      }

      const selectedPlanAlreadyActive = ["active", "trial"].includes(
        canonicalInfo.organization.subscription_status || "",
      ) &&
        canonicalInfo.organization.plan_id === nextPlan.id &&
        !canonicalInfo.organization.pending_plan_id;
      if (selectedPlanAlreadyActive) {
        window.location.assign(DEFAULT_AUTHENTICATED_ROUTE);
        return;
      }

      const nextPeriods = normalizeBillingPeriods(
        canonicalInfo.plan.billing_periods,
      );
      if (!canonicalInfo.active_checkout) {
        setSelectedPeriodMonths(
          nextPeriods.includes(1) ? 1 : (nextPeriods[0] ?? null),
        );
      }
      setPlanSelectorOpen(false);
      toast.success(`Plano alterado para ${canonicalInfo.plan.name}.`);
    } catch (error) {
      toast.error(getErrorMessage(error) || "Não foi possível trocar o plano.");
    } finally {
      planChangeInFlightRef.current = false;
      setChangingPlanId(null);
    }
  };

  const handleBillingDetailsContinue = () => {
    if (usesStoredBillingProfile) {
      setBillingDetailsConfirmed(true);
      window.requestAnimationFrame(() => {
        (managingPaymentMethod
          ? paymentFormRef.current
          : periodSectionRef.current)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      });
      return;
    }

    const parsed = checkoutBillingDetailsSchema.safeParse({
      name: holderName,
      email: holderEmail,
      cpf_cnpj: holderCpf,
      phone: holderPhone,
      country: "BR",
      postal_code: holderPostalCode,
      address: holderAddress,
      address_number: holderAddressNumber,
      address_complement: holderAddressComplement,
      neighborhood: holderNeighborhood,
      city: holderCity,
      state: holderState,
    });

    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message || "Confira os dados de faturamento.",
      );
      return;
    }

    setHolderName(parsed.data.name);
    setHolderEmail(parsed.data.email);
    setHolderCpf(parsed.data.cpf_cnpj);
    setHolderPhone(parsed.data.phone);
    setHolderPostalCode(parsed.data.postal_code);
    setHolderAddress(parsed.data.address);
    setHolderAddressNumber(parsed.data.address_number);
    setHolderAddressComplement(parsed.data.address_complement);
    setHolderNeighborhood(parsed.data.neighborhood);
    setHolderCity(parsed.data.city);
    setHolderState(parsed.data.state);
    setCardHolderName((current) => current.trim() || parsed.data.name);
    setCardHolderDocument((current) => current.trim() || parsed.data.cpf_cnpj);
    setBillingDetailsConfirmed(true);

    window.requestAnimationFrame(() => {
      (managingPaymentMethod
        ? paymentFormRef.current
        : periodSectionRef.current)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  };

  const handleSubmit = async (billingType: PaymentMethod) => {
    if (!info?.plan) return;
    if (planChangeInFlightRef.current || changingPlanId) {
      toast.error(
        "Aguarde a troca de plano terminar antes de gerar a cobrança.",
      );
      return;
    }
    if (paymentRequestInFlightRef.current) return;
    if (processingMethod || activeCheckout) {
      setDirectPollingExpired(false);
      setDirectPollingNonce((value) => value + 1);
      return;
    }

    paymentRequestInFlightRef.current = true;
    setTab(billingType);
    setSubmittedMethod(billingType);
    setSubmitting(true);
    setRecoveryMessage(null);
    setCardFailureMessage(null);
    setBankSlipRegistrationCancelled(false);
    let chargeRequested = false;
    try {
      if (!selectedPeriodMonths && !managingPaymentMethod) {
        throw new Error("Escolha um período de cobrança para continuar.");
      }

      if (billingType === "CREDIT_CARD") {
        const cardError = validateCardInput({
          holderName: cardHolderName,
          holderDocument: cardHolderDocument,
          number: cardNumber,
          expiryMonth: cardExpiryMonth,
          expiryYear: cardExpiryYear,
          ccv: cardCcv,
        });
        if (cardError) throw new Error(cardError);
      }

      const body: ChargeRequest = {
        billing_type: billingType,
        billing_profile_mode: usesStoredBillingProfile ? "stored" : "manual",
        billing_period_months: selectedPeriodMonths || 1,
        expected_plan_id: info.plan.id,
        expected_monthly_price: info.plan.price,
      };
      if (!usesStoredBillingProfile) {
        body.holder_name = holderName;
        body.holder_email = holderEmail;
        body.holder_cpf_cnpj = holderCpf;
        body.holder_phone = holderPhone;
        body.holder_postal_code = holderPostalCode;
        body.holder_address = holderAddress;
        body.holder_address_number = holderAddressNumber;
        body.holder_address_complement = holderAddressComplement;
        body.holder_neighborhood = holderNeighborhood;
        body.holder_city = holderCity;
        body.holder_state = holderState;
        body.holder_country = "BR";
      }
      if (billingType === "CREDIT_CARD") {
        const fingerprint = await checkoutCardRequestFingerprint([
          organizationId || token || "",
          info.plan.id,
          String(selectedPeriodMonths || 1),
          cardHolderName.trim(),
          cardHolderDocument.replace(/\D/g, ""),
          cardNumber.replace(/\D/g, ""),
          cardExpiryMonth.trim(),
          cardExpiryYear.trim(),
          cardCcv.trim(),
        ]);
        if (cardRequestIdentityRef.current?.fingerprint !== fingerprint) {
          cardRequestIdentityRef.current = {
            fingerprint,
            idempotencyKey: createUUID(),
          };
        }
        body.idempotency_key = cardRequestIdentityRef.current.idempotencyKey;
        body.card = {
          holder_name: cardHolderName.trim(),
          holder_cpf_cnpj: cardHolderDocument.trim(),
          number: cardNumber,
          expiry_month: cardExpiryMonth,
          expiry_year: cardExpiryYear,
          ccv: cardCcv,
        };
      }
      if (organizationId) {
        body.organization_id = organizationId;
      } else if (token) {
        body.checkout_token = token;
      } else {
        throw new Error("Checkout invalido.");
      }

      chargeRequested = true;
      const result = await paymentsAPI.createCharge<ChargeResult>(
        body as unknown as Record<string, unknown>,
      );
      if (!result?.success) throw new Error(result?.error || "Falha");
      if (billingType === "CREDIT_CARD" && !isProcessingResult(result)) {
        clearCardRequestIdentity();
      }

      if (isProcessingResult(result)) {
        const cardUpdateJobId = billingType === "CREDIT_CARD"
          ? result.card_update_job_id || null
          : null;
        const cardUpdateMode = cardUpdateJobId
          ? result.saved_only === true ? "saved_only" : "settled_payment"
          : null;
        const recurrence = billingType === "CREDIT_CARD"
          ? applyCardRecurrenceSignal(result, result.message)
          : "unknown";
        setRecoveryIntentOverride(result.intent_id || null);
        setRecoveryPaymentOverride(result.payment_id || null);
        setDirectCardSubscriptionId(result.subscription_id || null);
        setDirectCardUpdateJobId(cardUpdateJobId);
        setDirectCardUpdateMode(cardUpdateMode);
        if (cardUpdateJobId && cardUpdateMode) {
          void rememberCardUpdateJob({
            jobId: cardUpdateJobId,
            mode: cardUpdateMode,
            paymentId: result.payment_id || null,
            subscriptionId: result.subscription_id || null,
          });
        }
        setProcessingMethod(
          cardUpdateMode === "saved_only" || result.settled
            ? null
            : billingType,
        );
        setRecoveryState("creating");
        setRecoveryMessage(
          result.message ||
            "A cobrança está sendo localizada sem gerar duplicidade.",
        );
        if (billingType === "CREDIT_CARD") {
          setCardNumber("");
          setCardExpiryMonth("");
          setCardExpiryYear("");
          setCardCcv("");
          setAwaitingCardConfirmation(cardUpdateMode !== "saved_only");
          if (result.settled) {
            setPaid(true);
            setAwaitingCardConfirmation(false);
            setRecoveryState("settled");
            setRecoveryPaymentOverride(result.payment_id || null);
            void refreshPaymentReceipt();
            toast.success("Pagamento confirmado.");
            if (recurrence === "unknown") {
              setRecurrenceWarning(
                "Pagamento confirmado. O estado do cartão recorrente ainda não foi informado; confira a forma de pagamento antes da próxima cobrança.",
              );
            }
            return;
          }
        }
        toast.info(
          result.message ||
            "Estamos localizando a cobrança anterior automaticamente.",
        );
        return;
      }

      setProcessingMethod(null);
      if (billingType === "PIX") {
        if (result.type !== "PIX") throw new Error("Resposta Pix invalida");
        setDirectPollingExpired(false);
        setPixResult(result);
        setRecoveryPaymentOverride(result.payment_id);
        if (!result.qr_code && !result.qr_payload) {
          setProcessingMethod("PIX");
          setRecoveryState("creating");
          setRecoveryMessage(
            "O Pix foi criado e o código está sendo preparado.",
          );
        }
      } else if (billingType === "BOLETO") {
        if (result.type !== "BOLETO") {
          throw new Error("Resposta de boleto inválida");
        }
        setDirectPollingExpired(false);
        setBoletoResult(result);
        setRecoveryPaymentOverride(result.payment_id);
        if (
          !result.invoice_url &&
          !result.bank_slip_url &&
          !result.identification_field &&
          !result.bar_code
        ) {
          setProcessingMethod("BOLETO");
          setRecoveryState("creating");
          setRecoveryMessage(
            "O boleto foi criado e os dados bancários estão sendo preparados.",
          );
        }
      } else {
        if (result.type !== "CREDIT_CARD") {
          throw new Error("Resposta de cartão inválida");
        }
        if (!result.hosted) {
          if (result.saved_only && result.recurrence_saved === true) {
            void forgetCardUpdateJob();
            setCardNumber("");
            setCardExpiryMonth("");
            setCardExpiryYear("");
            setCardCcv("");
            toast.success(
              result.message || "Cartão salvo para as próximas cobranças.",
            );
            window.location.assign(
              "/settings?tab=subscription&billing=methods&saved=1",
            );
            return;
          }
          if (result.saved_only) {
            const savedOnlyJobId = result.card_update_job_id || null;
            setDirectCardUpdateJobId(savedOnlyJobId);
            setDirectCardUpdateMode("saved_only");
            if (savedOnlyJobId) {
              void rememberCardUpdateJob({
                jobId: savedOnlyJobId,
                mode: "saved_only",
                paymentId: null,
                subscriptionId: result.subscription_id || null,
              });
            }
            setCardNumber("");
            setCardExpiryMonth("");
            setCardExpiryYear("");
            setCardCcv("");
            setProcessingMethod(null);
            setRecoveryState("processing");
            setRecoveryMessage(
              result.message ||
                "O cartÃ£o foi recebido e estÃ¡ sendo atualizado com seguranÃ§a.",
            );
            toast.info(
              result.message ||
                "A atualizaÃ§Ã£o do cartÃ£o estÃ¡ em processamento.",
            );
            return;
          }
          if (result.settled) {
            const recurrence = applyCardRecurrenceSignal(
              result,
              result.message,
            );
            if (recurrence === "unknown") {
              setRecurrenceWarning(
                "Pagamento confirmado. O estado do cartão recorrente ainda não foi informado; confira a forma de pagamento antes da próxima cobrança.",
              );
            }
            setPaid(true);
            setCardNumber("");
            setCardExpiryMonth("");
            setCardExpiryYear("");
            setCardCcv("");
            setAwaitingCardConfirmation(false);
            setRecoveryPaymentOverride(result.payment_id || null);
            void refreshPaymentReceipt();
            toast.success(result.message || "Pagamento confirmado.");
            return;
          }
          if (!result.subscription_id && !result.payment_id) {
            throw new Error(
              "A confirmação do cartão ainda não está disponível.",
            );
          }
          setDirectCardSubscriptionId(result.subscription_id || null);
          setRecoveryPaymentOverride(result.payment_id || null);
          setCardNumber("");
          setCardExpiryMonth("");
          setCardExpiryYear("");
          setCardCcv("");
          setAwaitingCardConfirmation(true);
          setRecoveryState("pending");
          toast.success(result.message || "Cartão cadastrado com segurança.");
          return;
        }
        throw new Error(
          "O pagamento com cartão precisa ser concluído dentro do checkout da Vimob.",
        );
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error) || "Erro ao processar";
      const errorStatus = getHTTPStatus(error);
      if (
        billingType === "CREDIT_CARD" && errorStatus !== null &&
        errorStatus >= 400 && errorStatus < 500 &&
        ![408, 425, 429].includes(errorStatus)
      ) {
        clearCardRequestIdentity();
      }
      if (chargeRequested && hasCheckoutIdentity) {
        for (const delay of [0, 500, 1_000, 2_000]) {
          if (delay > 0) await waitFor(delay);
          try {
            const canonicalInfo = await readCheckoutInfo();
            setInfo(canonicalInfo);
            if (isCheckoutActivated(canonicalInfo)) {
              setPaid(true);
              void refreshPaymentReceipt();
              toast.success("Pagamento confirmado! 🎉");
              return;
            }
            if (canonicalInfo.active_checkout) {
              if (canonicalInfo.checkout_access?.scope === "payment") {
                setRecoveryIntentOverride(
                  canonicalInfo.active_checkout.intent_id || null,
                );
                setRecoveryPaymentOverride(
                  canonicalInfo.active_checkout.payment_id || null,
                );
                setProcessingMethod(billingType);
              } else {
                hydrateActiveCheckout(canonicalInfo.active_checkout);
              }
              setRecoveryMessage(
                "A resposta foi interrompida, mas a tentativa está sendo recuperada com segurança.",
              );
              toast.info(
                "A tentativa está sendo localizada sem gerar uma nova cobrança.",
              );
              return;
            }
          } catch {
            // A later canonical read may observe an intent committed after the
            // provider response or browser connection was interrupted.
          }
        }
      }
      toast.error(message);
    } finally {
      paymentRequestInFlightRef.current = false;
      setSubmitting(false);
      setSubmittedMethod(null);
    }
  };

  const handleCancelDirectPayment = async () => {
    if (!hasCheckoutIdentity || info?.checkout_access?.scope === "payment") {
      return;
    }

    let intentId = activeCheckout?.intent_id || recoveryIntentOverride;
    let paymentId = activeCheckout?.payment_id ||
      pixResult?.payment_id ||
      boletoResult?.payment_id ||
      recoveryPaymentOverride;
    let subscriptionId = activeCheckout?.subscription_id ||
      directCardSubscriptionId;

    if (!intentId && !paymentId && !subscriptionId) {
      try {
        const canonicalInfo = await readCheckoutInfo();
        setInfo(canonicalInfo);
        intentId = canonicalInfo.active_checkout?.intent_id || null;
        paymentId = canonicalInfo.active_checkout?.payment_id || null;
        subscriptionId = canonicalInfo.active_checkout?.subscription_id || null;
      } catch {
        // The actionable error below is clearer than a second lookup error.
      }
    }

    setCancellingDirectPayment(true);
    try {
      const cancellationRequest: Record<string, string> = {};
      if (organizationId) cancellationRequest.organization_id = organizationId;
      else if (token) cancellationRequest.checkout_token = token;
      if (intentId) cancellationRequest.intent_id = intentId;
      if (paymentId) cancellationRequest.payment_id = paymentId;
      if (subscriptionId) cancellationRequest.subscription_id = subscriptionId;

      const result = await paymentsAPI.cancelPayment<CancelPaymentResult>(
        cancellationRequest,
      );
      if (!result?.success) {
        throw new Error(
          result?.error || "Não foi possível cancelar a cobrança.",
        );
      }

      clearPaymentState(true);
      toast.success(
        "Cobrança cancelada. Você pode escolher outra forma de pagamento.",
      );
    } catch (error: unknown) {
      setRecoveryMessage(
        "Não recebemos a confirmação do cancelamento. Estamos consultando o estado real da cobrança.",
      );
      setDirectPollingExpired(false);
      setDirectPollingNonce((value) => value + 1);
      toast.info(
        getErrorMessage(error)
          ? "A confirmação do cancelamento foi interrompida. O status será reconciliado automaticamente."
          : "Estamos confirmando o cancelamento com segurança.",
      );
    } finally {
      setCancellingDirectPayment(false);
    }
  };

  const handleRetryDirectStatus = () => {
    setDirectPollingExpired(false);
    setCardFailureMessage(null);
    setRecoveryMessage(null);
    setDirectPollingNonce((value) => value + 1);
  };

  const handleUseAnotherPaymentMethod = async () => {
    if (info?.checkout_access?.scope === "payment") {
      clearPaymentState(true);
      setRecoveryMessage(null);
      window.requestAnimationFrame(() => {
        paymentFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      toast.info("Escolha outra forma para pagar a mesma cobrança.");
      return;
    }
    await handleCancelDirectPayment();
  };

  if (loading) {
    return (
      <CheckoutPageShell>
        <div className="flex min-h-[55vh] items-center justify-center">
          <VimobLoader size="lg" label="Carregando checkout..." />
        </div>
      </CheckoutPageShell>
    );
  }

  if (!info) {
    const notFound = checkoutLoadError?.notFound ?? true;
    return (
      <CheckoutPageShell>
        <div className="flex min-h-[55vh] items-center justify-center">
          <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="space-y-4 p-6 text-center sm:p-8">
              <div>
                <h2 className="text-[18px] font-normal text-[var(--app-text-primary)]">
                  {notFound
                    ? "Checkout não encontrado"
                    : "Não foi possível carregar o checkout"}
                </h2>
                <p className="mt-2 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  {notFound
                    ? "Confira se o link está completo ou solicite um novo checkout."
                    : checkoutLoadError?.message ||
                      "A conexão falhou temporariamente. Tente novamente."}
                </p>
              </div>
              {!notFound
                ? (
                  <Button
                    type="button"
                    onClick={() => setLoadAttempt((value) => value + 1)}
                    className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Tentar novamente
                  </Button>
                )
                : null}
            </CardContent>
          </Card>
        </div>
      </CheckoutPageShell>
    );
  }

  const paymentCheckoutUnavailable =
    info.checkout_access?.scope === "payment" &&
    (recoveryState === "cancelled" ||
      (recoveryState === "assisted" && directPollingExpired));

  if (paymentCheckoutUnavailable) {
    const cancelled = recoveryState === "cancelled";
    return (
      <CheckoutPageShell>
        <div className="flex min-h-[55vh] items-center justify-center">
          <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="space-y-4 p-6 text-center sm:p-8">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
                {cancelled
                  ? <ReceiptText className="h-5 w-5" aria-hidden="true" />
                  : <RefreshCw className="h-5 w-5" aria-hidden="true" />}
              </span>
              <h2 className="text-[18px] font-normal">
                {cancelled ? "Cobrança cancelada" : "Pagamento em verificação"}
              </h2>
              <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                {cancelled
                  ? "Esta cobrança não aceita mais pagamentos. Solicite um novo link à sua organização."
                  : recoveryMessage ||
                    "Não liberamos uma nova tentativa enquanto o estado real da cobrança não puder ser confirmado."}
              </p>
              {!cancelled
                ? (
                  <Button
                    type="button"
                    onClick={() => setLoadAttempt((value) => value + 1)}
                    className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Consultar novamente
                  </Button>
                )
                : null}
            </CardContent>
          </Card>
        </div>
      </CheckoutPageShell>
    );
  }

  if (paid) {
    return (
      <CheckoutPageShell>
        <div className="flex min-h-[55vh] items-center justify-center">
          <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="space-y-4 p-6 text-center sm:p-8">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="text-[18px] font-normal">Pagamento confirmado!</h2>
              <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                Sua assinatura do {info.plan?.name}{" "}
                está ativa. Você já pode usar o Vimob normalmente.
              </p>
              {recurrenceWarning
                ? (
                  <div className="rounded-[6px] bg-amber-500/10 p-3 text-left text-[11px] font-light leading-[17px] text-amber-800 dark:text-amber-300">
                    <div className="flex items-start gap-2">
                      {recurrenceState === "processing" &&
                          !directPollingExpired
                        ? (
                          <VimobLoader
                            size="xs"
                            className="mt-0.5"
                            label="Conciliando cartão recorrente..."
                          />
                        )
                        : (
                          <CreditCard
                            className="mt-0.5 h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                      <span>{recurrenceWarning}</span>
                    </div>
                  </div>
                )
                : null}
              {recurrenceState === "saved"
                ? (
                  <div className="flex items-center gap-2 rounded-[6px] bg-emerald-500/10 p-3 text-left text-[11px] font-light text-emerald-700 dark:text-emerald-300">
                    <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Cartão recorrente confirmado para as próximas cobranças.
                  </div>
                )
                : null}
              <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-left">
                <div className="flex items-start gap-3">
                  <ReceiptText
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[12px] font-normal text-[var(--app-text-primary)]">
                      {paymentReceipt
                        ? `Comprovante ${paymentReceipt.number}`
                        : "Comprovante Vimob"}
                    </p>
                    <p className="mt-1 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
                      O envio para o e-mail e o WhatsApp cadastrados foi
                      enfileirado. Você também pode abrir o registro por aqui;
                      ele confirma o pagamento, mas não é documento fiscal.
                    </p>
                  </div>
                </div>
              </div>
              {paymentReceipt
                ? (
                  <Button
                    asChild
                    variant="outline"
                    className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                  >
                    <a
                      href={paymentReceipt.verification_path}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Ver comprovante
                      <ExternalLink
                        className="ml-2 h-4 w-4"
                        aria-hidden="true"
                      />
                    </a>
                  </Button>
                )
                : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={paymentReceiptLoading}
                    onClick={() => void refreshPaymentReceipt()}
                    className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                  >
                    {paymentReceiptLoading
                      ? (
                        <VimobLoader
                          size="xs"
                          className="mr-2"
                          label="Preparando comprovante..."
                        />
                      )
                      : (
                        <RefreshCw
                          className="mr-2 h-4 w-4"
                          aria-hidden="true"
                        />
                      )}
                    {paymentReceiptLoading
                      ? "Preparando comprovante"
                      : "Consultar comprovante"}
                  </Button>
                )}
              <Button
                asChild
                className="h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary"
              >
                <a href={DEFAULT_AUTHENTICATED_ROUTE}>Acessar plataforma</a>
              </Button>
              {recurrenceState === "failed"
                ? (
                  <Button
                    asChild
                    variant="outline"
                    className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                  >
                    <a href="/settings?tab=subscription&billing=methods">
                      Atualizar cartão para renovação
                    </a>
                  </Button>
                )
                : null}
              {recurrenceState === "processing" && directPollingExpired
                ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRetryDirectStatus}
                    className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Consultar recorrência novamente
                  </Button>
                )
                : null}
            </CardContent>
          </Card>
        </div>
      </CheckoutPageShell>
    );
  }

  if (awaitingCardConfirmation) {
    const cardNeedsAction = Boolean(
      cardFailureMessage ||
        directPollingExpired ||
        recoveryState === "assisted",
    );
    const cardCanBeCancelled = Boolean(
      recoveryState === "retry" ||
        (cardFailureMessage && recoveryState !== "assisted") ||
        (directPollingExpired && !recoveryPaymentId && !recoverySubscriptionId),
    );
    return (
      <CheckoutPageShell>
        <div className="flex min-h-[55vh] items-center justify-center">
          <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="space-y-4 p-6 text-center sm:p-8">
              {!cardNeedsAction
                ? <VimobLoader size="lg" label="Confirmando pagamento..." />
                : (
                  <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-[6px] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <CreditCard className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
              <h2 className="text-[18px] font-normal">
                {cardFailureMessage
                  ? "Cartão não autorizado"
                  : cardNeedsAction
                  ? "Confirmação pendente"
                  : recoveryState === "settled"
                  ? "Ativando sua assinatura"
                  : "Confirmando pagamento"}
              </h2>
              <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                {cardFailureMessage ||
                  recoveryMessage ||
                  "Seu cartão foi cadastrado com segurança e ficou vinculado à assinatura. Estamos aguardando a confirmação da primeira cobrança."}
              </p>
              <Button
                variant="outline"
                onClick={handleRetryDirectStatus}
                className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Consultar novamente
              </Button>
              {cardCanBeCancelled
                ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={cancellingDirectPayment}
                    onClick={() => void handleUseAnotherPaymentMethod()}
                    className="h-10 w-full rounded-[6px] text-[12px] font-light"
                  >
                    {cancellingDirectPayment
                      ? (
                        <VimobLoader
                          size="xs"
                          className="mr-2"
                          label="Cancelando tentativa..."
                        />
                      )
                      : null}
                    Cancelar e tentar outro cartão
                  </Button>
                )
                : null}
            </CardContent>
          </Card>
        </div>
      </CheckoutPageShell>
    );
  }

  if (!info.plan) {
    return (
      <CheckoutPageShell>
        <div className="flex min-h-[55vh] items-center justify-center">
          <Card className="w-full max-w-md rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="space-y-2 p-6 text-center sm:p-8">
              <h2 className="text-[18px] font-normal">Plano indisponível</h2>
              <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                Este checkout não possui um plano válido. Solicite um novo link
                para continuar.
              </p>
            </CardContent>
          </Card>
        </div>
      </CheckoutPageShell>
    );
  }

  const plan = info.plan;
  const billingPeriods = normalizeBillingPeriods(plan.billing_periods);
  const scopedQuote = info.checkout_access?.scope === "payment"
    ? info.active_checkout || null
    : null;
  const activeQuote = activeCheckout?.plan_id === plan.id
    ? activeCheckout
    : scopedQuote?.plan_id === plan.id
    ? scopedQuote
    : null;
  const catalogMonthlyPrice = Number.isFinite(plan.price)
    ? Math.max(0, plan.price)
    : 0;
  const monthlyPrice = activeQuote && activeQuote.billing_period_months > 0
    ? activeQuote.amount / activeQuote.billing_period_months
    : catalogMonthlyPrice;
  const total = activeQuote
    ? activeQuote.amount
    : monthlyPrice * (selectedPeriodMonths ?? 0);
  const activePaymentMethod: PaymentMethod = boletoResult
    ? "BOLETO"
    : pixResult
    ? "PIX"
    : processingMethod || submittedMethod || tab;
  const activePaymentMethodLabel = activePaymentMethod === "PIX"
    ? "Pix"
    : activePaymentMethod === "BOLETO"
    ? "Boleto bancário"
    : "Cartão de crédito";
  const selectedPeriodLabel = selectedPeriodMonths
    ? formatPeriodLabel(selectedPeriodMonths)
    : "Não selecionado";
  const checkoutMethod = processingMethod || tab;
  const boletoDueDate = boletoResult
    ? formatBoletoDueDate(boletoResult.due_date)
    : null;
  const boletoPaymentCode = boletoResult?.identification_field ||
    boletoResult?.bar_code || "";
  const boletoPaymentCodeLabel = boletoResult?.identification_field
    ? "Linha digitável"
    : "Código de barras";
  const boletoPaymentCodeCopiedMessage = boletoResult?.identification_field
    ? "Linha digitável copiada!"
    : "Código de barras copiado!";
  const boletoDocumentUrl = boletoResult?.bank_slip_url ||
    boletoResult?.invoice_url || "";
  const boletoArtifactsReady = Boolean(boletoDocumentUrl || boletoPaymentCode);
  const usesStoredBillingProfile = Boolean(
    info?.checkout_access?.scope === "payment" &&
      info.checkout_access.use_stored_billing_profile &&
      info.billing_profile_summary?.complete,
  );
  const billingDetailsValid = usesStoredBillingProfile ||
    checkoutBillingDetailsSchema.safeParse({
      name: holderName,
      email: holderEmail,
      cpf_cnpj: holderCpf,
      phone: holderPhone,
      country: "BR",
      postal_code: holderPostalCode,
      address: holderAddress,
      address_number: holderAddressNumber,
      address_complement: holderAddressComplement,
      neighborhood: holderNeighborhood,
      city: holderCity,
      state: holderState,
    }).success;
  const cardDetailsReady = Boolean(
    cardHolderName.trim().length >= 2 &&
      [11, 14].includes(cardHolderDocument.replace(/\D/g, "").length) &&
      cardNumber.replace(/\D/g, "").length >= 13 &&
      cardExpiryMonth.length === 2 &&
      cardExpiryYear.length === 4 &&
      cardCcv.length >= 3,
  );
  const paymentProviderProcessing = Boolean(
    info?.checkout_access?.scope === "payment" &&
      ["AWAITING_RISK_ANALYSIS", "AUTHORIZED", "PROCESSING"].includes(
        (info.checkout_access.payment_status || "").toUpperCase(),
      ),
  );
  const paymentRecoveryInProgress = Boolean(processingMethod || activeCheckout);
  const isPaymentFormReady = paymentRecoveryInProgress ||
    Boolean(
      (selectedPeriodMonths || managingPaymentMethod) &&
        billingDetailsConfirmed &&
        billingDetailsValid &&
        !paymentProviderProcessing &&
        !changingPlanId &&
        (tab !== "CREDIT_CARD" || cardDetailsReady),
    );
  const canChangePlan = !managingPaymentMethod &&
    info?.checkout_access?.can_change_plan !== false &&
    !(
      submitting ||
      processingMethod ||
      pixResult ||
      boletoResult ||
      activeCheckout ||
      awaitingCardConfirmation ||
      paid ||
      changingPlanId
    );
  const canEditCheckoutSelection = canChangePlan;

  return (
    <CheckoutPageShell>
      {!managingPaymentMethod && token
        ? <SignupCheckoutRecoveryBanner checkoutToken={token} />
        : null}
      <div className="mb-5">
        <h1 className="text-[14px] font-normal leading-[1.25] text-[var(--app-text-primary)]">
          {managingPaymentMethod
            ? "Atualize seu cartão recorrente"
            : "Finalize sua assinatura"}
        </h1>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-5">
        <div className="min-w-0 space-y-4">
          <form
            id="checkout-billing-form"
            className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              handleBillingDetailsContinue();
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground">
                  1
                </span>
                <div>
                  <h2 className="app-section-title">Dados de faturamento</h2>
                </div>
              </div>
              {billingDetailsConfirmed &&
                  !usesStoredBillingProfile &&
                  !pixResult &&
                  !boletoResult &&
                  !processingMethod
                ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setBillingDetailsConfirmed(false)}
                    className="h-8 shrink-0 rounded-[6px] px-2.5 text-[11px] font-light text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-soft)] hover:text-primary"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Editar
                  </Button>
                )
                : null}
            </div>

            <BillingDetailsFields
              name={holderName}
              email={holderEmail}
              document={holderCpf}
              phone={holderPhone}
              postalCode={holderPostalCode}
              address={holderAddress}
              addressNumber={holderAddressNumber}
              addressComplement={holderAddressComplement}
              neighborhood={holderNeighborhood}
              city={holderCity}
              state={holderState}
              disabled={usesStoredBillingProfile ||
                billingDetailsConfirmed ||
                submitting ||
                Boolean(processingMethod) ||
                Boolean(pixResult || boletoResult)}
              onNameChange={setHolderName}
              onEmailChange={setHolderEmail}
              onDocumentChange={setHolderCpf}
              onPhoneChange={setHolderPhone}
              onPostalCodeChange={setHolderPostalCode}
              onAddressChange={setHolderAddress}
              onAddressNumberChange={setHolderAddressNumber}
              onAddressComplementChange={setHolderAddressComplement}
              onNeighborhoodChange={setHolderNeighborhood}
              onCityChange={setHolderCity}
              onStateChange={setHolderState}
            />

            {billingDetailsConfirmed
              ? (
                <div className="mt-4 flex items-center gap-2 rounded-[6px] bg-emerald-500/10 px-3 py-2.5 text-[11px] font-light text-emerald-700 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {usesStoredBillingProfile
                    ? "Dados protegidos e conferidos. As informações sensíveis permanecem mascaradas."
                    : "Dados conferidos. Escolha o período para continuar."}
                </div>
              )
              : (
                <Button
                  type="submit"
                  className="mt-5 h-10 rounded-[6px] bg-primary/50 px-5 text-[12px] font-light hover:bg-primary focus-visible:bg-primary"
                >
                  Continuar para o período
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              )}
          </form>

          {!managingPaymentMethod
            ? (
              <section
                ref={periodSectionRef}
                className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground">
                    2
                  </span>
                  <div>
                    <h2 className="app-section-title">Escolha o período</h2>
                  </div>
                </div>

                {billingPeriods.length > 0
                  ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      {billingPeriods.map((period) => {
                        const selected = selectedPeriodMonths === period;

                        return (
                          <button
                            key={period}
                            type="button"
                            aria-pressed={selected}
                            disabled={!canEditCheckoutSelection}
                            onClick={() => setSelectedPeriodMonths(period)}
                            className={`group rounded-[6px] border-0 p-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-[var(--app-surface-soft)] hover:bg-primary hover:text-primary-foreground"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-light">
                                {formatPeriodLabel(period)}
                              </span>
                              <span
                                className={`flex h-4 w-4 items-center justify-center rounded-[4px] ${
                                  selected
                                    ? "bg-primary-foreground/20 text-primary-foreground"
                                    : "bg-[var(--app-surface-solid)] text-transparent group-hover:bg-primary-foreground/20"
                                }`}
                              >
                                {selected
                                  ? (
                                    <Check
                                      className="h-3 w-3"
                                      aria-hidden="true"
                                    />
                                  )
                                  : null}
                              </span>
                            </span>
                            <span
                              className={`mt-1.5 block text-[11px] font-light ${
                                selected
                                  ? "text-primary-foreground/80"
                                  : "text-[var(--app-text-tertiary)] group-hover:text-primary-foreground/75"
                              }`}
                            >
                              {formatCurrency(monthlyPrice * period)} no período
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )
                  : (
                    <div className="mt-4 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300">
                      Os períodos deste plano ainda não foram configurados.
                      Atualize o catálogo antes de cobrar.
                    </div>
                  )}
              </section>
            )
            : null}
        </div>

        <div className="min-w-0 space-y-4">
          <aside className="min-w-0">
            <section className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5">
              <h2 className="app-section-title">
                {managingPaymentMethod
                  ? "Assinatura atual"
                  : "Resumo do pedido"}
              </h2>

              <div className="mt-4 divide-y divide-[var(--app-border)] text-[12px] font-light">
                <DropdownMenu
                  open={planSelectorOpen}
                  onOpenChange={(open) =>
                    setPlanSelectorOpen(canChangePlan ? open : false)}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={!canChangePlan}
                      aria-label={"Editar plano. Atual: " + plan.name}
                      className="group flex w-full items-center justify-between gap-4 px-2 py-3 text-left outline-none transition-colors hover:bg-[var(--app-surface-soft)] focus-visible:ring-1 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="text-[var(--app-text-tertiary)]">
                        Plano
                      </span>
                      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-[var(--app-text-secondary)] transition-colors group-hover:text-primary">
                        <span className="truncate">{plan.name}</span>
                        {changingPlanId
                          ? (
                            <RefreshCw
                              className="h-3 w-3 shrink-0 animate-spin"
                              aria-hidden="true"
                            />
                          )
                          : (
                            <Pencil
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={6}
                    className="w-[min(300px,calc(100vw-32px))] rounded-[8px] p-2"
                  >
                    <DropdownMenuLabel className="px-2 pb-2 pt-1 text-[11px] font-light text-[var(--app-text-tertiary)]">
                      Escolha o plano
                    </DropdownMenuLabel>
                    {plansLoading
                      ? (
                        <div className="flex items-center px-2 py-3 text-[11px] font-light text-[var(--app-text-tertiary)]">
                          <RefreshCw
                            className="mr-2 h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                          Carregando planos...
                        </div>
                      )
                      : availablePlans.length > 0
                      ? (
                        <DropdownMenuRadioGroup
                          value={plan.id}
                          className="space-y-1"
                          onValueChange={(value) => {
                            const nextPlan = availablePlans.find(
                              (availablePlan) => availablePlan.id === value,
                            );
                            if (!nextPlan || nextPlan.id === plan.id) return;
                            setPlanSelectorOpen(false);
                            void handlePlanChange(nextPlan);
                          }}
                        >
                          {availablePlans.map((availablePlan) => (
                            <DropdownMenuRadioItem
                              key={availablePlan.id ||
                                availablePlan.slug ||
                                availablePlan.name}
                              value={availablePlan.id || ""}
                              disabled={Boolean(changingPlanId)}
                              className="rounded-[6px] py-2 pl-7 pr-2 text-[12px] font-light"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {availablePlan.name}
                              </span>
                              <span className="ml-3 shrink-0 text-[11px] text-[var(--app-text-tertiary)]">
                                {formatCurrency(
                                  Number(availablePlan.price),
                                )}/mês
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      )
                      : (
                        <p className="px-2 py-3 text-[11px] font-light leading-[16px] text-[var(--app-text-tertiary)]">
                          Não foi possível listar os planos agora.
                        </p>
                      )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {!managingPaymentMethod
                  ? (
                    <div className="flex w-full items-center justify-between gap-4 px-2 py-3">
                      <span className="text-[var(--app-text-tertiary)]">
                        Período
                      </span>
                      <span className="text-right text-[var(--app-text-secondary)]">
                        {selectedPeriodLabel}
                      </span>
                    </div>
                  )
                  : null}

                <div className="flex w-full items-center justify-between gap-4 px-2 py-3">
                  <span className="text-[var(--app-text-tertiary)]">
                    Pagamento
                  </span>
                  <span className="text-right text-[var(--app-text-secondary)]">
                    {managingPaymentMethod
                      ? "Cartão recorrente"
                      : activePaymentMethodLabel}
                  </span>
                </div>
              </div>

              {!managingPaymentMethod
                ? (
                  <div className="mt-2 border-t border-[var(--app-border)] pt-4">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
                          Total
                        </p>
                        {selectedPeriodMonths
                          ? (
                            <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                              Referente a {formatPeriod(selectedPeriodMonths)}
                            </p>
                          )
                          : null}
                      </div>
                      <p className="text-[20px] font-normal tracking-tight text-primary/70">
                        {formatCurrency(total)}
                      </p>
                    </div>
                    <p className="mt-2 text-right text-[11px] font-light text-[var(--app-text-tertiary)]">
                      {formatCurrency(monthlyPrice)}/mês
                    </p>
                  </div>
                )
                : (
                  <p className="mt-3 border-t border-[var(--app-border)] px-2 pt-4 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
                    O novo cartão será usado nas próximas cobranças automáticas.
                  </p>
                )}
            </section>
          </aside>
          <form
            ref={paymentFormRef}
            id="checkout-payment-form"
            className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (isPaymentFormReady) void handleSubmit(checkoutMethod);
            }}
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-[12px] font-light ${
                  billingDetailsConfirmed
                    ? "bg-primary/50 text-primary-foreground"
                    : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]"
                }`}
              >
                {managingPaymentMethod ? 2 : 3}
              </span>
              <h2 className="app-section-title">
                {managingPaymentMethod
                  ? "Cartão recorrente"
                  : "Informação de pagamento"}
              </h2>
            </div>

            {!billingDetailsConfirmed
              ? (
                <div className="mt-5 flex items-center gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)]">
                    <LockKeyhole
                      className="h-3.5 w-3.5"
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                  </span>
                  Confira os dados de faturamento para liberar as formas de
                  pagamento.
                </div>
              )
              : paymentProviderProcessing
              ? (
                <div className="mt-5 flex items-start gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-4 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  <VimobLoader size="xs" label="Processando pagamento..." />
                  <span>
                    O pagamento já foi enviado e está em análise. As formas de
                    pagamento ficam bloqueadas até a confirmação.
                  </span>
                </div>
              )
              : pixResult
              ? (
                <div className="mt-5 space-y-4 text-center" aria-live="polite">
                  <div>
                    <h3 className="text-[14px] font-light">
                      {pixResult.qr_code || pixResult.qr_payload
                        ? "Pague com Pix"
                        : "Preparando seu Pix"}
                    </h3>
                    <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                      {pixResult.qr_code || pixResult.qr_payload
                        ? "Escaneie o QR Code ou use o código copia e cola. A confirmação é automática."
                        : recoveryMessage ||
                          "A cobrança já foi criada e o código está sendo recuperado."}
                    </p>
                  </div>
                  {pixResult.qr_code
                    ? (
                      <NextImage
                        src={`data:image/png;base64,${pixResult.qr_code}`}
                        alt="QR Code Pix"
                        width={256}
                        height={256}
                        className="mx-auto aspect-square h-auto w-full max-w-56 rounded-[8px] bg-[var(--app-surface-solid)] p-2"
                        unoptimized
                      />
                    )
                    : !pixResult.qr_payload
                    ? (
                      <div className="mx-auto flex h-48 w-full max-w-56 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)]">
                        {!directPollingExpired
                          ? (
                            <VimobLoader
                              size="sm"
                              label="Preparando código Pix..."
                            />
                          )
                          : (
                            <QrCode
                              className="h-6 w-6 text-[var(--app-text-tertiary)]"
                              aria-hidden="true"
                            />
                          )}
                      </div>
                    )
                    : null}
                  {pixResult.qr_payload
                    ? (
                      <div className="mx-auto flex max-w-xl items-center gap-2">
                        <Input
                          value={pixResult.qr_payload}
                          readOnly
                          aria-label="Código Pix copia e cola"
                          className="h-10 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-10 w-10 shrink-0 rounded-[6px] border-0 bg-primary/50 text-primary-foreground shadow-none hover:bg-primary"
                          aria-label="Copiar código Pix"
                          onClick={() => {
                            void copyPaymentCode(
                              pixResult.qr_payload || "",
                              "Código Pix copiado!",
                            );
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                    : null}
                  <div className="flex items-center justify-center gap-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
                    {!directPollingExpired
                      ? (
                        <VimobLoader
                          size="xs"
                          label="Aguardando pagamento..."
                        />
                      )
                      : null}
                    {directPollingExpired
                      ? recoveryMessage || "A confirmação ainda está pendente."
                      : recoveryState === "settled"
                      ? "Pagamento recebido. Ativando assinatura..."
                      : pixResult.qr_code || pixResult.qr_payload
                      ? "Aguardando pagamento..."
                      : "Recuperando código Pix..."}
                  </div>
                  <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                    {directPollingExpired
                      ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleRetryDirectStatus}
                          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Atualizar status
                        </Button>
                      )
                      : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-[6px] text-[11px] font-light"
                      disabled={cancellingDirectPayment}
                      onClick={() => void handleUseAnotherPaymentMethod()}
                    >
                      {cancellingDirectPayment
                        ? (
                          <VimobLoader
                            size="xs"
                            className="mr-2"
                            label="Cancelando cobrança..."
                          />
                        )
                        : null}
                      Usar outra forma
                    </Button>
                  </div>
                </div>
              )
              : boletoResult
              ? (
                <div className="mt-5 space-y-4" aria-live="polite">
                  <div className="flex items-start gap-3 rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                      <ReceiptText className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-light">
                        {boletoArtifactsReady
                          ? "Boleto gerado"
                          : "Preparando seu boleto"}
                      </h3>
                      <p className="mt-1 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                        {boletoArtifactsReady
                          ? (
                            <>
                              {boletoDueDate
                                ? `Vencimento em ${boletoDueDate}. `
                                : "Consulte o vencimento na fatura. "}
                              O plano será ativado automaticamente após a
                              compensação.
                            </>
                          )
                          : (
                            recoveryMessage ||
                            "A cobrança já foi criada e os dados bancários estão sendo recuperados."
                          )}
                      </p>
                    </div>
                  </div>

                  {boletoPaymentCode
                    ? (
                      <div>
                        <Label
                          htmlFor="boleto-identification-field"
                          className="text-[12px] font-light text-[var(--app-text-secondary)]"
                        >
                          {boletoPaymentCodeLabel}
                        </Label>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            id="boleto-identification-field"
                            value={boletoPaymentCode}
                            readOnly
                            className="h-10 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-10 w-10 shrink-0 rounded-[6px] border-0 bg-primary/50 text-primary-foreground shadow-none hover:bg-primary"
                            aria-label={`Copiar ${boletoPaymentCodeLabel.toLowerCase()}`}
                            onClick={() => {
                              void copyPaymentCode(
                                boletoPaymentCode,
                                boletoPaymentCodeCopiedMessage,
                              );
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )
                    : null}

                  <div className="flex items-center gap-2 text-[11px] font-light text-[var(--app-text-tertiary)]">
                    {!directPollingExpired
                      ? (
                        <VimobLoader
                          size="xs"
                          label={boletoArtifactsReady
                            ? "Aguardando compensação do boleto..."
                            : "Preparando boleto..."}
                        />
                      )
                      : null}
                    {directPollingExpired
                      ? recoveryMessage || "A confirmação ainda está pendente."
                      : recoveryState === "settled"
                      ? "Pagamento recebido. Ativando assinatura..."
                      : boletoArtifactsReady
                      ? "Aguardando compensação bancária"
                      : "Recuperando dados do boleto..."}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {boletoDocumentUrl
                      ? (
                        <Button
                          variant="outline"
                          asChild
                          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                        >
                          <a
                            href={boletoDocumentUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Abrir boleto
                            <ExternalLink className="ml-2 h-4 w-4" />
                          </a>
                        </Button>
                      )
                      : null}
                    {directPollingExpired
                      ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleRetryDirectStatus}
                          className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] font-light shadow-none hover:bg-primary hover:text-primary-foreground"
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Atualizar status
                        </Button>
                      )
                      : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 rounded-[6px] text-[11px] font-light"
                      disabled={cancellingDirectPayment}
                      onClick={() => void handleUseAnotherPaymentMethod()}
                    >
                      {cancellingDirectPayment
                        ? (
                          <VimobLoader
                            size="xs"
                            className="mr-2"
                            label="Cancelando cobrança..."
                          />
                        )
                        : null}
                      Usar outra forma
                    </Button>
                  </div>
                </div>
              )
              : (
                <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as PaymentMethod)}
                  className="mt-5"
                >
                  {bankSlipRegistrationCancelled
                    ? (
                      <div
                        className="mb-4 flex items-start gap-2 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300"
                        role="status"
                      >
                        <ReceiptText
                          className="mt-0.5 h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          O boleto anterior expirou ou teve o registro bancário
                          cancelado. Gere um novo boleto ou escolha Pix ou
                          cartão; o documento antigo não está mais disponível.
                        </span>
                      </div>
                    )
                    : null}
                  {directCardUpdateJobId &&
                      directCardUpdateMode === "saved_only"
                    ? (
                      <div
                        className="mb-4 space-y-3 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300"
                        role="status"
                        aria-live="polite"
                      >
                        <div className="flex items-start gap-2">
                          {!directPollingExpired
                            ? (
                              <VimobLoader
                                size="xs"
                                label="Confirmando atualização do cartão..."
                              />
                            )
                            : (
                              <RefreshCw
                                className="mt-0.5 h-4 w-4 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          <span>
                            {recoveryMessage ||
                              (directPollingExpired
                                ? "A atualização continua em conciliação. Consulte novamente em instantes."
                                : "A atualização do cartão está sendo confirmada com segurança.")}
                          </span>
                        </div>
                        {directPollingExpired && recoveryState !== "assisted"
                          ? (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={handleRetryDirectStatus}
                              className="h-8 px-2.5 text-[11px] font-light text-current hover:bg-amber-500/10"
                            >
                              <RefreshCw
                                className="mr-2 h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              Consultar novamente
                            </Button>
                          )
                          : null}
                      </div>
                    )
                    : processingMethod
                    ? (
                      <div className="mb-4 space-y-3 rounded-[6px] bg-amber-500/10 p-3 text-[12px] font-light leading-[18px] text-amber-700 dark:text-amber-300">
                        <div className="flex items-start gap-2">
                          {!directPollingExpired
                            ? (
                              <VimobLoader
                                size="xs"
                                label="Localizando cobrança..."
                              />
                            )
                            : (
                              <RefreshCw
                                className="mt-0.5 h-4 w-4 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          <span>
                            {recoveryMessage ||
                              (directPollingExpired
                                ? "A cobrança ainda não pôde ser localizada. Consulte novamente ou cancele a tentativa."
                                : "A cobrança está sendo localizada automaticamente sem gerar duplicidade.")}
                          </span>
                        </div>
                        {directPollingExpired
                          ? (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={cancellingDirectPayment}
                              onClick={() =>
                                void handleUseAnotherPaymentMethod()}
                              className="h-8 px-2.5 text-[11px] font-light text-current hover:bg-amber-500/10"
                            >
                              {cancellingDirectPayment
                                ? (
                                  <VimobLoader
                                    size="xs"
                                    className="mr-2"
                                    label="Cancelando tentativa..."
                                  />
                                )
                                : null}
                              Cancelar tentativa
                            </Button>
                          )
                          : null}
                      </div>
                    )
                    : null}
                  <TabsList
                    className={`grid h-10 w-full ${
                      managingPaymentMethod ? "grid-cols-1" : "grid-cols-3"
                    } rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-tertiary)]`}
                  >
                    {!managingPaymentMethod
                      ? (
                        <>
                          <TabsTrigger
                            value="PIX"
                            disabled={submitting || Boolean(processingMethod) ||
                              Boolean(directCardUpdateJobId)}
                            className="mx-0 min-w-0 rounded-[6px] px-2 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-primary/70 data-[state=active]:shadow-none sm:text-[12px]"
                          >
                            <QrCode className="mr-1 h-3.5 w-3.5 sm:mr-1.5" />
                            Pix
                          </TabsTrigger>
                          <TabsTrigger
                            value="BOLETO"
                            disabled={submitting || Boolean(processingMethod) ||
                              Boolean(directCardUpdateJobId)}
                            className="mx-0 min-w-0 rounded-[6px] px-2 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-primary/70 data-[state=active]:shadow-none sm:text-[12px]"
                          >
                            <ReceiptText className="mr-1 h-3.5 w-3.5 sm:mr-1.5" />
                            Boleto
                          </TabsTrigger>
                        </>
                      )
                      : null}
                    <TabsTrigger
                      value="CREDIT_CARD"
                      disabled={submitting || Boolean(processingMethod) ||
                        Boolean(directCardUpdateJobId)}
                      className="mx-0 min-w-0 rounded-[6px] px-2 text-[11px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-primary/70 data-[state=active]:shadow-none sm:text-[12px]"
                    >
                      <CreditCard className="mr-1 h-3.5 w-3.5 sm:mr-1.5" />
                      Cartão
                    </TabsTrigger>
                  </TabsList>

                  {tab === "CREDIT_CARD"
                    ? (
                      <CardPaymentFields
                        holderName={cardHolderName}
                        holderDocument={cardHolderDocument}
                        number={cardNumber}
                        expiryMonth={cardExpiryMonth}
                        expiryYear={cardExpiryYear}
                        ccv={cardCcv}
                        disabled={submitting || Boolean(processingMethod) ||
                          Boolean(directCardUpdateJobId)}
                        onHolderNameChange={setCardHolderName}
                        onHolderDocumentChange={setCardHolderDocument}
                        onNumberChange={setCardNumber}
                        onExpiryMonthChange={setCardExpiryMonth}
                        onExpiryYearChange={setCardExpiryYear}
                        onCcvChange={setCardCcv}
                      />
                    )
                    : null}
                </Tabs>
              )}
            <div className="mt-5 flex items-start gap-2 border-t border-[var(--app-border)] pt-4 text-[11px] font-light leading-[17px] text-[var(--app-text-tertiary)]">
              <ShieldCheck
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              Seus dados são protegidos e processados em ambiente seguro.
            </div>

            {pixResult || boletoResult
              ? (
                <div className="mt-5 flex items-center gap-2 rounded-[6px] bg-amber-500/10 p-3 text-[11px] font-light text-amber-800 dark:text-amber-300">
                  {!directPollingExpired
                    ? (
                      <VimobLoader
                        size="xs"
                        label={pixResult
                          ? "Aguardando pagamento Pix..."
                          : "Aguardando compensação do boleto..."}
                      />
                    )
                    : (
                      <ReceiptText
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  {directPollingExpired
                    ? "Confirmação ainda pendente"
                    : pixResult
                    ? "Aguardando pagamento Pix"
                    : "Aguardando compensação do boleto"}
                </div>
              )
              : (
                <Button
                  type="submit"
                  className="mt-5 h-10 w-full rounded-[6px] bg-primary/50 text-[12px] font-light hover:bg-primary focus-visible:bg-primary"
                  disabled={submitting ||
                    Boolean(directCardUpdateJobId) ||
                    !isPaymentFormReady ||
                    (!managingPaymentMethod &&
                      billingPeriods.length === 0 &&
                      !paymentRecoveryInProgress)}
                >
                  {submitting
                    ? (
                      <VimobLoader
                        size="sm"
                        className="mr-2"
                        label={checkoutMethod === "PIX"
                          ? "Gerando QR Code Pix..."
                          : checkoutMethod === "BOLETO"
                          ? "Gerando boleto..."
                          : managingPaymentMethod
                          ? "Salvando cartão..."
                          : "Cadastrando cartão..."}
                      />
                    )
                    : processingMethod
                    ? <RefreshCw className="mr-2 h-4 w-4" />
                    : checkoutMethod === "PIX"
                    ? <QrCode className="mr-2 h-4 w-4" />
                    : checkoutMethod === "BOLETO"
                    ? <ReceiptText className="mr-2 h-4 w-4" />
                    : <CreditCard className="mr-2 h-4 w-4" />}
                  {processingMethod
                    ? "Localizar cobrança"
                    : checkoutMethod === "PIX"
                    ? "Gerar QR Code Pix"
                    : checkoutMethod === "BOLETO"
                    ? "Gerar boleto"
                    : managingPaymentMethod
                    ? "Salvar cartão recorrente"
                    : "Cadastrar cartão"}
                  {!submitting && !processingMethod
                    ? <ArrowRight className="ml-2 h-4 w-4" />
                    : null}
                </Button>
              )}
          </form>
        </div>
      </div>
    </CheckoutPageShell>
  );
}
