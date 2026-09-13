export type PaymentMethod = "PIX" | "BOLETO" | "CREDIT_CARD";

export type ActiveCheckout = {
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

export interface CheckoutInfo {
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

export type PublicCheckoutPlan = {
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

export type PublicCheckoutPlansResponse = {
  data?: PublicCheckoutPlan[];
  error?: string;
};

export type CheckoutPlanChangeResponse = {
  ok?: boolean;
  message?: string;
  requiresPayment?: boolean;
  plan?: PublicCheckoutPlan;
};

export interface PixResult {
  type: "PIX";
  payment_id: string;
  invoice_url?: string;
  qr_code?: string;
  qr_payload?: string;
  value: number;
}

export type CardResult =
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

export interface BoletoResult {
  type: "BOLETO";
  payment_id: string;
  invoice_url?: string;
  bank_slip_url?: string;
  identification_field?: string;
  bar_code?: string;
  due_date: string | null;
  value: number;
}

export type CancelPaymentResult = {
  success?: boolean;
  error?: string;
};

export type PersistedCardUpdateJob = {
  version: 1;
  jobId: string;
  mode: "settled_payment" | "saved_only";
  paymentId: string | null;
  subscriptionId: string | null;
  createdAt: number;
};

export type PaymentRecoveryState =
  | "creating"
  | "pending"
  | "processing"
  | "settled"
  | "retry"
  | "assisted"
  | "cancelled";

export type PaymentStatusResponse = {
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

export type ChargeRequest = {
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

export type ChargeResult =
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

export type CheckoutScreenProps = {
  organizationId?: string | null;
  checkoutToken?: string | null;
};
