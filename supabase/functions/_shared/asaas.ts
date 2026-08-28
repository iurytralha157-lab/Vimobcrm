import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  asaasCheckoutPaymentIntegrity,
  billingCheckoutIntentRpcArgs,
  type AsaasCheckoutPaymentIntegrity,
  type BillingIntentMethod,
  type BillingPeriodMonths,
  checkoutPlanSelect,
  hostedCheckoutRecoveryPath,
  providerRecoveryPath,
} from "./asaas-billing-intent.ts";
import {
  assertAsaasCustomerNotificationsDisabled,
  suppressExistingAsaasCustomerNotifications,
} from "./asaas-customer.ts";
import { asaasPaidPaymentPollingRpcCall } from "./asaas-webhook.ts";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "./supabase-secret-keys.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

export type CheckoutOrganization = {
  id: string;
  name: string;
  logo_url: string | null;
  subscription_status: string | null;
  subscription_value: number | null;
  plan_id: string | null;
  pending_plan_id: string | null;
  email: string | null;
  whatsapp: string | null;
  cnpj: string | null;
  billing_legal_name: string | null;
  billing_tax_id: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_postal_code: string | null;
  billing_address: string | null;
  billing_address_number: string | null;
  billing_address_complement: string | null;
  billing_neighborhood: string | null;
  billing_city: string | null;
  billing_state: string | null;
  created_by: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
};

export type CheckoutBillingProfile = {
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

export type CheckoutPlan = {
  id: string;
  name: string;
  price: number;
  billing_cycle: string | null;
  description: string | null;
  billing_periods: BillingPeriodMonths[];
  display_features: string[];
  max_users: number | null;
  max_leads: number | null;
  max_whatsapp_sessions: number | null;
};

export type CheckoutRecord = {
  organization: CheckoutOrganization;
  plan: CheckoutPlan | null;
  billingProfile: CheckoutBillingProfile | null;
  access: CheckoutAccess;
};

export type PaymentSnapshotSource =
  | "intent"
  | "subscription"
  | "legacy_catalog";

export type OrganizationCheckoutAccess = {
  scope: "organization";
  checkoutToken: string | null;
  canPersistBillingProfile: boolean;
  authorizedUserId: string | null;
};

export type PaymentCheckoutAccess = {
  scope: "payment";
  checkoutToken: string;
  canPersistBillingProfile: false;
  authorizedUserId: null;
  paymentId: string;
  providerPaymentId: string;
  providerCustomerId: string;
  providerSubscriptionId: string | null;
  billingIntentId: string | null;
  paymentSnapshotSource: PaymentSnapshotSource;
  billingType: BillingIntentMethod;
  paymentStatus: string | null;
  paymentAmount: number;
  paymentDueDate: string;
  paymentDate: string | null;
  paymentInvoiceUrl: string | null;
  paymentUpdatedAt: string | null;
  planId: string;
  billingPeriodMonths: BillingPeriodMonths;
  cardRecurrenceStatus: string | null;
  bankSlipRegistrationCancelled: boolean;
  bankSlipRegistrationCancelledAt: string | null;
  bankSlipRegistrationCancelledDueDate: string | null;
};

export type CheckoutAccess =
  | OrganizationCheckoutAccess
  | PaymentCheckoutAccess;

export type AuthorizedCheckoutRecord = CheckoutRecord;

export type AsaasPayment = {
  id: string;
  customer?: string;
  subscription?: string;
  billingType?: string;
  status?: string;
  value?: number;
  netValue?: number;
  dueDate?: string;
  paymentDate?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  externalReference?: string;
  deleted?: boolean;
};

export function safeAsaasPaymentSnapshot(payment: AsaasPayment) {
  return {
    id: payment.id,
    customer: payment.customer || null,
    subscription: payment.subscription || null,
    billingType: payment.billingType || null,
    status: payment.status || null,
    value: payment.value ?? null,
    netValue: payment.netValue ?? null,
    dueDate: payment.dueDate || null,
    paymentDate: payment.paymentDate || null,
    invoiceUrl: payment.invoiceUrl || null,
    bankSlipUrl: payment.bankSlipUrl || null,
    externalReference: payment.externalReference || null,
    deleted: payment.deleted === true,
  };
}

export type AsaasBoletoIdentification = {
  identificationField?: string;
  barCode?: string;
  nossoNumero?: string;
};

export type AsaasPixQrCode = {
  encodedImage?: string;
  payload?: string;
};

export type AsaasCustomer = {
  id: string;
  notificationDisabled?: boolean;
};

type AsaasCustomerList = {
  data?: AsaasCustomer[];
};

export type AsaasSubscription = {
  id: string;
  status?: string;
  billingType?: string;
  cycle?: string;
  nextDueDate?: string;
  value?: number;
  customer?: string;
  externalReference?: string;
  deleted?: boolean;
};

export type AsaasHostedCheckout = {
  id: string;
  link: string;
  status?: string;
  billingTypes?: string[];
  chargeTypes?: string[];
  minutesToExpire?: number;
  externalReference?: string;
};

export type BillingCheckoutIntent = {
  outcome:
    | "create"
    | "reuse"
    | "recover"
    | "in_progress"
    | "active_intent_conflict"
    | "already_active"
    | "plan_not_staged"
    | "organization_not_found"
    | "invalid_plan"
    | "quote_changed";
  intent_id?: string;
  external_reference?: string;
  plan_id?: string;
  plan_name?: string;
  amount?: number;
  billing_cycle?: "monthly" | "semiannual" | "yearly";
  billing_period_months?: BillingPeriodMonths;
  billing_method?: BillingIntentMethod;
  status?: string;
  provider_customer_id?: string | null;
  provider_checkout_id?: string | null;
  provider_payment_id?: string | null;
  provider_subscription_id?: string | null;
  provider_response?: Record<string, unknown>;
  last_error?: string | null;
};

export type BillingCheckoutState = {
  intent_id: string;
  organization_id: string;
  plan_id: string;
  billing_method: BillingIntentMethod;
  status: "creating" | "pending";
  billing_period_months: BillingPeriodMonths;
  amount: number;
  external_reference: string;
  provider_customer_id: string | null;
  provider_payment_id: string | null;
  provider_subscription_id: string | null;
  provider_checkout_id: string | null;
  provider_status: string | null;
  card_last4: string | null;
  has_error: boolean;
  payment: {
    id: string;
    status: string | null;
    billing_type: string | null;
    value: number | null;
    due_date: string | null;
    payment_date: string | null;
    invoice_url: string | null;
    updated_at: string | null;
  } | null;
  provider_request_started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicBillingCheckoutState = {
  intent_id: string;
  plan_id: string;
  billing_method: BillingIntentMethod;
  status: "creating" | "pending";
  billing_period_months: BillingPeriodMonths;
  amount: number;
  payment_id: string | null;
  subscription_id: string | null;
  checkout_id: string | null;
  provider_status: string | null;
  card_last4: string | null;
  created_at: string;
  updated_at: string;
};

export class AsaasRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AsaasRequestError";
    this.status = status;
  }
}

export function handleOptions(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return null;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = selectSupabaseAdminSecretKey(
    readSupabaseSecretKeyEnvironment(),
  );

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function onlyDigits(value: string | null | undefined) {
  return (value || "").replace(/\D/g, "");
}

export function isValidBrazilianTaxId(value: string | null | undefined) {
  const digits = onlyDigits(value);
  if (/^(\d)\1+$/.test(digits)) return false;

  if (digits.length === 11) {
    const digit = (length: number) => {
      const sum = digits
        .slice(0, length)
        .split("")
        .reduce(
          (total, current, index) =>
            total + Number(current) * (length + 1 - index),
          0,
        );
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return digit(9) === Number(digits[9]) &&
      digit(10) === Number(digits[10]);
  }

  if (digits.length === 14) {
    const calculateDigit = (base: string, weights: number[]) => {
      const sum = base.split("").reduce(
        (total, current, index) => total + Number(current) * weights[index],
        0,
      );
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };
    const first = calculateDigit(
      digits.slice(0, 12),
      [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    );
    const second = calculateDigit(
      `${digits.slice(0, 12)}${first}`,
      [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    );
    return first === Number(digits[12]) && second === Number(digits[13]);
  }

  return false;
}

export function normalizeAsaasPhone(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (digits.startsWith("55") && digits.length > 11) {
    return digits.slice(2);
  }

  return digits;
}

export function isoDateFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || undefined;
  return request.headers.get("x-real-ip") || undefined;
}

export function checkoutCallbackUrls(input: {
  checkoutToken?: string | null;
}) {
  const configuredUrl = Deno.env.get("APP_PUBLIC_URL")?.trim();
  if (!configuredUrl) {
    throw new Error("APP_PUBLIC_URL is not configured.");
  }

  const baseUrl = new URL(configuredUrl);
  const isLocalhost = baseUrl.hostname === "localhost" ||
    baseUrl.hostname === "127.0.0.1";
  if (
    (baseUrl.protocol !== "https:" && !isLocalhost) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error("APP_PUBLIC_URL is invalid.");
  }

  const returnUrl = input.checkoutToken
    ? new URL(`/checkout/${encodeURIComponent(input.checkoutToken)}`, baseUrl)
    : new URL("/settings", baseUrl);

  if (!input.checkoutToken) {
    returnUrl.searchParams.set("tab", "subscription");
  }

  const withOutcome = (outcome: "success" | "cancelled" | "expired") => {
    const url = new URL(returnUrl);
    url.searchParams.set("checkout", outcome);
    return url.toString();
  };

  return {
    successUrl: withOutcome("success"),
    cancelUrl: withOutcome("cancelled"),
    expiredUrl: withOutcome("expired"),
  };
}

export async function asaasRequest<T>(path: string, init: RequestInit = {}) {
  const apiKey = Deno.env.get("ASAAS_API_KEY");
  const configuredBaseUrl = Deno.env.get("ASAAS_BASE_URL")?.trim();

  if (!apiKey || !configuredBaseUrl) {
    throw new Error("Asaas credentials and endpoint are not configured.");
  }

  const baseUrl = new URL(configuredBaseUrl);
  const allowedHost = baseUrl.hostname === "api.asaas.com" ||
    baseUrl.hostname === "api-sandbox.asaas.com";
  if (
    baseUrl.protocol !== "https:" || !allowedHost || baseUrl.pathname !== "/v3"
  ) {
    throw new Error("ASAAS_BASE_URL is invalid.");
  }
  if (
    baseUrl.hostname === "api.asaas.com" &&
    Deno.env.get("ASAAS_ALLOW_PRODUCTION_CHARGES") !== "true"
  ) {
    throw new Error(
      "Production Asaas charges are disabled in this environment.",
    );
  }

  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException("Asaas request timed out.", "TimeoutError"),
      ),
    75_000,
  );

  let response: Response;
  let text: string;
  try {
    response = await fetch(
      `${baseUrl.toString().replace(/\/$/, "")}${path}`,
      {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "VimobCRM/1.0 (Supabase Edge Functions)",
          access_token: apiKey,
          ...(init.headers || {}),
        },
      },
    );
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AsaasRequestError(
        "Asaas request timed out or was interrupted.",
        504,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.errors?.[0]?.description ||
      payload?.message ||
      `Asaas request failed with status ${response.status}`;

    throw new AsaasRequestError(message, response.status);
  }

  return payload as T;
}

export async function getCheckoutRecord(params: {
  token?: string | null;
  organizationId?: string | null;
  includeBillingProfile?: boolean;
  authorizedUserId?: string | null;
}) {
  const supabase = getSupabaseAdmin();

  const checkoutToken = params.token?.trim().toLowerCase() || "";
  let organizationId = params.organizationId?.trim() || null;
  let access: CheckoutAccess = {
    scope: "organization",
    checkoutToken: null,
    canPersistBillingProfile: Boolean(params.organizationId),
    authorizedUserId: params.authorizedUserId?.trim() || null,
  };

  if (checkoutToken) {
    const { data: paymentCapability, error: paymentCapabilityError } =
      await supabase.rpc("resolve_billing_payment_checkout_capability", {
        p_checkout_token: checkoutToken,
      });
    if (paymentCapabilityError) throw paymentCapabilityError;

    const resolved = paymentCapability as {
      outcome?: string;
      organization_id?: string;
      payment_id?: string;
      billing_intent_id?: string | null;
      plan_id?: string;
      billing_period_months?: number;
      amount?: number | string;
      snapshot_source?: string;
      card_recurrence_status?: string | null;
      bank_slip_registration_cancelled?: boolean;
      bank_slip_registration_cancelled_at?: string | null;
      bank_slip_registration_cancelled_due_date?: string | null;
    } | null;

    if (resolved?.outcome === "resolved") {
      const paymentSnapshotSource = resolved.snapshot_source || "";
      const billingPeriodMonths = Number(resolved.billing_period_months);
      const amount = Number(resolved.amount);
      if (
        !resolved.organization_id || !resolved.payment_id ||
        !resolved.plan_id ||
        !["intent", "subscription", "legacy_catalog"].includes(
          paymentSnapshotSource,
        ) ||
        ![1, 6, 12].includes(billingPeriodMonths) ||
        !Number.isFinite(amount) || amount <= 0
      ) {
        return null;
      }

      const { data: payment, error: paymentError } = await supabase
        .from("asaas_payments")
        .select(
          "id,organization_id,billing_intent_id,asaas_payment_id,asaas_customer_id,asaas_subscription_id,status,billing_type,value,due_date,payment_date,invoice_url,updated_at",
        )
        .eq("id", resolved.payment_id)
        .eq("organization_id", resolved.organization_id)
        .maybeSingle();
      if (paymentError) throw paymentError;
      if (
        !payment ||
        payment.billing_intent_id !== resolved.billing_intent_id ||
        !payment.asaas_payment_id?.trim() ||
        !payment.asaas_customer_id?.trim() ||
        !payment.due_date ||
        !["PIX", "BOLETO", "CREDIT_CARD"].includes(
          (payment.billing_type || "").trim().toUpperCase(),
        )
      ) {
        return null;
      }

      organizationId = resolved.organization_id;
      access = {
        scope: "payment",
        checkoutToken,
        canPersistBillingProfile: false,
        authorizedUserId: null,
        paymentId: payment.id,
        providerPaymentId: payment.asaas_payment_id.trim(),
        providerCustomerId: payment.asaas_customer_id.trim(),
        providerSubscriptionId:
          payment.asaas_subscription_id?.trim() || null,
        billingIntentId: resolved.billing_intent_id?.trim() || null,
        paymentSnapshotSource: resolved.snapshot_source as PaymentSnapshotSource,
        billingType: payment.billing_type.trim().toUpperCase() as
          BillingIntentMethod,
        paymentStatus: payment.status?.trim().toUpperCase() || null,
        paymentAmount: amount,
        paymentDueDate: payment.due_date,
        paymentDate: payment.payment_date || null,
        paymentInvoiceUrl: payment.invoice_url || null,
        paymentUpdatedAt: payment.updated_at || null,
        planId: resolved.plan_id,
        billingPeriodMonths:
          billingPeriodMonths as BillingPeriodMonths,
        cardRecurrenceStatus:
          resolved.card_recurrence_status?.trim().toLowerCase() || null,
        bankSlipRegistrationCancelled:
          resolved.bank_slip_registration_cancelled === true,
        bankSlipRegistrationCancelledAt:
          resolved.bank_slip_registration_cancelled_at || null,
        bankSlipRegistrationCancelledDueDate:
          resolved.bank_slip_registration_cancelled_due_date || null,
      };
    } else {
      const { data: checkoutCapability, error: checkoutCapabilityError } =
        await supabase
          .from("organization_checkout_capabilities")
          .select("organization_id")
          .eq("checkout_token", checkoutToken)
          .maybeSingle();

      if (checkoutCapabilityError) throw checkoutCapabilityError;
      if (!checkoutCapability?.organization_id) return null;
      organizationId = checkoutCapability.organization_id;
      access = {
        scope: "organization",
        checkoutToken,
        canPersistBillingProfile: false,
        authorizedUserId: null,
      };
    }
  }

  if (!organizationId) return null;

  const query = supabase
    .from("organizations")
    .select(
      "id,name,logo_url,subscription_status,subscription_value,plan_id,pending_plan_id,email,whatsapp,cnpj,billing_legal_name,billing_tax_id,billing_email,billing_phone,billing_postal_code,billing_address,billing_address_number,billing_address_complement,billing_neighborhood,billing_city,billing_state,created_by,asaas_customer_id,asaas_subscription_id",
    )
    .eq("id", organizationId)
    .eq("is_active", true);

  const { data: organization, error: organizationError } = await query
    .maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) return null;

  let billingUser: {
    name: string | null;
    email: string | null;
    cpf: string | null;
    whatsapp: string | null;
  } | null = null;

  if (params.includeBillingProfile && organization.created_by) {
    const { data, error } = await supabase
      .from("users")
      .select("name,email,cpf,whatsapp")
      .eq("id", organization.created_by)
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (error) throw error;
    billingUser = data;
  }

  const taxId = organization.billing_tax_id?.trim() ||
    billingUser?.cpf?.trim() || organization.cnpj?.trim() || "";
  const companyDocument = onlyDigits(taxId).length === 14;
  const billingProfile: CheckoutBillingProfile | null =
    params.includeBillingProfile
      ? {
        name: organization.billing_legal_name?.trim() ||
          (companyDocument
            ? organization.name.trim() || billingUser?.name?.trim() || ""
            : billingUser?.name?.trim() || organization.name.trim()),
        email:
          organization.billing_email?.trim() || billingUser?.email?.trim() ||
          organization.email?.trim() || "",
        cpf_cnpj: taxId,
        phone:
          organization.billing_phone?.trim() || billingUser?.whatsapp?.trim() ||
          organization.whatsapp?.trim() || "",
        country: "BR",
        postal_code: organization.billing_postal_code?.trim() || "",
        address: organization.billing_address?.trim() || "",
        address_number: organization.billing_address_number?.trim() || "",
        address_complement:
          organization.billing_address_complement?.trim() || "",
        neighborhood: organization.billing_neighborhood?.trim() || "",
        city: organization.billing_city?.trim() || "",
        state: organization.billing_state?.trim().toUpperCase() || "",
      }
      : null;

  let plan: CheckoutPlan | null = null;

  const checkoutPlanId = access.scope === "payment"
    ? access.planId
    : organization.pending_plan_id || organization.plan_id;
  if (checkoutPlanId) {
    const { data: planData, error: planError } = await supabase
      .from("admin_subscription_plans")
      .select(checkoutPlanSelect)
      .eq("id", checkoutPlanId)
      .maybeSingle();

    if (planError) throw planError;
    if (planData) {
      plan = {
        ...planData,
        price: Number(planData.price || 0),
      };
    }
  }

  return {
    organization: {
      ...organization,
      subscription_value: organization.subscription_value
        ? Number(organization.subscription_value)
        : null,
    },
    plan,
    billingProfile,
    access,
  } as CheckoutRecord;
}

export async function getAuthorizedCheckoutRecord(
  request: Request,
  params: { token?: string | null; organizationId?: string | null },
) {
  if (params.token?.trim() && params.organizationId?.trim()) return null;

  if (params.organizationId) {
    const authorizedUserId = await authorizedBillingUserId(
      request,
      params.organizationId,
    );
    if (!authorizedUserId) return null;
    const record = await getCheckoutRecord({
      organizationId: params.organizationId,
      includeBillingProfile: true,
    });
    if (record?.access.scope === "organization") {
      record.access.authorizedUserId = authorizedUserId;
    }
    return record;
  }

  if (params.token) {
    return getCheckoutRecord({ token: params.token });
  }

  return null;
}

export async function canAccessOrganizationPayment(
  request: Request,
  organizationId: string,
  checkoutToken?: string | null,
) {
  const normalizedToken = checkoutToken?.trim().toLowerCase() || "";
  if (normalizedToken) {
    const supabase = getSupabaseAdmin();
    const { data: paymentCapability } = await supabase.rpc(
      "resolve_billing_payment_checkout_capability",
      { p_checkout_token: normalizedToken },
    );
    if (
      paymentCapability?.outcome === "resolved" &&
      paymentCapability.organization_id === organizationId
    ) {
      return true;
    }

    const { data } = await supabase
      .from("organization_checkout_capabilities")
      .select("organization_id")
      .eq("organization_id", organizationId)
      .eq("checkout_token", normalizedToken)
      .maybeSingle();

    if (data) return true;
  }

  return canManageOrganizationBilling(request, organizationId);
}

async function canManageOrganizationBilling(
  request: Request,
  organizationId: string,
) {
  return Boolean(await authorizedBillingUserId(request, organizationId));
}

async function authorizedBillingUserId(
  request: Request,
  organizationId: string,
) {
  const authorization = request.headers.get("authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken || !organizationId) return null;

  const supabase = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabase.auth.getUser(
    accessToken,
  );
  const userId = authData.user?.id;
  if (authError || !userId) return null;

  const { data: superAdmin } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .maybeSingle();
  if (superAdmin) return userId;

  const { data: membership } = await supabase
    .from("organization_members")
    .select(
      "role,organization:organizations!inner(id,is_active),user:users!inner(id,is_active)",
    )
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("organization.is_active", true)
    .eq("user.is_active", true)
    .maybeSingle();

  if (!membership) return null;
  if (membership.role === "owner" || membership.role === "admin") {
    return userId;
  }

  const { data: permissionOverride } = await supabase
    .from("user_permission_overrides")
    .select("allowed")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("permission_key", "settings_billing")
    .maybeSingle();
  if (permissionOverride) {
    return permissionOverride.allowed === true ? userId : null;
  }

  const { data: assignedRoles } = await supabase
    .from("user_organization_roles")
    .select("role_id,organization_role_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true);

  const roleIds = (assignedRoles || [])
    .flatMap((assignment) => [
      assignment.role_id,
      assignment.organization_role_id,
    ])
    .filter((roleId): roleId is string => Boolean(roleId));
  if (roleIds.length === 0) return null;

  const { data: canonicalPermission } = await supabase
    .from("organization_role_permissions")
    .select("permission:available_permissions!inner(key)")
    .eq("organization_id", organizationId)
    .in("role_id", roleIds)
    .eq("permission.key", "settings_billing")
    .limit(1)
    .maybeSingle();
  if (canonicalPermission) return userId;

  const { data: legacyPermission } = await supabase
    .from("organization_role_permissions")
    .select("id")
    .in("organization_role_id", roleIds)
    .eq("permission_key", "settings_billing")
    .limit(1)
    .maybeSingle();

  return legacyPermission ? userId : null;
}

export function paymentCapabilityExpectedExternalReference(
  access: PaymentCheckoutAccess,
) {
  if (access.billingIntentId?.trim()) return access.billingIntentId.trim();
  if (
    access.paymentSnapshotSource === "subscription" ||
    access.paymentSnapshotSource === "legacy_catalog"
  ) {
    return undefined;
  }
  return null;
}

export function paymentCapabilityCheckoutIntegrity(input: {
  access: PaymentCheckoutAccess;
  payment: AsaasPayment;
  validateMutableFields?: boolean;
}): AsaasCheckoutPaymentIntegrity {
  const providerBillingType = (input.payment.billingType || "")
    .trim()
    .toUpperCase();
  const validateMutableFields = input.validateMutableFields !== false;

  return asaasCheckoutPaymentIntegrity({
    expectedPaymentId: input.access.providerPaymentId,
    expectedCustomerId: input.access.providerCustomerId,
    expectedSubscriptionId: input.access.providerSubscriptionId,
    expectedBillingType: validateMutableFields
      ? input.access.billingType
      : providerBillingType as BillingIntentMethod,
    expectedAmount: input.access.paymentAmount,
    expectedDueDate: validateMutableFields
      ? input.access.paymentDueDate
      : input.payment.dueDate || "",
    expectedExternalReference:
      paymentCapabilityExpectedExternalReference(input.access),
    providerPaymentId: input.payment.id,
    providerCustomerId: input.payment.customer,
    providerSubscriptionId: input.payment.subscription,
    providerBillingType,
    providerAmount: input.payment.value,
    providerDueDate: input.payment.dueDate,
    providerExternalReference: input.payment.externalReference,
    providerDeleted: input.payment.deleted,
  });
}

export async function ensureAsaasCustomer(input: {
  organization: CheckoutOrganization;
  updateExistingProfile: boolean;
  holderName?: string;
  holderEmail: string;
  holderCpfCnpj: string;
  holderPhone?: string;
  holderPostalCode?: string;
  holderAddress?: string;
  holderAddressNumber?: string;
  holderAddressComplement?: string;
  holderNeighborhood?: string;
}) {
  const customerPayload = {
    name: input.holderName?.trim() || input.organization.name,
    email: input.holderEmail,
    cpfCnpj: onlyDigits(input.holderCpfCnpj || input.organization.cnpj),
    mobilePhone: normalizeAsaasPhone(
      input.holderPhone || input.organization.whatsapp,
    ),
    postalCode: onlyDigits(input.holderPostalCode),
    address: input.holderAddress?.trim() || undefined,
    addressNumber: input.holderAddressNumber?.trim() || undefined,
    complement: input.holderAddressComplement?.trim() || undefined,
    province: input.holderNeighborhood?.trim() || undefined,
    externalReference: input.organization.id,
    notificationDisabled: true,
  };

  const persistCustomerId = async (customerId: string) => {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("organizations")
      .update({ asaas_customer_id: customerId })
      .eq("id", input.organization.id);

    if (error) throw error;
  };

  if (input.organization.asaas_customer_id) {
    await suppressExistingAsaasCustomerNotifications({
      customerId: input.organization.asaas_customer_id,
      profile: customerPayload,
      updateExistingProfile: input.updateExistingProfile,
      request: asaasRequest<AsaasCustomer>,
    });

    return input.organization.asaas_customer_id;
  }

  const existingCustomers = await asaasRequest<AsaasCustomerList>(
    `/customers?externalReference=${encodeURIComponent(input.organization.id)}&limit=1`,
  );
  const existingCustomer = existingCustomers.data?.[0];
  if (existingCustomer?.id) {
    await suppressExistingAsaasCustomerNotifications({
      customerId: existingCustomer.id,
      profile: customerPayload,
      updateExistingProfile: input.updateExistingProfile,
      request: asaasRequest<AsaasCustomer>,
    });
    await persistCustomerId(existingCustomer.id);
    return existingCustomer.id;
  }

  const customer = await asaasRequest<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(customerPayload),
  });
  assertAsaasCustomerNotificationsDisabled(customer);

  await persistCustomerId(customer.id);

  return customer.id;
}

export async function saveOrganizationBillingProfile(input: {
  organizationId: string;
  name: string;
  email: string;
  cpfCnpj: string;
  phone: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("organizations")
    .update({
      billing_legal_name: input.name.trim(),
      billing_tax_id: onlyDigits(input.cpfCnpj),
      billing_email: input.email.trim().toLowerCase(),
      billing_phone: normalizeAsaasPhone(input.phone),
      billing_postal_code: onlyDigits(input.postalCode),
      billing_address: input.address.trim(),
      billing_address_number: input.addressNumber.trim(),
      billing_address_complement: input.addressComplement.trim() || null,
      billing_neighborhood: input.neighborhood.trim(),
      billing_city: input.city.trim(),
      billing_state: input.state.trim().toUpperCase(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.organizationId);

  if (error) throw error;
}

export function getCheckoutValue(record: CheckoutRecord) {
  return record.plan?.price || 0;
}

export function isPaidStatus(status?: string | null) {
  const normalized = status?.trim().toUpperCase() || "";
  return normalized === "CONFIRMED" || normalized === "RECEIVED" ||
    normalized === "RECEIVED_IN_CASH" || normalized === "REFUND_DENIED";
}

export async function reconcileOrganizationPaymentSnapshot(input: {
  organizationId: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerSubscriptionStatus?: string | null;
  paymentStatus?: string | null;
  nextBillingDate?: string | null;
  observedAt?: string | null;
  source?: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "reconcile_asaas_billing_snapshot",
    {
      p_organization_id: input.organizationId,
      p_provider_customer_id: input.providerCustomerId || null,
      p_provider_subscription_id: input.providerSubscriptionId || null,
      p_provider_subscription_status: input.providerSubscriptionStatus || null,
      p_latest_payment_status: input.paymentStatus || null,
      p_next_billing_date: input.nextBillingDate || null,
      p_observed_at: input.observedAt || new Date().toISOString(),
      p_source: input.source || "edge_poll",
    },
  );

  if (error) throw error;
  return data;
}

export async function registerPendingOrganizationSubscription(input: {
  organizationId: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("register_pending_asaas_subscription", {
    p_organization_id: input.organizationId,
    p_customer_id: input.providerCustomerId,
    p_subscription_id: input.providerSubscriptionId,
  });

  if (error) throw error;
}

export async function reserveBillingCheckoutIntent(
  organizationId: string,
  billingMethod: BillingIntentMethod,
  billingPeriodMonths: BillingPeriodMonths,
  expectedPlanId?: string | null,
  expectedMonthlyPrice?: number | null,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "reserve_billing_checkout_intent",
    billingCheckoutIntentRpcArgs(
      organizationId,
      billingMethod,
      billingPeriodMonths,
      expectedPlanId,
      expectedMonthlyPrice,
    ),
  );

  if (error) throw error;
  return data as BillingCheckoutIntent;
}

export async function getBillingCheckoutState(organizationId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("get_billing_checkout_state", {
    p_organization_id: organizationId,
  });

  if (error) throw error;
  return data ? data as BillingCheckoutState : null;
}

export function publicBillingCheckoutState(
  state: BillingCheckoutState | null,
): PublicBillingCheckoutState | null {
  if (!state) return null;

  return {
    intent_id: state.intent_id,
    plan_id: state.plan_id,
    billing_method: state.billing_method,
    status: state.status,
    billing_period_months: state.billing_period_months,
    amount: Number(state.amount),
    payment_id: state.provider_payment_id || state.payment?.id || null,
    subscription_id: state.provider_subscription_id || null,
    checkout_id: state.provider_checkout_id || null,
    provider_status: state.payment?.status || state.provider_status || null,
    card_last4: /^\d{4}$/.test(state.card_last4 || "")
      ? state.card_last4
      : null,
    created_at: state.created_at,
    updated_at: state.updated_at,
  };
}

export async function registerBillingCheckoutProvider(input: {
  intentId: string;
  customerId: string;
  paymentId?: string | null;
  subscriptionId?: string | null;
  providerResponse?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "register_billing_checkout_provider",
    {
      p_intent_id: input.intentId,
      p_customer_id: input.customerId,
      p_payment_id: input.paymentId || null,
      p_subscription_id: input.subscriptionId || null,
      p_provider_response: input.providerResponse || {},
    },
  );

  if (error) throw error;
  return data;
}

export async function registerBillingHostedCheckout(input: {
  intentId: string;
  checkout: AsaasHostedCheckout;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "register_billing_hosted_checkout",
    {
      p_intent_id: input.intentId,
      p_checkout_id: input.checkout.id,
      p_provider_response: input.checkout,
    },
  );

  if (error) throw error;
  return data;
}

export async function storeBillingCheckoutPayment(input: {
  intentId: string;
  organizationId: string;
  payment: AsaasPayment;
  customerId?: string | null;
  subscriptionId?: string | null;
  billingType: BillingIntentMethod;
  fallbackValue?: number | null;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("store_billing_checkout_payment", {
    p_intent_id: input.intentId,
    p_organization_id: input.organizationId,
    p_payment_id: input.payment.id,
    p_customer_id: input.payment.customer || input.customerId || null,
    p_subscription_id: input.payment.subscription || input.subscriptionId ||
      null,
    p_billing_type: input.payment.billingType || input.billingType,
    p_status: input.payment.status || null,
    p_value: input.payment.value ?? input.fallbackValue ?? null,
    p_net_value: input.payment.netValue ?? null,
    p_due_date: input.payment.dueDate || null,
    p_payment_date: input.payment.paymentDate || null,
    p_invoice_url: input.payment.invoiceUrl || input.payment.bankSlipUrl || null,
    p_raw_event: safeAsaasPaymentSnapshot(input.payment),
  });

  if (error) throw error;
  if (!data || data.outcome !== "stored") {
    throw new Error("The billing payment snapshot was not stored exactly.");
  }
  return data as Record<string, unknown> & { outcome: "stored" };
}

export type BillingPaymentAttemptClaim = Record<string, unknown> & {
  outcome?: string;
  lease_id?: string | null;
  lease_expires_at?: string | null;
  retry_after_seconds?: number | null;
  attempts_remaining?: number | null;
  payment_status?: string | null;
};

export async function reconcileAsaasPaymentMethodChange(input: {
  paymentId: string;
  organizationId: string;
  billingIntentId: string | null;
  providerPaymentId: string;
  providerCustomerId: string;
  providerSubscriptionId: string | null;
  externalReference: string | null;
  paymentAmount: number;
  expectedOldBillingType: string;
  expectedOldStatus: string | null;
  expectedOldDueDate: string;
  newBillingType: string;
  newStatus: string;
  newDueDate: string;
  observedAt: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "reconcile_asaas_payment_method_change",
    {
      p_payment_id: input.paymentId,
      p_organization_id: input.organizationId,
      p_billing_intent_id: input.billingIntentId,
      p_provider_payment_id: input.providerPaymentId,
      p_provider_customer_id: input.providerCustomerId,
      p_provider_subscription_id: input.providerSubscriptionId,
      p_external_reference: input.externalReference,
      p_payment_amount: input.paymentAmount,
      p_expected_old_billing_type: input.expectedOldBillingType,
      p_expected_old_status: input.expectedOldStatus,
      p_expected_old_due_date: input.expectedOldDueDate,
      p_new_billing_type: input.newBillingType,
      p_new_status: input.newStatus,
      p_new_due_date: input.newDueDate,
      p_observed_at: input.observedAt,
    },
  );
  if (error) throw error;
  const result = (data || {}) as Record<string, unknown> & {
    outcome?: string;
  };
  return {
    ...result,
    outcome: typeof result.outcome === "string" ? result.outcome : "",
  };
}

export async function reconcilePaymentCapabilityMethodChange(input: {
  record: AuthorizedCheckoutRecord;
  payment: AsaasPayment;
  observedAt: Date;
}) {
  const access = input.record.access;
  if (access.scope !== "payment") {
    return { outcome: "capability_scope_mismatch" };
  }

  const integrity = paymentCapabilityCheckoutIntegrity({
    access,
    payment: input.payment,
    validateMutableFields: false,
  });
  if (integrity !== "valid") return { outcome: integrity };

  const oldBillingType = access.billingType;
  const newBillingType = (input.payment.billingType || "")
    .trim()
    .toUpperCase();
  const newStatus = (input.payment.status || "").trim().toUpperCase();
  const newDueDate = input.payment.dueDate || "";
  if (
    !["PIX", "BOLETO", "CREDIT_CARD"].includes(newBillingType) ||
    !newStatus || !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate) ||
    !Number.isFinite(input.observedAt.getTime())
  ) {
    return { outcome: "invalid_provider_snapshot" };
  }

  const changed = await reconcileAsaasPaymentMethodChange({
    paymentId: access.paymentId,
    organizationId: input.record.organization.id,
    billingIntentId: access.billingIntentId,
    providerPaymentId: input.payment.id,
    providerCustomerId: input.payment.customer || "",
    providerSubscriptionId: input.payment.subscription || null,
    externalReference:
      paymentCapabilityExpectedExternalReference(access) || null,
    paymentAmount: Number(input.payment.value),
    expectedOldBillingType: oldBillingType,
    expectedOldStatus: access.paymentStatus,
    expectedOldDueDate: access.paymentDueDate,
    newBillingType,
    newStatus,
    newDueDate,
    observedAt: input.observedAt.toISOString(),
  });
  if (!["updated", "already_updated"].includes(changed.outcome)) {
    return changed;
  }
  return changed;
}

export async function reconcileBillingCheckoutPaidPayment(
  payment: AsaasPayment,
  observedAt?: Date | string | null,
) {
  const supabase = getSupabaseAdmin();
  const observation = observedAt instanceof Date
    ? observedAt
    : observedAt
    ? new Date(observedAt)
    : new Date();
  const rpcCall = asaasPaidPaymentPollingRpcCall(
    safeAsaasPaymentSnapshot(payment) as Record<string, unknown> & {
      id: string;
      status?: string | null;
    },
    observation,
  );
  const { data, error } = await supabase.rpc(rpcCall.name, rpcCall.args);
  if (error) throw error;
  return data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
}

export async function failBillingCheckoutIntent(
  intentId: string,
  errorMessage: string,
) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("fail_billing_checkout_intent", {
    p_intent_id: intentId,
    p_error: errorMessage,
  });
  if (error) throw error;
}

export async function cancelBillingCheckoutIntent(
  organizationId: string,
  paymentId: string,
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("cancel_billing_checkout_intent", {
    p_organization_id: organizationId,
    p_payment_id: paymentId,
  });
  if (error) throw error;
  return (data || {}) as { outcome?: string };
}

export async function cancelBillingCheckoutResource(input: {
  organizationId: string;
  intentId: string;
  paymentId?: string | null;
  subscriptionId?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "cancel_billing_checkout_resource",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_payment_id: input.paymentId || null,
      p_subscription_id: input.subscriptionId || null,
    },
  );
  if (error) throw error;
  return (data || {}) as {
    outcome?: string;
    payment_id?: string | null;
    subscription_id?: string | null;
    checkout_id?: string | null;
    retry_after_at?: string | null;
    retry_after_seconds?: number | null;
  };
}

export type BillingPaymentCheckoutCancellationClaim = {
  outcome?: string;
  final_outcome?: string | null;
  last_error_code?: string | null;
  claim_token?: string | null;
  payment_row_id?: string | null;
  payment_id?: string | null;
  customer_id?: string | null;
  external_reference?: string | null;
  amount?: number | string | null;
  billing_type?: string | null;
  due_date?: string | null;
  provider_delete_started_at?: string | null;
  lease_expires_at?: string | null;
  busy_reason?: string | null;
  retry_after_seconds?: number | null;
};

export type BillingPaymentCancellationJob = {
  organization_id: string;
  intent_id: string;
  payment_row_id: string;
  provider_payment_id: string;
  provider_customer_id: string;
  external_reference: string;
  amount: number | string;
  billing_type: "PIX" | "BOLETO";
  due_date: string;
  claim_token: string;
  lease_expires_at: string;
  claim_outcome: "claimed" | "recover_only";
};

export async function reconcileAsaasPaymentSnapshot(input: {
  organizationId: string;
  providerPaymentId: string;
  providerCustomerId: string;
  providerSubscriptionId?: string | null;
  paymentStatus: string;
  paymentAmount: number;
  paymentDueDate: string;
  observedAt: string;
  source: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "reconcile_asaas_payment_snapshot",
    {
      p_organization_id: input.organizationId,
      p_provider_payment_id: input.providerPaymentId,
      p_provider_customer_id: input.providerCustomerId,
      p_provider_subscription_id: input.providerSubscriptionId || null,
      p_payment_status: input.paymentStatus,
      p_payment_amount: input.paymentAmount,
      p_payment_due_date: input.paymentDueDate,
      p_observed_at: input.observedAt,
      p_source: input.source,
    },
  );
  if (error) throw error;
  return (data || {}) as Record<string, unknown> & { outcome?: string };
}

export type BillingPaymentCheckoutAttempt = BillingPaymentAttemptClaim;

export async function claimBillingPaymentCheckoutAttempt(input: {
  paymentId: string;
  providerPaymentId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_payment_checkout_attempt",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingPaymentCheckoutAttempt;
}

export async function releaseBillingPaymentCheckoutAttempt(input: {
  paymentId: string;
  providerPaymentId: string;
  leaseId: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "release_billing_payment_checkout_attempt",
    {
      p_payment_id: input.paymentId,
      p_provider_payment_id: input.providerPaymentId,
      p_lease_id: input.leaseId,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as BillingPaymentCheckoutAttempt;
}

export async function claimBillingPaymentRestore(input: {
  paymentId: string;
  checkoutToken: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_payment_restore",
    {
      p_payment_id: input.paymentId,
      p_checkout_token: input.checkoutToken,
    },
  );
  if (error) throw error;
  return (data || { outcome: "invalid_input" }) as Record<string, unknown> & {
    outcome?: string;
    attempt_id?: string | null;
    provider_request_started_at?: string | null;
    status_before_restore?: string | null;
  };
}

export async function claimBillingPaymentCheckoutCancellation(input: {
  organizationId: string;
  intentId: string;
  providerPaymentId: string;
  leaseOwner: string;
  leaseSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_payment_checkout_cancellation",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_provider_payment_id: input.providerPaymentId,
      p_lease_owner: input.leaseOwner,
      p_lease_seconds: input.leaseSeconds,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingPaymentCheckoutCancellationClaim;
}

export async function claimBillingPaymentCheckoutCancellationJobs(input: {
  workerId: string;
  limit: number;
  leaseSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_payment_checkout_cancellation_jobs",
    {
      p_worker_id: input.workerId,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    },
  );
  if (error) throw error;
  return (data || []) as BillingPaymentCancellationJob[];
}

export async function markBillingPaymentCheckoutCancellationDeleteStarted(
  input: {
    organizationId: string;
    intentId: string;
    claimToken: string;
    providerPaymentId: string;
  },
) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "mark_billing_payment_checkout_cancellation_delete_started",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_claim_token: input.claimToken,
      p_provider_payment_id: input.providerPaymentId,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingPaymentCheckoutCancellationClaim;
}

export async function failBillingPaymentCheckoutCancellation(input: {
  organizationId: string;
  intentId: string;
  claimToken: string;
  failureClass: "retryable" | "permanent";
  errorCode: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "fail_billing_payment_checkout_cancellation",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_claim_token: input.claimToken,
      p_failure_class: input.failureClass,
      p_error_code: input.errorCode,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingPaymentCheckoutCancellationClaim;
}

export async function finalizeBillingPaymentCheckoutCancellation(input: {
  organizationId: string;
  intentId: string;
  claimToken: string;
  providerPaymentId: string;
  providerDeleteResult: "deleted" | "not_found" | "paid";
  providerDeletedAt?: Date | string | null;
}) {
  const supabase = getSupabaseAdmin();
  const providerDeletedAt = input.providerDeletedAt instanceof Date
    ? input.providerDeletedAt.toISOString()
    : input.providerDeletedAt || null;
  const { data, error } = await supabase.rpc(
    "finalize_billing_payment_checkout_cancellation",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_claim_token: input.claimToken,
      p_provider_payment_id: input.providerPaymentId,
      p_provider_delete_result: input.providerDeleteResult,
      p_provider_deleted_at: providerDeletedAt,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingPaymentCheckoutCancellationClaim;
}

export type BillingSubscriptionCancellationJob = {
  organization_id: string;
  intent_id: string;
  provider_payment_id: string | null;
  reconciliation_payment_id: string | null;
  provider_subscription_id: string;
  provider_customer_id: string;
  external_reference: string;
  amount: number | string;
  billing_period_months: BillingPeriodMonths;
  next_due_date: string;
  claim_token: string;
  lease_expires_at: string;
};

type BillingSubscriptionCancellationOutcome = {
  outcome?: string;
  final_outcome?: string | null;
  last_error_code?: string | null;
  claim_token?: string | null;
  payment_id?: string | null;
  reconciliation_payment_id?: string | null;
  subscription_id?: string | null;
  customer_id?: string | null;
  external_reference?: string | null;
  amount?: number | string | null;
  billing_period_months?: number | null;
  next_due_date?: string | null;
  retry_after_seconds?: number | null;
};

export async function claimBillingSubscriptionCheckoutCancellation(input: {
  organizationId: string;
  intentId: string;
  paymentId?: string | null;
  subscriptionId: string;
  leaseOwner: string;
  leaseSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_subscription_checkout_cancellation",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_payment_id: input.paymentId || null,
      p_subscription_id: input.subscriptionId,
      p_lease_owner: input.leaseOwner,
      p_lease_seconds: input.leaseSeconds,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingSubscriptionCancellationOutcome;
}

export async function claimBillingSubscriptionCheckoutCancellationJobs(input: {
  workerId: string;
  limit: number;
  leaseSeconds: number;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "claim_billing_subscription_checkout_cancellation_jobs",
    {
      p_worker_id: input.workerId,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    },
  );
  if (error) throw error;
  return (data || []) as BillingSubscriptionCancellationJob[];
}

export async function failBillingSubscriptionCheckoutCancellation(input: {
  organizationId: string;
  intentId: string;
  claimToken: string;
  failureClass: "retryable" | "permanent" | "ambiguous";
  errorCode: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "fail_billing_subscription_checkout_cancellation",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_claim_token: input.claimToken,
      p_failure_class: input.failureClass,
      p_error_code: input.errorCode,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingSubscriptionCancellationOutcome;
}

export async function finalizeBillingSubscriptionCheckoutCancellation(input: {
  organizationId: string;
  intentId: string;
  claimToken: string;
  subscriptionId: string;
  providerDeletedAt: Date | string;
}) {
  const supabase = getSupabaseAdmin();
  const providerDeletedAt = input.providerDeletedAt instanceof Date
    ? input.providerDeletedAt.toISOString()
    : input.providerDeletedAt;
  const { data, error } = await supabase.rpc(
    "finalize_billing_subscription_checkout_cancellation",
    {
      p_organization_id: input.organizationId,
      p_intent_id: input.intentId,
      p_claim_token: input.claimToken,
      p_subscription_id: input.subscriptionId,
      p_provider_deleted_at: providerDeletedAt,
    },
  );
  if (error) throw error;
  return (data || {}) as BillingSubscriptionCancellationOutcome;
}

export async function recoverBillingProviderResource(
  method: BillingIntentMethod,
  externalReference: string,
) {
  const result = await asaasRequest<{
    data?: Array<AsaasPayment | AsaasSubscription>;
  }>(providerRecoveryPath(method, externalReference));

  return result.data?.find((item) =>
    item.externalReference === externalReference
  ) || null;
}

export async function recoverHostedCheckout(checkoutId: string) {
  return asaasRequest<AsaasHostedCheckout>(
    hostedCheckoutRecoveryPath(checkoutId),
  );
}
