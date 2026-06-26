import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

export type CheckoutOrganization = {
  id: string;
  name: string;
  logo_url: string | null;
  subscription_status: string | null;
  subscription_value: number | null;
  plan_id: string | null;
  email: string | null;
  whatsapp: string | null;
  cnpj: string | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
};

export type CheckoutPlan = {
  id: string;
  name: string;
  price: number;
  billing_cycle: string | null;
  description: string | null;
};

export type CheckoutRecord = {
  organization: CheckoutOrganization;
  plan: CheckoutPlan | null;
};

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
};

export type AsaasPixQrCode = {
  encodedImage?: string;
  payload?: string;
};

export type AsaasCustomer = {
  id: string;
};

export type AsaasSubscription = {
  id: string;
  status?: string;
  nextDueDate?: string;
  value?: number;
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

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

export function isoTimestampFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || undefined;
  return request.headers.get("x-real-ip") || undefined;
}

export async function asaasRequest<T>(path: string, init: RequestInit = {}) {
  const apiKey = Deno.env.get("ASAAS_API_KEY");
  const baseUrl = Deno.env.get("ASAAS_BASE_URL") || "https://api.asaas.com/v3";

  if (!apiKey) {
    throw new Error("ASAAS_API_KEY is not configured.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload?.errors?.[0]?.description ||
      payload?.message ||
      `Asaas request failed with status ${response.status}`;

    throw new AsaasRequestError(message, response.status);
  }

  return payload as T;
}

export async function getCheckoutRecord(params: {
  token?: string | null;
  organizationId?: string | null;
}) {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("organizations")
    .select(
      "id,name,logo_url,subscription_status,subscription_value,plan_id,email,whatsapp,cnpj,asaas_customer_id,asaas_subscription_id",
    )
    .eq("is_active", true);

  if (params.token) {
    query = query.eq("checkout_token", params.token);
  } else if (params.organizationId) {
    query = query.eq("id", params.organizationId);
  } else {
    return null;
  }

  const { data: organization, error: organizationError } = await query.maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) return null;

  let plan: CheckoutPlan | null = null;

  if (organization.plan_id) {
    const { data: planData, error: planError } = await supabase
      .from("admin_subscription_plans")
      .select("id,name,price,billing_cycle,description")
      .eq("id", organization.plan_id)
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
  } as CheckoutRecord;
}

export async function ensureAsaasCustomer(input: {
  organization: CheckoutOrganization;
  holderEmail: string;
  holderCpfCnpj: string;
  holderPhone?: string;
}) {
  const customerPayload = {
    name: input.organization.name,
    email: input.holderEmail,
    cpfCnpj: onlyDigits(input.holderCpfCnpj || input.organization.cnpj),
    mobilePhone: normalizeAsaasPhone(input.holderPhone || input.organization.whatsapp),
    notificationDisabled: true,
  };

  if (input.organization.asaas_customer_id) {
    await asaasRequest<AsaasCustomer>(
      `/customers/${input.organization.asaas_customer_id}`,
      {
        method: "PUT",
        body: JSON.stringify(customerPayload),
      },
    );

    return input.organization.asaas_customer_id;
  }

  const customer = await asaasRequest<AsaasCustomer>("/customers", {
    method: "POST",
    body: JSON.stringify(customerPayload),
  });

  const supabase = getSupabaseAdmin();
  await supabase
    .from("organizations")
    .update({ asaas_customer_id: customer.id })
    .eq("id", input.organization.id);

  return customer.id;
}

export function getCheckoutValue(record: CheckoutRecord) {
  return record.organization.subscription_value && record.organization.subscription_value > 0
    ? record.organization.subscription_value
    : record.plan?.price || 0;
}

export function isPaidStatus(status?: string | null) {
  return status === "CONFIRMED" || status === "RECEIVED" || status === "RECEIVED_IN_CASH";
}

export async function activateOrganizationPayment(input: {
  organizationId: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const currentPeriodEnd = isoTimestampFromNow(30);

  await supabase
    .from("organizations")
    .update({
      subscription_status: "active",
      asaas_customer_id: input.providerCustomerId || undefined,
      asaas_subscription_id: input.providerSubscriptionId || undefined,
      next_billing_date: isoDateFromNow(30),
    })
    .eq("id", input.organizationId);

  await supabase
    .from("subscriptions")
    .update({
      status: "active",
      provider: "asaas",
      provider_customer_id: input.providerCustomerId || null,
      provider_subscription_id: input.providerSubscriptionId || null,
      current_period_start: new Date().toISOString(),
      current_period_end: currentPeriodEnd,
    })
    .eq("organization_id", input.organizationId);
}
