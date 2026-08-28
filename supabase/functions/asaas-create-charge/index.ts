import {
  asaasPaymentCanReceiveCheckoutAttempt,
  asaasPaymentDisposition,
  asaasSubscriptionCycle,
  type BillingIntentMethod,
  isBillingPeriodMonths,
  normalizeCheckoutClientIp,
  normalizeCheckoutCreditCard,
  normalizeBillingPeriodMonths,
  providerFailureIsDeterministic,
} from "../_shared/asaas-billing-intent.ts";
import {
  type AuthorizedCheckoutRecord,
  type AsaasBoletoIdentification,
  type AsaasHostedCheckout,
  type AsaasPayment,
  type AsaasPixQrCode,
  type AsaasSubscription,
  asaasRequest,
  AsaasRequestError,
  type BillingCheckoutIntent,
  type CheckoutOrganization,
  checkoutCallbackUrls,
  claimBillingPaymentCheckoutAttempt,
  ensureAsaasCustomer,
  failBillingCheckoutIntent,
  getAuthorizedCheckoutRecord,
  getSupabaseAdmin,
  handleOptions,
  isoDateFromNow,
  isPaidStatus,
  isValidBrazilianTaxId,
  jsonResponse,
  normalizeAsaasPhone,
  onlyDigits,
  paymentCapabilityCheckoutIntegrity,
  reconcileBillingCheckoutPaidPayment,
  reconcilePaymentCapabilityMethodChange,
  recoverBillingProviderResource,
  recoverHostedCheckout,
  releaseBillingPaymentCheckoutAttempt,
  registerBillingCheckoutProvider,
  registerBillingHostedCheckout,
  reserveBillingCheckoutIntent,
  saveOrganizationBillingProfile,
  storeBillingCheckoutPayment,
} from "../_shared/asaas.ts";
import {
  billingCheckoutIpFingerprint,
  claimAuthenticatedOrganizationCardAttempt,
  claimBillingPaymentCardAttemptGuard,
  claimOrganizationCheckoutCardAttempt,
  trustedBillingCheckoutClientIp,
  type BillingCardAttemptClaim,
} from "../_shared/asaas-card-attempt.ts";
import {
  sealBillingCardCredential,
  sealBillingSubscriptionCardCredential,
} from "../_shared/asaas-card-credential.ts";
import {
  failPreparedBillingCardRecurrence,
  markBillingCardCaptureRequestStarted,
  prepareBillingCardRecurrence,
  storeBillingCardRecurrenceCredential,
} from "../_shared/asaas-card-recurrence.ts";
import {
  failBillingSubscriptionCardUpdateCapture,
  markBillingSubscriptionCardUpdateCaptureStarted,
  prepareBillingSubscriptionCardUpdate,
  storeBillingSubscriptionCardUpdateCredential,
} from "../_shared/asaas-subscription-card-update.ts";
import { billingOrganizationIsUnavailable } from "../_shared/billing-organization-state.ts";

type ChargeRequest = {
  idempotency_key?: string;
  billing_profile_mode?: "manual" | "stored";
  billing_type?: BillingIntentMethod;
  billing_period_months?: unknown;
  expected_plan_id?: string;
  expected_monthly_price?: unknown;
  holder_email?: string;
  holder_cpf_cnpj?: string;
  holder_phone?: string;
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
  holder_country?: string;
  card?: unknown;
};

type BillingDetails = {
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
};

type NormalizedCard = NonNullable<
  ReturnType<typeof normalizeCheckoutCreditCard>
>;

type ProviderCardToken = {
  creditCardToken?: string;
  creditCardNumber?: string;
  creditCardBrand?: string;
};

type PaymentMutationAttempt = {
  outcome?: string;
  lease_id?: string | null;
  retry_after_seconds?: number | null;
  payment_status?: string | null;
  busy_reason?: string | null;
};

type PaymentRestoreClaim = PaymentMutationAttempt & {
  payment_id?: string | null;
  provider_payment_id?: string | null;
};

class BillingOrganizationUnavailableError extends Error {
  constructor() {
    super("Billing organization is unavailable.");
    this.name = "BillingOrganizationUnavailableError";
  }
}

class RecurrenceCredentialPersistenceError extends Error {
  preserveExisting: boolean;

  constructor(message: string, preserveExisting = false) {
    super(message);
    this.name = "RecurrenceCredentialPersistenceError";
    this.preserveExisting = preserveExisting;
  }
}

class CardProviderRejectionError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CardProviderRejectionError";
    this.status = status;
  }
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function checkoutUnavailable(intent: BillingCheckoutIntent) {
  const messages: Record<string, string> = {
    active_intent_conflict:
      "Ja existe um checkout ativo. Conclua ou cancele essa cobranca antes de trocar plano ou metodo.",
    already_active:
      "Esta organizacao ja possui uma assinatura paga ativa. Uma nova assinatura nao foi criada.",
    plan_not_staged: "Selecione um plano antes de iniciar o pagamento.",
    invalid_plan: "O plano selecionado nao esta disponivel para cobranca.",
    quote_changed:
      "O plano ou o valor mudou desde que o carrinho foi carregado. Atualize a pagina antes de pagar.",
    organization_not_found: "Organizacao nao encontrada.",
  };

  return jsonResponse(
    {
      success: false,
      code: intent.outcome,
      error: messages[intent.outcome] || "Checkout indisponivel.",
    },
    intent.outcome === "organization_not_found" ? 404 : 409,
  );
}

async function pixCheckoutResponse(input: {
  organizationId: string;
  intent: BillingCheckoutIntent;
  payment: AsaasPayment;
  customerId: string;
  reused: boolean;
}) {
  const intentId = input.intent.intent_id;
  const value = Number(input.intent.amount || 0);
  if (!intentId) throw new Error("Intent de cobranca sem identificador.");

  await registerBillingCheckoutProvider({
    intentId,
    customerId: input.customerId,
    paymentId: input.payment.id,
    subscriptionId: input.payment.subscription || null,
    providerResponse: {
      id: input.payment.id,
      status: input.payment.status || null,
      value: input.payment.value ?? value,
      dueDate: input.payment.dueDate || null,
      invoiceUrl: input.payment.invoiceUrl || null,
      externalReference: input.payment.externalReference ||
        input.intent.external_reference,
    },
  });
  await storeBillingCheckoutPayment({
    organizationId: input.organizationId,
    intentId,
    customerId: input.customerId,
    payment: input.payment,
    billingType: "PIX",
    fallbackValue: value,
  });

  let pix: AsaasPixQrCode = {};
  try {
    pix = await asaasRequest<AsaasPixQrCode>(
      `/payments/${input.payment.id}/pixQrCode`,
    );
  } catch (error) {
    console.warn("Pix QR Code will be recovered by payment-status.", {
      paymentId: input.payment.id,
      status: error instanceof AsaasRequestError ? error.status : 500,
    });
  }
  const processing = !pix.encodedImage || !pix.payload;

  return jsonResponse({
    success: true,
    type: "PIX",
    intent_id: intentId,
    reused: input.reused,
    payment_id: input.payment.id,
    processing,
    status: processing ? "RECOVERING" : input.payment.status || "PENDING",
    message: processing
      ? "O Pix foi criado e o QR Code esta sendo preparado."
      : undefined,
    invoice_url: safeAsaasPublicUrl(input.payment.invoiceUrl),
    qr_code: pix.encodedImage || "",
    qr_payload: pix.payload || "",
    value,
  });
}

function safeAsaasPublicUrl(value: string | null | undefined) {
  if (!value) return "";

  try {
    const url = new URL(value);
    const isAsaasHost = url.hostname === "asaas.com" ||
      url.hostname.endsWith(".asaas.com");
    if (
      url.protocol !== "https:" || !isAsaasHost || url.username || url.password
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getBoletoIdentification(paymentId: string) {
  const delays = [0, 250, 750];
  let lastStatus = 500;

  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    try {
      return await asaasRequest<AsaasBoletoIdentification>(
        `/payments/${encodeURIComponent(paymentId)}/identificationField`,
      );
    } catch (error) {
      lastStatus = error instanceof AsaasRequestError ? error.status : 500;
      if (![404, 408, 409, 425, 429].includes(lastStatus) && lastStatus < 500) {
        break;
      }
    }
  }

  console.warn("Asaas boleto identification field is not available yet.", {
    paymentId,
    status: lastStatus,
  });
  return null;
}

async function boletoCheckoutResponse(input: {
  organizationId: string;
  intent: BillingCheckoutIntent;
  payment: AsaasPayment;
  customerId: string;
  reused: boolean;
}) {
  const intentId = input.intent.intent_id;
  const value = Number(input.intent.amount || 0);
  if (!intentId) throw new Error("Intent de cobranca sem identificador.");

  await registerBillingCheckoutProvider({
    intentId,
    customerId: input.customerId,
    paymentId: input.payment.id,
    providerResponse: {
      id: input.payment.id,
      status: input.payment.status || null,
      value: input.payment.value ?? value,
      dueDate: input.payment.dueDate || null,
      invoiceUrl: input.payment.invoiceUrl || null,
      bankSlipUrl: input.payment.bankSlipUrl || null,
      externalReference: input.payment.externalReference ||
        input.intent.external_reference,
    },
  });
  await storeBillingCheckoutPayment({
    organizationId: input.organizationId,
    intentId,
    customerId: input.customerId,
    payment: input.payment,
    billingType: "BOLETO",
    fallbackValue: value,
  });

  const invoiceUrl = safeAsaasPublicUrl(input.payment.invoiceUrl);
  const bankSlipUrl = safeAsaasPublicUrl(input.payment.bankSlipUrl);
  const processing = !invoiceUrl && !bankSlipUrl;

  let identificationField = "";
  let barCode = "";
  const identification = await getBoletoIdentification(input.payment.id);
  if (identification) {
    identificationField = onlyDigits(identification.identificationField || "");
    barCode = onlyDigits(identification.barCode || "");
  }

  return jsonResponse({
    success: true,
    type: "BOLETO",
    intent_id: intentId,
    reused: input.reused,
    payment_id: input.payment.id,
    processing,
    status: processing ? "RECOVERING" : input.payment.status || "PENDING",
    message: processing
      ? "O boleto foi criado e os dados bancarios estao sendo preparados."
      : undefined,
    invoice_url: invoiceUrl || bankSlipUrl,
    bank_slip_url: bankSlipUrl || invoiceUrl,
    identification_field: identificationField,
    bar_code: barCode,
    due_date: input.payment.dueDate || null,
    value,
  });
}

function savedHostedCheckout(intent: BillingCheckoutIntent) {
  const response = intent.provider_response || {};
  const id = intent.provider_checkout_id ||
    (typeof response.id === "string" ? response.id : null);
  const link = typeof response.link === "string" ? response.link : null;
  if (!id || !link) return null;

  return {
    id,
    link,
    status: typeof response.status === "string" ? response.status : undefined,
    externalReference: intent.external_reference,
  } satisfies AsaasHostedCheckout;
}

function validateHostedCheckout(checkout: AsaasHostedCheckout) {
  if (!checkout.id || !checkout.link) {
    throw new Error("O Asaas nao retornou um link de checkout valido.");
  }

  const link = new URL(checkout.link);
  const isAsaasHost = link.hostname === "asaas.com" ||
    link.hostname.endsWith(".asaas.com");
  if (
    link.protocol !== "https:" || !isAsaasHost || link.username || link.password
  ) {
    throw new Error("O Asaas retornou um checkout inseguro.");
  }
}

function hostedCheckoutResponse(input: {
  intent: BillingCheckoutIntent;
  checkout: AsaasHostedCheckout;
  reused: boolean;
}) {
  validateHostedCheckout(input.checkout);

  return jsonResponse({
    success: true,
    type: "CREDIT_CARD",
    hosted: true,
    intent_id: input.intent.intent_id,
    checkout_id: input.checkout.id,
    checkout_url: input.checkout.link,
    reused: input.reused,
    status: input.checkout.status || "ACTIVE",
    message: "Continue no ambiente seguro do Asaas para informar o cartao.",
  });
}

function savedCardLast4(intent: BillingCheckoutIntent) {
  const value = intent.provider_response?.cardLast4;
  return typeof value === "string" && /^\d{4}$/.test(value) ? value : "";
}

function cardSubscriptionSnapshot(
  subscription: AsaasSubscription,
  cardLast4 = "",
) {
  return {
    id: subscription.id,
    status: subscription.status || null,
    nextDueDate: subscription.nextDueDate || null,
    value: subscription.value ?? null,
    customer: subscription.customer || null,
    externalReference: subscription.externalReference || null,
    billingType: "CREDIT_CARD",
    cardLast4: /^\d{4}$/.test(cardLast4) ? cardLast4 : null,
  };
}

function cardSubscriptionResponse(input: {
  intent: BillingCheckoutIntent;
  subscription: AsaasSubscription;
  reused: boolean;
  cardLast4?: string;
}) {
  if (!input.subscription.id) {
    throw new Error("O Asaas nao retornou uma assinatura valida.");
  }

  return jsonResponse({
    success: true,
    type: "CREDIT_CARD",
    hosted: false,
    intent_id: input.intent.intent_id,
    subscription_id: input.subscription.id,
    reused: input.reused,
    status: input.subscription.status || "PENDING",
    card_last4: /^\d{4}$/.test(input.cardLast4 || "")
      ? input.cardLast4
      : "",
    message:
      "Cartao cadastrado com seguranca no Asaas para as proximas cobrancas.",
  });
}

function normalizeBillingDetails(body: ChargeRequest): BillingDetails | null {
  const name = readText(body.holder_name);
  const email = readText(body.holder_email).toLowerCase();
  const cpfCnpj = onlyDigits(readText(body.holder_cpf_cnpj));
  const phone = normalizeAsaasPhone(readText(body.holder_phone));
  const postalCode = onlyDigits(readText(body.holder_postal_code));
  const address = readText(body.holder_address);
  const addressNumber = readText(body.holder_address_number);
  const addressComplement = readText(body.holder_address_complement);
  const neighborhood = readText(body.holder_neighborhood);
  const city = readText(body.holder_city);
  const state = readText(body.holder_state).toUpperCase();
  const country = readText(body.holder_country).toUpperCase() || "BR";

  if (
    name.length < 2 ||
    name.length > 200 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 320 ||
    !isValidBrazilianTaxId(cpfCnpj) ||
    phone.length < 10 || phone.length > 11 ||
    postalCode.length !== 8 ||
    address.length < 3 ||
    address.length > 200 ||
    !addressNumber || addressNumber.length > 40 ||
    addressComplement.length > 120 ||
    neighborhood.length < 2 ||
    neighborhood.length > 120 ||
    city.length < 2 ||
    city.length > 120 ||
    !/^[A-Z]{2}$/.test(state) ||
    country !== "BR"
  ) {
    return null;
  }

  return {
    name,
    email,
    cpfCnpj,
    phone,
    postalCode,
    address,
    addressNumber,
    addressComplement,
    neighborhood,
    city,
    state,
  };
}

function checkoutBillingDetails(
  body: ChargeRequest,
  record: AuthorizedCheckoutRecord,
) {
  if (body.billing_profile_mode !== "stored") {
    return normalizeBillingDetails(body);
  }
  if (
    record.access.scope !== "organization" ||
    !record.access.canPersistBillingProfile || !record.billingProfile
  ) {
    return null;
  }
  return normalizeBillingDetails({
    holder_name: record.billingProfile.name,
    holder_email: record.billingProfile.email,
    holder_cpf_cnpj: record.billingProfile.cpf_cnpj,
    holder_phone: record.billingProfile.phone,
    holder_postal_code: record.billingProfile.postal_code,
    holder_address: record.billingProfile.address,
    holder_address_number: record.billingProfile.address_number,
    holder_address_complement: record.billingProfile.address_complement,
    holder_neighborhood: record.billingProfile.neighborhood,
    holder_city: record.billingProfile.city,
    holder_state: record.billingProfile.state,
    holder_country: record.billingProfile.country,
  });
}

function billingOrganizationUnavailableResponse(method: BillingIntentMethod) {
  return jsonResponse({
    success: false,
    type: method,
    code: "organization_inactive",
    error: "Esta organizacao nao esta disponivel para cobranca.",
  }, 410);
}

function paymentReconciliationRequiredResponse(input: {
  billingMethod: BillingIntentMethod;
  paymentId: string;
  intentId?: string | null;
  code?: string;
  cardUpdateJobId?: string | null;
}) {
  return jsonResponse({
    success: true,
    type: input.billingMethod,
    payment_id: input.paymentId,
    intent_id: input.intentId || null,
    card_update_job_id: input.cardUpdateJobId || null,
    processing: true,
    status: "RECOVERING",
    code: input.code || "payment_reconciliation_required",
    message:
      "O pagamento esta sendo conciliado e nao sera processado novamente.",
  }, 202, { "Retry-After": "5" });
}

function paymentRestoreReconciliationRequiredResponse(input: {
  paymentId: string;
  intentId?: string | null;
}) {
  return paymentReconciliationRequiredResponse({
    billingMethod: "PIX",
    paymentId: input.paymentId,
    intentId: input.intentId,
    code: "payment_restore_reconciliation_required",
  });
}

function cardAttemptFailureResponse(
  attempt: BillingCardAttemptClaim,
  method: BillingIntentMethod,
) {
  if (billingOrganizationIsUnavailable(attempt)) {
    return billingOrganizationUnavailableResponse(method);
  }
  if (attempt.outcome === "rate_limited") {
    const retryAfter = Math.max(1, Number(attempt.retry_after_seconds || 60));
    return jsonResponse({
      success: false,
      type: method,
      code: "card_attempt_rate_limited",
      error: "Muitas tentativas de cartao. Aguarde antes de tentar novamente.",
    }, 429, { "Retry-After": String(retryAfter) });
  }
  if (attempt.outcome !== "claimed") {
    return jsonResponse({
      success: false,
      type: method,
      code: attempt.outcome || "card_attempt_not_authorized",
      error: "Nao foi possivel autorizar esta tentativa de cartao.",
    }, attempt.outcome === "unauthorized" ? 403 : 409);
  }
  return null;
}

async function suppressAsaasCustomerNotifications(customerId: string) {
  const customer = await asaasRequest<{
    id?: string;
    notificationDisabled?: boolean;
  }>(`/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: JSON.stringify({ notificationDisabled: true }),
  });
  if (
    customer.id !== customerId || customer.notificationDisabled !== true
  ) {
    throw new Error("Asaas customer notifications were not disabled.");
  }
}

async function tokenizeCheckoutCreditCard(input: {
  customerId: string;
  creditCard: NormalizedCard;
  billingDetails: BillingDetails;
  remoteIp: string;
}) {
  const tokenized = await asaasRequest<ProviderCardToken>(
    "/creditCard/tokenizeCreditCard",
    {
      method: "POST",
      body: JSON.stringify({
        customer: input.customerId,
        creditCard: {
          holderName: input.creditCard.holderName || input.billingDetails.name,
          number: input.creditCard.number,
          expiryMonth: input.creditCard.expiryMonth,
          expiryYear: input.creditCard.expiryYear,
          ccv: input.creditCard.ccv,
        },
        creditCardHolderInfo: {
          name: input.creditCard.holderName || input.billingDetails.name,
          email: input.billingDetails.email,
          cpfCnpj: input.creditCard.holderCpfCnpj ||
            input.billingDetails.cpfCnpj,
          postalCode: input.billingDetails.postalCode,
          addressNumber: input.billingDetails.addressNumber,
          addressComplement: input.billingDetails.addressComplement || null,
          phone: input.billingDetails.phone.length === 10
            ? input.billingDetails.phone
            : null,
          mobilePhone: input.billingDetails.phone.length === 11
            ? input.billingDetails.phone
            : null,
        },
        remoteIp: input.remoteIp,
      }),
    },
  );
  const creditCardToken = readText(tokenized.creditCardToken);
  const cardLast4 = onlyDigits(tokenized.creditCardNumber).slice(-4) ||
    input.creditCard.number.slice(-4);
  if (
    creditCardToken.length < 16 || creditCardToken.length > 255 ||
    !/^[A-Za-z0-9_-]+$/.test(creditCardToken) || !/^\d{4}$/.test(cardLast4)
  ) {
    throw new Error("O Asaas nao retornou um token de cartao valido.");
  }
  return { creditCardToken, cardLast4 };
}

async function persistBillingCardRecurrenceCredential(input: {
  paymentId: string;
  providerPaymentId: string;
  attemptLeaseId: string;
  creditCardToken: string;
  remoteIp: string;
  cardLast4: string;
  preserveExisting: boolean;
}) {
  const credentialCiphertext = await sealBillingCardCredential({
    paymentId: input.paymentId,
    providerPaymentId: input.providerPaymentId,
    creditCardToken: input.creditCardToken,
    remoteIp: input.remoteIp,
  });
  const stored = await storeBillingCardRecurrenceCredential({
    paymentId: input.paymentId,
    providerPaymentId: input.providerPaymentId,
    attemptLeaseId: input.attemptLeaseId,
    credentialCiphertext,
    cardLast4: input.cardLast4,
  });
  if (billingOrganizationIsUnavailable(stored)) {
    throw new BillingOrganizationUnavailableError();
  }
  if (!["stored", "already_stored"].includes(stored.outcome || "")) {
    throw new RecurrenceCredentialPersistenceError(
      `Recurrence credential was not stored: ${stored.outcome || "unknown"}`,
      input.preserveExisting,
    );
  }
  return stored;
}

async function persistBillingSubscriptionCardUpdateCredential(input: {
  prepared: { jobId: string; generation: number };
  organizationId: string;
  providerSubscriptionId: string;
  attemptLeaseId?: string | null;
  creditCardToken: string;
  remoteIp: string;
  cardLast4: string;
}) {
  const credentialCiphertext = await sealBillingSubscriptionCardCredential({
    jobId: input.prepared.jobId,
    providerSubscriptionId: input.providerSubscriptionId,
    creditCardToken: input.creditCardToken,
    remoteIp: input.remoteIp,
  });
  const stored = await storeBillingSubscriptionCardUpdateCredential({
    jobId: input.prepared.jobId,
    organizationId: input.organizationId,
    generation: input.prepared.generation,
    attemptLeaseId: input.attemptLeaseId || null,
    credentialCiphertext,
    cardLast4: input.cardLast4,
  });
  if (billingOrganizationIsUnavailable(stored)) {
    throw new BillingOrganizationUnavailableError();
  }
  if (!["stored", "already_stored"].includes(stored.outcome || "")) {
    throw new RecurrenceCredentialPersistenceError(
      `Subscription card credential was not stored: ${stored.outcome || "unknown"}`,
      stored.outcome === "already_exists",
    );
  }
  return stored;
}

async function claimOrganizationCardAttempt(input: {
  record: AuthorizedCheckoutRecord;
  checkoutToken: string | null;
  authorizedUserId: string | null;
  cardClientIp: string;
}) {
  const ipFingerprint = await billingCheckoutIpFingerprint(input.cardClientIp);
  if (input.checkoutToken) {
    return await claimOrganizationCheckoutCardAttempt({
      organizationId: input.record.organization.id,
      checkoutToken: input.checkoutToken,
      ipFingerprint,
    });
  }
  if (input.authorizedUserId) {
    return await claimAuthenticatedOrganizationCardAttempt({
      organizationId: input.record.organization.id,
      actorUserId: input.authorizedUserId,
      ipFingerprint,
    });
  }
  return { outcome: "unauthorized" } satisfies BillingCardAttemptClaim;
}

async function releaseCardAttemptBestEffort(input: {
  paymentId: string;
  providerPaymentId: string;
  leaseId: string;
}) {
  try {
    await releaseBillingPaymentCheckoutAttempt(input);
  } catch (error) {
    console.error("Failed to release billing payment attempt lease.", {
      paymentId: input.paymentId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}

function paymentMutationLeaseResponse(
  attempt: PaymentMutationAttempt,
  billingMethod: BillingIntentMethod,
) {
  if (billingOrganizationIsUnavailable(attempt)) {
    return billingOrganizationUnavailableResponse(billingMethod);
  }
  if (attempt.outcome === "busy") {
    const retryAfter = Math.max(1, Number(attempt.retry_after_seconds || 5));
    return jsonResponse({
      success: true,
      type: billingMethod,
      processing: true,
      status: "RECOVERING",
      code: "payment_attempt_busy",
      message: "Outra tentativa deste pagamento ainda esta em andamento.",
    }, 202, { "Retry-After": String(retryAfter) });
  }
  if (attempt.outcome === "rate_limited") {
    const retryAfter = Math.max(1, Number(attempt.retry_after_seconds || 60));
    return jsonResponse({
      success: false,
      type: billingMethod,
      code: "payment_attempt_rate_limited",
      error: "Muitas tentativas. Aguarde antes de tentar novamente.",
    }, 429, { "Retry-After": String(retryAfter) });
  }
  if (attempt.outcome !== "claimed" || !attempt.lease_id) {
    return jsonResponse({
      success: false,
      type: billingMethod,
      code: attempt.outcome || "payment_not_actionable",
      error: "Este pagamento nao esta disponivel para uma nova tentativa.",
    }, 409);
  }
  return null;
}

async function updateActiveSubscriptionCreditCard(input: {
  record: AuthorizedCheckoutRecord;
  billingDetails: BillingDetails;
  creditCard: NormalizedCard;
  cardClientIp: string;
  idempotencyKey: string;
}) {
  const subscriptionId = readText(
    input.record.organization.asaas_subscription_id,
  );
  const expectedCustomerId = readText(
    input.record.organization.asaas_customer_id,
  );
  const subscription = await requireActiveAsaasSubscription(
    subscriptionId,
    expectedCustomerId,
  );
  const preparation = await prepareBillingSubscriptionCardUpdate({
    jobId: input.idempotencyKey,
    organizationId: input.record.organization.id,
    mode: "saved_only",
  });
  if (billingOrganizationIsUnavailable(preparation)) {
    return billingOrganizationUnavailableResponse("CREDIT_CARD");
  }
  if (
    preparation.outcome === "already_prepared" &&
    preparation.status !== "prepared" && preparation.job_id
  ) {
    return jsonResponse({
      success: true,
      type: "CREDIT_CARD",
      processing: true,
      status: "RECOVERING",
      code: "card_update_queued",
      card_update_job_id: preparation.job_id,
      saved_only: true,
      recurrence_saved: false,
      recurrence_processing: true,
      message: "A atualizacao segura do cartao continua em processamento.",
    }, 202, { "Retry-After": "5" });
  }
  if (
    !["prepared", "already_prepared", "resume_prepared"].includes(
      preparation.outcome || "",
    ) ||
    !preparation.job_id || !preparation.generation
  ) {
    throw new Error("Nao foi possivel preparar a atualizacao do cartao.");
  }
  const prepared = {
    jobId: preparation.job_id,
    generation: Number(preparation.generation),
  };
  const customerId = await prepareAsaasCustomer(
    input.record.organization,
    input.billingDetails,
    input.record.access.canPersistBillingProfile,
  );
  if (customerId !== expectedCustomerId) {
    throw new Error("O cliente da assinatura mudou durante a atualizacao.");
  }
  const tokenized = await tokenizeCheckoutCreditCard({
    customerId,
    creditCard: input.creditCard,
    billingDetails: input.billingDetails,
    remoteIp: input.cardClientIp,
  });
  await persistBillingSubscriptionCardUpdateCredential({
    prepared,
    organizationId: input.record.organization.id,
    providerSubscriptionId: subscription.id,
    creditCardToken: tokenized.creditCardToken,
    remoteIp: input.cardClientIp,
    cardLast4: tokenized.cardLast4,
  });
  return jsonResponse({
    success: true,
    type: "CREDIT_CARD",
    processing: true,
    status: "RECOVERING",
    code: "card_update_queued",
    card_update_job_id: prepared.jobId,
    saved_only: true,
    recurrence_saved: false,
    recurrence_processing: true,
    message: "A atualizacao segura do cartao foi enfileirada.",
  }, 202, { "Retry-After": "5" });
}

async function requireActiveAsaasSubscription(
  subscriptionId: string,
  expectedCustomerId: string,
) {
  if (!subscriptionId || !expectedCustomerId) {
    throw new Error("Assinatura ativa incompleta.");
  }
  const subscription = await asaasRequest<AsaasSubscription>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  if ((subscription.status || "").trim().toUpperCase() !== "ACTIVE") {
    throw new Error("A assinatura do Asaas nao esta ativa.");
  }
  if (subscription.id !== subscriptionId) {
    throw new Error("A assinatura retornada nao corresponde a solicitada.");
  }
  if (
    (subscription.customer || "").trim() !== expectedCustomerId.trim()
  ) {
    throw new Error("A assinatura pertence a outro cliente Asaas.");
  }
  return subscription;
}

function paymentCheckoutIntegrity(
  record: AuthorizedCheckoutRecord,
  payment: AsaasPayment,
  validateMutableFields = true,
) {
  if (record.access.scope !== "payment") return "capability_scope_mismatch";
  return paymentCapabilityCheckoutIntegrity({
    access: record.access,
    payment,
    validateMutableFields,
  });
}

function assertPaymentBelongsToCheckout(
  record: AuthorizedCheckoutRecord,
  payment: AsaasPayment,
) {
  const integrity = paymentCheckoutIntegrity(record, payment);
  if (integrity !== "valid") {
    throw new Error(`Provider payment integrity failure: ${integrity}`);
  }
}

function applyProviderPaymentSnapshot(
  record: AuthorizedCheckoutRecord,
  payment: AsaasPayment,
) {
  if (record.access.scope !== "payment") return;
  record.access.billingType = (payment.billingType || "").trim()
    .toUpperCase() as BillingIntentMethod;
  record.access.paymentStatus = (payment.status || "").trim().toUpperCase();
  record.access.paymentDueDate = payment.dueDate || "";
  record.access.providerSubscriptionId = payment.subscription || null;
}

async function paymentScopedArtifactResponse(input: {
  record: AuthorizedCheckoutRecord;
  payment: AsaasPayment;
  billingMethod: BillingIntentMethod;
}) {
  const access = input.record.access;
  if (access.scope !== "payment") {
    throw new Error("Payment capability is required.");
  }
  if (input.billingMethod === "PIX") {
    let pix: AsaasPixQrCode = {};
    try {
      pix = await asaasRequest<AsaasPixQrCode>(
        `/payments/${encodeURIComponent(input.payment.id)}/pixQrCode`,
      );
    } catch (error) {
      console.warn("Pix artifact will be recovered by payment-status.", {
        paymentId: input.payment.id,
        status: error instanceof AsaasRequestError ? error.status : 500,
      });
    }
    const processing = !pix.encodedImage || !pix.payload;
    return jsonResponse({
      success: true,
      type: "PIX",
      intent_id: access.billingIntentId,
      payment_id: input.payment.id,
      processing,
      status: processing ? "RECOVERING" : input.payment.status || "PENDING",
      invoice_url: safeAsaasPublicUrl(input.payment.invoiceUrl),
      qr_code: pix.encodedImage || "",
      qr_payload: pix.payload || "",
      value: access.paymentAmount,
    }, processing ? 202 : 200, processing ? { "Retry-After": "5" } : {});
  }

  const invoiceUrl = safeAsaasPublicUrl(input.payment.invoiceUrl);
  const bankSlipUrl = safeAsaasPublicUrl(input.payment.bankSlipUrl);
  const identification = await getBoletoIdentification(input.payment.id);
  const processing = !invoiceUrl && !bankSlipUrl;
  return jsonResponse({
    success: true,
    type: "BOLETO",
    intent_id: access.billingIntentId,
    payment_id: input.payment.id,
    processing,
    status: processing ? "RECOVERING" : input.payment.status || "PENDING",
    invoice_url: invoiceUrl || bankSlipUrl,
    bank_slip_url: bankSlipUrl || invoiceUrl,
    identification_field: onlyDigits(identification?.identificationField || ""),
    bar_code: onlyDigits(identification?.barCode || ""),
    due_date: input.payment.dueDate || null,
    value: access.paymentAmount,
  }, processing ? 202 : 200, processing ? { "Retry-After": "5" } : {});
}

async function reconcilePaymentMethodChangeFromLocalSnapshot(
  record: AuthorizedCheckoutRecord,
  payment: AsaasPayment,
  observedAt: Date,
) {
  return await reconcilePaymentCapabilityMethodChange({
    record,
    payment,
    observedAt,
  });
}

async function claimBillingPaymentRestore(input: {
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
  return (data || { outcome: "invalid_input" }) as PaymentRestoreClaim;
}

async function restoreDeletedPixPayment(input: {
  record: AuthorizedCheckoutRecord;
  payment: AsaasPayment;
  checkoutToken: string;
}) {
  const access = input.record.access;
  if (access.scope !== "payment") {
    return { response: jsonResponse({ error: "Checkout invalido." }, 409) };
  }
  const claim = await claimBillingPaymentRestore({
    paymentId: access.paymentId,
    checkoutToken: input.checkoutToken,
  }) as PaymentRestoreClaim;
  if (billingOrganizationIsUnavailable(claim)) {
    return { response: billingOrganizationUnavailableResponse("PIX") };
  }
  if (
    claim.provider_payment_id &&
    claim.provider_payment_id !== input.payment.id
  ) {
    return {
      response: paymentRestoreReconciliationRequiredResponse({
        paymentId: input.payment.id,
        intentId: access.billingIntentId,
      }),
    };
  }
  if (!["claimed", "recover_only"].includes(claim.outcome)) {
    return {
      response: paymentRestoreReconciliationRequiredResponse({
        paymentId: input.payment.id,
        intentId: access.billingIntentId,
      }),
    };
  }

  if (claim.outcome === "claimed") {
    try {
      await asaasRequest<Record<string, unknown>>(
        `/payments/${encodeURIComponent(input.payment.id)}/restore`,
        { method: "POST" },
      );
    } catch (restoreError) {
      const deterministic = restoreError instanceof AsaasRequestError &&
        providerFailureIsDeterministic(restoreError.status);
      console.error("Asaas Pix restore requires reconciliation.", {
        paymentId: input.payment.id,
        deterministic,
        status: restoreError instanceof AsaasRequestError
          ? restoreError.status
          : 500,
      });
      return {
        response: paymentRestoreReconciliationRequiredResponse({
          paymentId: input.payment.id,
          intentId: access.billingIntentId,
        }),
      };
    }
  }

  let restoredPayment: AsaasPayment;
  try {
    const restoredPaymentObservedAt = new Date();
    restoredPayment = await asaasRequest<AsaasPayment>(
      `/payments/${encodeURIComponent(input.payment.id)}`,
    );
    const refreshedIntegrity = paymentCheckoutIntegrity(
      input.record,
      restoredPayment,
      false,
    );
    if (refreshedIntegrity !== "valid") {
      return {
        response: paymentRestoreReconciliationRequiredResponse({
          paymentId: input.payment.id,
          intentId: access.billingIntentId,
        }),
      };
    }
    const changed = await reconcileChangedPaymentSnapshot(
      input.record,
      input.payment,
      restoredPayment,
      restoredPaymentObservedAt,
    );
    if (!["updated", "already_updated"].includes(changed.outcome || "")) {
      return {
        response: paymentRestoreReconciliationRequiredResponse({
          paymentId: input.payment.id,
          intentId: access.billingIntentId,
        }),
      };
    }
  } catch {
    return {
      response: paymentRestoreReconciliationRequiredResponse({
        paymentId: input.payment.id,
        intentId: access.billingIntentId,
      }),
    };
  }
  return { payment: restoredPayment };
}

async function reconcileChangedPaymentSnapshot(
  record: AuthorizedCheckoutRecord,
  previousPayment: AsaasPayment,
  payment: AsaasPayment,
  observedAt: Date,
) {
  if (record.access.scope !== "payment") {
    return { outcome: "capability_scope_mismatch" };
  }
  if (payment.id !== previousPayment.id) {
    return { outcome: "payment_mismatch" };
  }
  const changed = await reconcilePaymentMethodChangeFromLocalSnapshot(
    record,
    payment,
    observedAt,
  );
  if (["updated", "already_updated"].includes(changed.outcome || "")) {
    applyProviderPaymentSnapshot(record, payment);
  }
  return changed;
}

async function paymentScopedCheckoutResponse(input: {
  record: AuthorizedCheckoutRecord;
  billingMethod: BillingIntentMethod;
  billingDetails: BillingDetails;
  creditCard: NormalizedCard | null;
  cardClientIp: string | null;
  idempotencyKey: string | null;
  checkoutToken: string;
}) {
  const access = input.record.access;
  if (access.scope !== "payment") {
    return jsonResponse({ error: "Checkout de pagamento invalido." }, 409);
  }
  if (
    input.billingMethod === "CREDIT_CARD" &&
    (!input.creditCard || !input.cardClientIp || !input.idempotencyKey)
  ) {
    return jsonResponse({
      success: false,
      code: "invalid_card_input",
      error: "Informe os dados do cartao para continuar.",
    }, 400);
  }

  let paymentCardGuard: BillingCardAttemptClaim | null = null;
  if (input.billingMethod === "CREDIT_CARD") {
    paymentCardGuard = await claimBillingPaymentCardAttemptGuard({
      paymentId: access.paymentId,
      providerPaymentId: access.providerPaymentId,
      ipFingerprint: await billingCheckoutIpFingerprint(input.cardClientIp),
    });
    const guardResponse = cardAttemptFailureResponse(
      paymentCardGuard,
      input.billingMethod,
    );
    if (guardResponse) return guardResponse;
  }

  const paymentObservedAt = new Date();
  let payment = await asaasRequest<AsaasPayment>(
    `/payments/${encodeURIComponent(access.providerPaymentId)}`,
  );
  const providerBillingType = (payment.billingType || "").trim()
    .toUpperCase();
  if (
    providerBillingType === input.billingMethod &&
    providerBillingType !== access.billingType
  ) {
    const recovered = await reconcilePaymentMethodChangeFromLocalSnapshot(
      input.record,
      payment,
      paymentObservedAt,
    );
    if (!["updated", "already_updated"].includes(recovered.outcome || "")) {
      return paymentReconciliationRequiredResponse({
        billingMethod: input.billingMethod,
        paymentId: payment.id,
        intentId: access.billingIntentId,
      });
    }
    applyProviderPaymentSnapshot(input.record, payment);
  }

  if (payment.deleted !== true) {
    assertPaymentBelongsToCheckout(
    input.record,
    payment,
    );
  }

  const initialIntegrity = paymentCheckoutIntegrity(input.record, payment);
  if (initialIntegrity === "deleted" && input.billingMethod === "PIX") {
    const restored = await restoreDeletedPixPayment({
      record: input.record,
      payment,
      checkoutToken: input.checkoutToken,
    });
    if (restored.response) return restored.response;
    if (!restored.payment) {
      return paymentRestoreReconciliationRequiredResponse({
        paymentId: payment.id,
        intentId: access.billingIntentId,
      });
    }
    payment = restored.payment;
  } else if (initialIntegrity !== "valid") {
    return jsonResponse({
      success: false,
      code: "payment_integrity_failed",
      error: "A cobranca nao corresponde a este checkout.",
    }, 409);
  }

  const normalizedStatus = (payment.status || "").trim().toUpperCase();
  if (isPaidStatus(normalizedStatus)) {
    if (input.billingMethod !== "CREDIT_CARD") {
      await reconcileBillingCheckoutPaidPayment(payment, paymentObservedAt);
      return jsonResponse({
        success: true,
        type: input.billingMethod,
        payment_id: payment.id,
        state: "settled",
        status: normalizedStatus,
        message: "Pagamento confirmado.",
      });
    }
    const prepared = await prepareBillingCardRecurrence({
      paymentId: access.paymentId,
      providerPaymentId: payment.id,
    });
    if (billingOrganizationIsUnavailable(prepared)) {
      return billingOrganizationUnavailableResponse("CREDIT_CARD");
    }
    if (prepared.credential_stored === true) {
      return paymentReconciliationRequiredResponse({
        billingMethod: "CREDIT_CARD",
        paymentId: payment.id,
        intentId: access.billingIntentId,
        code: "recurrence_processing",
      });
    }
    return jsonResponse({
      success: false,
      type: "CREDIT_CARD",
      code: "paid_card_update_requires_authentication",
      error:
        "O pagamento ja foi confirmado. Entre como authenticated billing administrator para cadastrar um novo cartao.",
    }, 409);
  }

  if (!asaasPaymentCanReceiveCheckoutAttempt(normalizedStatus)) {
    const disposition = asaasPaymentDisposition(normalizedStatus);
    if (disposition === "cancelled") {
      return jsonResponse({
        success: false,
        type: input.billingMethod,
        code: "payment_cancelled",
        error: "Esta cobranca foi cancelada.",
      }, 409);
    }
    return jsonResponse({
      success: false,
      type: input.billingMethod,
      code: "payment_requires_assistance",
      error: "Esta cobranca precisa de verificacao antes de continuar.",
    }, 409);
  }

  const customerId = access.providerCustomerId;
  await suppressAsaasCustomerNotifications(customerId);

  if (input.billingMethod === "PIX") {
    const mutationAttempt = await claimBillingPaymentCheckoutAttempt({
      paymentId: access.paymentId,
      providerPaymentId: payment.id,
    });
    const mutationLeaseResponse = paymentMutationLeaseResponse(
      mutationAttempt,
      input.billingMethod,
    );
    if (mutationLeaseResponse) return mutationLeaseResponse;
    let releaseMutationLease = true;
    try {
      const methodChangeObservedAt = new Date();
      const changedPayment = await asaasRequest<AsaasPayment>(
        `/payments/${encodeURIComponent(payment.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            billingType: "PIX",
            dueDate: isoDateFromNow(1),
          }),
        },
      );
      const reconciliation = await reconcileChangedPaymentSnapshot(
        input.record,
        payment,
        changedPayment,
        methodChangeObservedAt,
      );
      releaseMutationLease = false;
      if (!["updated", "already_updated"].includes(reconciliation.outcome || "")) {
        return paymentReconciliationRequiredResponse({
          billingMethod: "PIX",
          paymentId: payment.id,
          intentId: access.billingIntentId,
        });
      }
      assertPaymentBelongsToCheckout(input.record, changedPayment);
      let pix: AsaasPixQrCode = {};
      try {
        pix = await asaasRequest<AsaasPixQrCode>(
          `/payments/${encodeURIComponent(changedPayment.id)}/pixQrCode`,
        );
      } catch {
        // The immutable payment id is returned so payment-status can recover it.
      }
      const processing = !pix.encodedImage || !pix.payload;
      return jsonResponse({
        success: true,
        type: "PIX",
        intent_id: access.billingIntentId,
        payment_id: changedPayment.id,
        processing,
        status: processing
          ? "RECOVERING"
          : changedPayment.status || "PENDING",
        invoice_url: safeAsaasPublicUrl(changedPayment.invoiceUrl),
        qr_code: pix.encodedImage || "",
        qr_payload: pix.payload || "",
        value: access.paymentAmount,
      }, processing ? 202 : 200, processing ? { "Retry-After": "5" } : {});
    } catch (error) {
      releaseMutationLease = error instanceof AsaasRequestError &&
        providerFailureIsDeterministic(error.status);
      throw error;
    } finally {
      if (releaseMutationLease) {
        await releaseCardAttemptBestEffort({
          paymentId: access.paymentId,
          providerPaymentId: payment.id,
          leaseId: mutationAttempt.lease_id!,
        });
      }
    }
  }

  if (input.billingMethod === "BOLETO") {
    const mutationAttempt = await claimBillingPaymentCheckoutAttempt({
      paymentId: access.paymentId,
      providerPaymentId: payment.id,
    });
    const mutationLeaseResponse = paymentMutationLeaseResponse(
      mutationAttempt,
      input.billingMethod,
    );
    if (mutationLeaseResponse) return mutationLeaseResponse;
    let releaseMutationLease = true;
    try {
      const methodChangeObservedAt = new Date();
      const changedPayment = await asaasRequest<AsaasPayment>(
        `/payments/${encodeURIComponent(payment.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            billingType: "BOLETO",
            dueDate: isoDateFromNow(3),
          }),
        },
      );
      const reconciliation = await reconcileChangedPaymentSnapshot(
        input.record,
        payment,
        changedPayment,
        methodChangeObservedAt,
      );
      releaseMutationLease = false;
      if (!["updated", "already_updated"].includes(reconciliation.outcome || "")) {
        return paymentReconciliationRequiredResponse({
          billingMethod: "BOLETO",
          paymentId: payment.id,
          intentId: access.billingIntentId,
        });
      }
      assertPaymentBelongsToCheckout(input.record, changedPayment);
      return await paymentScopedArtifactResponse({
        record: input.record,
        payment: changedPayment,
        billingMethod: "BOLETO",
      });
    } catch (error) {
      releaseMutationLease = error instanceof AsaasRequestError &&
        providerFailureIsDeterministic(error.status);
      throw error;
    } finally {
      if (releaseMutationLease) {
        await releaseCardAttemptBestEffort({
          paymentId: access.paymentId,
          providerPaymentId: payment.id,
          leaseId: mutationAttempt.lease_id!,
        });
      }
    }
  }

  const paymentId = access.paymentId;
  const existingSubscriptionId = payment.subscription ||
    access.providerSubscriptionId;
  const attempt = await claimBillingPaymentCheckoutAttempt({
    paymentId,
    providerPaymentId: payment.id,
  });
  if (billingOrganizationIsUnavailable(attempt)) {
    return billingOrganizationUnavailableResponse("CREDIT_CARD");
  }
  if (attempt.outcome === "busy") {
    return paymentMutationLeaseResponse(attempt, "CREDIT_CARD");
  }
  const attemptResponse = paymentMutationLeaseResponse(
    attempt,
    "CREDIT_CARD",
  );
  if (attemptResponse) return attemptResponse;

  let providerPaymentAttempted = false;
  let releasePaymentLease = true;
  let preparedSubscriptionCardUpdate: {
    jobId: string;
    generation: number;
  } | null = null;
  let recurrenceCredentialStored = false;
  try {
    const recurrence = { processing: true, code: "recurrence_processing" };
    if (existingSubscriptionId) {
      const preparation = await prepareBillingSubscriptionCardUpdate({
        jobId: input.idempotencyKey!,
        organizationId: input.record.organization.id,
        mode: "settled_payment",
        paymentId,
        providerPaymentId: payment.id,
      });
      if (billingOrganizationIsUnavailable(preparation)) {
        throw new BillingOrganizationUnavailableError();
      }
      if (
        preparation.outcome === "already_prepared" &&
        preparation.status !== "prepared"
      ) {
        releasePaymentLease = false;
        return paymentReconciliationRequiredResponse({
          billingMethod: "CREDIT_CARD",
          paymentId: payment.id,
          intentId: access.billingIntentId,
          cardUpdateJobId: preparation.job_id,
          code: "card_update_queued",
        });
      }
      if (
        !["prepared", "already_prepared", "resume_prepared"].includes(
          preparation.outcome || "",
        ) || !preparation.job_id || !preparation.generation
      ) {
        throw new Error(
          `Subscription card update was not prepared: ${preparation.outcome}`,
        );
      }
      preparedSubscriptionCardUpdate = {
        jobId: preparation.job_id,
        generation: Number(preparation.generation),
      };
    } else {
      const prepared = await prepareBillingCardRecurrence({
        paymentId,
        providerPaymentId: payment.id,
      });
      if (billingOrganizationIsUnavailable(prepared)) {
        throw new BillingOrganizationUnavailableError();
      }
      recurrenceCredentialStored = prepared.credential_stored === true;
      if (recurrenceCredentialStored) {
        releasePaymentLease = false;
        return paymentReconciliationRequiredResponse({
          billingMethod: "CREDIT_CARD",
          paymentId: payment.id,
          intentId: access.billingIntentId,
          code: "payment_reconciliation_required",
        });
      }
      if (!["prepared", "already_prepared"].includes(prepared.outcome || "")) {
        throw new Error(
          `Card recurrence was not prepared: ${prepared.outcome}`,
        );
      }
    }

    const tokenized = await tokenizeCheckoutCreditCard({
      customerId,
      creditCard: input.creditCard!,
      billingDetails: input.billingDetails,
      remoteIp: input.cardClientIp!,
    });
    if (preparedSubscriptionCardUpdate && existingSubscriptionId) {
      await persistBillingSubscriptionCardUpdateCredential({
        prepared: preparedSubscriptionCardUpdate,
        organizationId: input.record.organization.id,
        providerSubscriptionId: existingSubscriptionId,
        attemptLeaseId: attempt.lease_id!,
        creditCardToken: tokenized.creditCardToken,
        remoteIp: input.cardClientIp!,
        cardLast4: tokenized.cardLast4,
      });
      const captureMarker = await markBillingSubscriptionCardUpdateCaptureStarted({
        jobId: preparedSubscriptionCardUpdate.jobId,
        organizationId: input.record.organization.id,
        generation: preparedSubscriptionCardUpdate.generation,
        attemptLeaseId: attempt.lease_id!,
      });
      if (billingOrganizationIsUnavailable(captureMarker)) {
        throw new BillingOrganizationUnavailableError();
      }
      if (captureMarker.outcome !== "proceed") {
        releasePaymentLease = false;
        return paymentReconciliationRequiredResponse({
          billingMethod: "CREDIT_CARD",
          paymentId: payment.id,
          intentId: access.billingIntentId,
          cardUpdateJobId: preparedSubscriptionCardUpdate.jobId,
        });
      }
    } else {
      await persistBillingCardRecurrenceCredential({
        paymentId,
        providerPaymentId: payment.id,
        attemptLeaseId: attempt.lease_id!,
        creditCardToken: tokenized.creditCardToken,
        remoteIp: input.cardClientIp!,
        cardLast4: tokenized.cardLast4,
        preserveExisting: recurrenceCredentialStored,
      });
      const captureMarker = await markBillingCardCaptureRequestStarted({
        paymentId,
        providerPaymentId: payment.id,
        attemptLeaseId: attempt.lease_id!,
      });
      if (billingOrganizationIsUnavailable(captureMarker)) {
        throw new BillingOrganizationUnavailableError();
      }
      if (captureMarker.outcome !== "proceed") {
        releasePaymentLease = false;
        return paymentReconciliationRequiredResponse({
          billingMethod: "CREDIT_CARD",
          paymentId: payment.id,
          intentId: access.billingIntentId,
        });
      }
    }

    const cardPaymentObservedAt = new Date();
    let paidPayment: AsaasPayment;
    try {
      providerPaymentAttempted = true;
      paidPayment = await asaasRequest<AsaasPayment>(
        `/payments/${encodeURIComponent(payment.id)}/payWithCreditCard`,
        {
          method: "POST",
          body: JSON.stringify({
            creditCardToken: tokenized.creditCardToken,
            remoteIp: input.cardClientIp,
          }),
        },
      );
    } catch (error) {
      if (
        error instanceof AsaasRequestError &&
        (error.status === 400 || error.status === 422)
      ) {
        throw new CardProviderRejectionError(error.message, error.status);
      }
      throw error;
    }

    try {
      assertPaymentBelongsToCheckout(input.record, paidPayment);
    } catch {
      const reconciliation = await reconcileChangedPaymentSnapshot(
        input.record,
        payment,
        paidPayment,
        cardPaymentObservedAt,
      );
      releasePaymentLease = false;
      return paymentReconciliationRequiredResponse({
        billingMethod: "CREDIT_CARD",
        paymentId: payment.id,
        intentId: access.billingIntentId,
        cardUpdateJobId: preparedSubscriptionCardUpdate?.jobId,
        code: reconciliation.outcome === "updated"
          ? "payment_reconciliation_required"
          : "payment_reconciliation_unavailable",
      });
    }

    const paymentDisposition = asaasPaymentDisposition(paidPayment.status);
    if (
      paymentDisposition === "retryable" ||
      paymentDisposition === "cancelled"
    ) {
      if (preparedSubscriptionCardUpdate) {
        try {
          const refusal = await failBillingSubscriptionCardUpdateCapture({
            jobId: preparedSubscriptionCardUpdate.jobId,
            organizationId: input.record.organization.id,
            generation: preparedSubscriptionCardUpdate.generation,
            attemptLeaseId: attempt.lease_id!,
            errorCode: paymentDisposition === "retryable"
              ? "provider_card_refused"
              : "provider_payment_cancelled",
          });
          const refusalFinalized = refusal.outcome === "capture_refused" ||
            refusal.outcome === "already_finalized" ||
            refusal.status === "cancelled";
          if (
            refusal.outcome !== "capture_refused" &&
            refusal.outcome !== "already_finalized" &&
            refusal.status !== "cancelled"
          ) {
            throw new Error("Card refusal could not be fenced exactly.");
          }
          if (!refusalFinalized) {
            throw new Error("Card refusal was not finalized.");
          }
        } catch (error) {
          releasePaymentLease = false;
          console.error("Card refusal fence requires reconciliation.", {
            paymentId: payment.id,
            reason: error instanceof Error ? error.message : "unknown_error",
          });
          return paymentReconciliationRequiredResponse({
            billingMethod: "CREDIT_CARD",
            paymentId: payment.id,
            intentId: access.billingIntentId,
            cardUpdateJobId: preparedSubscriptionCardUpdate.jobId,
          });
        }
      } else {
        await failPreparedBillingCardRecurrence({
          paymentId,
          providerPaymentId: payment.id,
        });
      }
      return jsonResponse({
        success: false,
        type: "CREDIT_CARD",
        payment_id: payment.id,
        state: paymentDisposition === "retryable" ? "retry" : "cancelled",
        code: paymentDisposition === "retryable"
          ? "card_not_authorized"
          : "payment_cancelled",
        error: paymentDisposition === "retryable"
          ? "O cartao nao autorizou a cobranca. Confira os dados ou tente outro cartao."
          : "A cobranca foi cancelada.",
      }, 422);
    }
    if (
      paymentDisposition === "assisted" || paymentDisposition === "unknown"
    ) {
      releasePaymentLease = false;
      return paymentReconciliationRequiredResponse({
        billingMethod: "CREDIT_CARD",
        paymentId: payment.id,
        intentId: access.billingIntentId,
        cardUpdateJobId: preparedSubscriptionCardUpdate?.jobId,
      });
    }

    const paymentSettled = paymentDisposition === "settled";
    if (!paymentSettled) {
      releasePaymentLease = false;
    }
    const subscriptionId = paidPayment.subscription || existingSubscriptionId;
    if (paymentSettled) {
      await reconcileBillingCheckoutPaidPayment(
        paidPayment,
        cardPaymentObservedAt,
      );
    }
    return jsonResponse({
      success: true,
      type: "CREDIT_CARD",
      payment_id: paidPayment.id,
      subscription_id: subscriptionId || null,
      processing: true,
      status: paymentSettled ? "RECOVERING" : paidPayment.status || "PROCESSING",
      code: preparedSubscriptionCardUpdate
        ? paymentSettled
          ? "card_update_queued"
          : "card_update_waiting_for_payment"
        : recurrence.code,
      card_update_job_id: preparedSubscriptionCardUpdate?.jobId || null,
      recurrence_saved: false,
      recurrence_processing: recurrence.processing,
      message: paymentSettled
        ? "Pagamento confirmado. O cartao recorrente esta sendo configurado."
        : "O pagamento com cartao ainda esta sendo confirmado.",
    }, 202, { "Retry-After": "5" });
  } catch (error) {
    if (error instanceof BillingOrganizationUnavailableError) {
      return billingOrganizationUnavailableResponse("CREDIT_CARD");
    }
    const deterministicRejection = error instanceof CardProviderRejectionError;
    const preserveExistingCredential =
      error instanceof RecurrenceCredentialPersistenceError &&
      error.preserveExisting;
    if (
      !existingSubscriptionId &&
      !preserveExistingCredential &&
      (!providerPaymentAttempted || deterministicRejection)
    ) {
      await failPreparedBillingCardRecurrence({
        paymentId,
        providerPaymentId: payment.id,
      }).catch(() => undefined);
    }
    if (preparedSubscriptionCardUpdate && deterministicRejection) {
      const refusal = await failBillingSubscriptionCardUpdateCapture({
        jobId: preparedSubscriptionCardUpdate.jobId,
        organizationId: input.record.organization.id,
        generation: preparedSubscriptionCardUpdate.generation,
        attemptLeaseId: attempt.lease_id!,
        errorCode: "provider_card_refused",
      }).catch(() => null);
      const refusalFinalized = refusal?.outcome === "capture_refused" ||
        refusal?.outcome === "already_finalized" ||
        refusal?.status === "cancelled";
      if (!refusalFinalized) {
        releasePaymentLease = false;
      }
    }
    if (
      preserveExistingCredential ||
      (providerPaymentAttempted && !deterministicRejection)
    ) {
      releasePaymentLease = false;
      return paymentReconciliationRequiredResponse({
        billingMethod: "CREDIT_CARD",
        paymentId: payment.id,
        intentId: access.billingIntentId,
        cardUpdateJobId: preparedSubscriptionCardUpdate?.jobId,
        code: "payment_reconciliation_required",
      });
    }
    throw error;
  } finally {
    if (releasePaymentLease) {
      await releaseCardAttemptBestEffort({
        paymentId,
        providerPaymentId: payment.id,
        leaseId: attempt.lease_id!,
      });
    }
  }
}

async function prepareAsaasCustomer(
  organization: CheckoutOrganization,
  billingDetails: BillingDetails,
  persistBillingProfile: boolean,
) {
  const customerId = await ensureAsaasCustomer({
    organization,
    updateExistingProfile: persistBillingProfile,
    holderName: billingDetails.name,
    holderEmail: billingDetails.email,
    holderCpfCnpj: billingDetails.cpfCnpj,
    holderPhone: billingDetails.phone,
    holderPostalCode: billingDetails.postalCode,
    holderAddress: billingDetails.address,
    holderAddressNumber: billingDetails.addressNumber,
    holderAddressComplement: billingDetails.addressComplement,
    holderNeighborhood: billingDetails.neighborhood,
  });

  if (persistBillingProfile) {
    await saveOrganizationBillingProfile({
      organizationId: organization.id,
      ...billingDetails,
    });
  }

  return customerId;
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  let reservedIntentId: string | null = null;
  let providerRequestStarted = false;
  let requestedBillingMethod: BillingIntentMethod | null = null;

  try {
    if (request.method !== "POST") {
      return jsonResponse(
        { success: false, error: "Metodo nao permitido." },
        405,
      );
    }

    const trustedClientIpPromise = trustedBillingCheckoutClientIp(request);
    const body = (await request.json()) as ChargeRequest;
    if (
      body.billing_type !== "PIX" && body.billing_type !== "BOLETO" &&
      body.billing_type !== "CREDIT_CARD"
    ) {
      return jsonResponse({
        success: false,
        error: "Forma de pagamento invalida.",
      }, 400);
    }
    requestedBillingMethod = body.billing_type;
    const billingPeriodMonths = normalizeBillingPeriodMonths(
      body.billing_period_months,
    );
    if (billingPeriodMonths === null) {
      return jsonResponse({
        success: false,
        error: "Periodo de cobranca invalido. Escolha 1, 6 ou 12 meses.",
      }, 400);
    }
    const cardInputProvided = body.card !== undefined;
    if (cardInputProvided && body.billing_type !== "CREDIT_CARD") {
      return jsonResponse({
        success: false,
        error: "Dados de cartao so podem ser enviados no pagamento com cartao.",
      }, 400);
    }
    const creditCard = cardInputProvided
      ? normalizeCheckoutCreditCard(body.card)
      : null;
    if (body.billing_type === "CREDIT_CARD" && !creditCard) {
      return jsonResponse({
        success: false,
        error: "Confira o numero, a validade e o codigo de seguranca do cartao.",
      }, 400);
    }
    if (
      creditCard?.holderCpfCnpj &&
      !isValidBrazilianTaxId(creditCard.holderCpfCnpj)
    ) {
      return jsonResponse({
        success: false,
        error: "Informe um CPF ou CNPJ valido para o titular do cartao.",
      }, 400);
    }
    const cardClientIp = creditCard
      ? normalizeCheckoutClientIp(await trustedClientIpPromise)
      : null;
    if (creditCard && !cardClientIp) {
      return jsonResponse({
        success: false,
        error:
          "Nao foi possivel validar a origem segura do pagamento. Atualize a pagina e tente novamente.",
      }, 400);
    }
    const idempotencyKey = readText(body.idempotency_key) || null;
    if (
      body.billing_type === "CREDIT_CARD" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(idempotencyKey || "")
    ) {
      return jsonResponse({
        success: false,
        error: "Identificador idempotente do cartao invalido.",
      }, 400);
    }
    const expectedPlanId = readText(body.expected_plan_id) || null;
    const expectedMonthlyPrice =
      typeof body.expected_monthly_price === "number" &&
        Number.isFinite(body.expected_monthly_price) &&
        body.expected_monthly_price > 0
        ? body.expected_monthly_price
        : null;
    if (
      body.expected_plan_id !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(
          expectedPlanId || "",
        )
    ) {
      return jsonResponse({
        success: false,
        error: "Referencia do plano invalida.",
      }, 400);
    }
    if (
      body.expected_monthly_price !== undefined && expectedMonthlyPrice === null
    ) {
      return jsonResponse({
        success: false,
        error: "Valor esperado do plano invalido.",
      }, 400);
    }

    const checkoutToken = readText(body.checkout_token) || null;
    const organizationId = readText(body.organization_id) || null;
    if (checkoutToken && organizationId) {
      return jsonResponse({
        success: false,
        code: "ambiguous_checkout_identity",
        error: "Informe somente uma identidade de checkout.",
      }, 400);
    }
    const record = await getAuthorizedCheckoutRecord(request, {
      token: checkoutToken,
      organizationId,
    });
    if (!record) {
      return jsonResponse(
        { success: false, error: "Checkout nao encontrado." },
        404,
      );
    }

    const billingDetails = checkoutBillingDetails(body, record);
    if (!billingDetails) {
      return jsonResponse(
        {
          success: false,
          error:
            "Confira os dados de faturamento antes de continuar para o pagamento.",
        },
        400,
      );
    }

    if (record.access.scope === "payment") {
      if (
        billingPeriodMonths !== record.access.billingPeriodMonths ||
        (expectedPlanId && expectedPlanId !== record.access.planId) ||
        (expectedMonthlyPrice !== null &&
          Math.abs(
              expectedMonthlyPrice * billingPeriodMonths -
                record.access.paymentAmount,
            ) > 0.01)
      ) {
        return jsonResponse({
          success: false,
          code: "payment_quote_mismatch",
          error: "Os dados deste pagamento mudaram. Atualize a pagina.",
        }, 409);
      }
      return await paymentScopedCheckoutResponse({
        record,
        billingMethod: body.billing_type,
        billingDetails,
        creditCard,
        cardClientIp,
        idempotencyKey,
        checkoutToken: record.access.checkoutToken,
      });
    }

    let cardAttempt: BillingCardAttemptClaim | null = null;
    if (body.billing_type === "CREDIT_CARD") {
      cardAttempt = await claimOrganizationCardAttempt({
        record,
        checkoutToken,
        authorizedUserId: record.access.authorizedUserId,
        cardClientIp: cardClientIp!,
      });
      const cardAttemptResponse = cardAttemptFailureResponse(
        cardAttempt,
        body.billing_type,
      );
      if (cardAttemptResponse) return cardAttemptResponse;

      if (
        record.access.authorizedUserId &&
        record.organization.asaas_subscription_id &&
        record.organization.asaas_customer_id &&
        (record.organization.subscription_status || "").trim().toLowerCase() ===
          "active"
      ) {
        return await updateActiveSubscriptionCreditCard({
          record,
          billingDetails,
          creditCard: creditCard!,
          cardClientIp: cardClientIp!,
          idempotencyKey: idempotencyKey!,
        });
      }
    }

    const intent = await reserveBillingCheckoutIntent(
      record.organization.id,
      body.billing_type,
      billingPeriodMonths,
      expectedPlanId,
      expectedMonthlyPrice,
    );
    reservedIntentId = intent.intent_id || null;

    if (
      intent.outcome === "active_intent_conflict" ||
      intent.outcome === "already_active" ||
      intent.outcome === "plan_not_staged" ||
      intent.outcome === "invalid_plan" ||
      intent.outcome === "organization_not_found" ||
      intent.outcome === "quote_changed"
    ) {
      return checkoutUnavailable(intent);
    }

    if (intent.outcome === "in_progress") {
      return jsonResponse(
        {
          success: true,
          type: body.billing_type,
          intent_id: intent.intent_id,
          processing: true,
          status: "CREATING",
          message: "A cobranca esta sendo criada. Aguarde alguns instantes.",
        },
        202,
      );
    }

    if (
      !intent.intent_id ||
      !intent.external_reference ||
      !intent.amount ||
      !isBillingPeriodMonths(intent.billing_period_months)
    ) {
      throw new Error("Intent de cobranca incompleto.");
    }

    if (intent.outcome === "reuse") {
      if (
        (body.billing_type === "PIX" || body.billing_type === "BOLETO") &&
        intent.provider_payment_id
      ) {
        const payment = await asaasRequest<AsaasPayment>(
          `/payments/${intent.provider_payment_id}`,
        );
        const directPaymentInput = {
          organizationId: record.organization.id,
          intent,
          payment,
          customerId: payment.customer ||
            intent.provider_customer_id ||
            record.organization.asaas_customer_id ||
            "",
          reused: true,
        };
        return body.billing_type === "PIX"
          ? pixCheckoutResponse(directPaymentInput)
          : boletoCheckoutResponse(directPaymentInput);
      }

      if (body.billing_type === "CREDIT_CARD") {
        if (intent.provider_subscription_id) {
          const subscription = await asaasRequest<AsaasSubscription>(
            `/subscriptions/${encodeURIComponent(intent.provider_subscription_id)}`,
          );
          return cardSubscriptionResponse({
            intent,
            subscription,
            reused: true,
            cardLast4: savedCardLast4(intent),
          });
        }
        const checkout = savedHostedCheckout(intent);
        if (checkout) {
          return hostedCheckoutResponse({ intent, checkout, reused: true });
        }
        if (intent.provider_checkout_id) {
          const recoveredCheckout = await recoverHostedCheckout(
            intent.provider_checkout_id,
          );
          validateHostedCheckout(recoveredCheckout);
          await registerBillingHostedCheckout({
            intentId: intent.intent_id,
            checkout: recoveredCheckout,
          });
          return hostedCheckoutResponse({
            intent,
            checkout: recoveredCheckout,
            reused: true,
          });
        }
        return jsonResponse({
          success: true,
          type: body.billing_type,
          intent_id: intent.intent_id,
          processing: true,
          status: "RECOVERING",
          message:
            "O checkout anterior ainda esta sendo conciliado e nao sera duplicado.",
        }, 202);
      }

      throw new Error("Checkout ativo sem recurso do provedor.");
    }

    if (intent.outcome === "recover") {
      if (body.billing_type === "CREDIT_CARD") {
        if (intent.provider_subscription_id) {
          const subscription = await asaasRequest<AsaasSubscription>(
            `/subscriptions/${encodeURIComponent(intent.provider_subscription_id)}`,
          );
          return cardSubscriptionResponse({
            intent,
            subscription,
            reused: true,
            cardLast4: savedCardLast4(intent),
          });
        }
        const checkout = savedHostedCheckout(intent);
        if (checkout) {
          return hostedCheckoutResponse({ intent, checkout, reused: true });
        }
        if (intent.provider_checkout_id) {
          const recoveredCheckout = await recoverHostedCheckout(
            intent.provider_checkout_id,
          );
          validateHostedCheckout(recoveredCheckout);
          await registerBillingHostedCheckout({
            intentId: intent.intent_id,
            checkout: recoveredCheckout,
          });
          return hostedCheckoutResponse({
            intent,
            checkout: recoveredCheckout,
            reused: true,
          });
        }

        const recovered = await recoverBillingProviderResource(
          "CREDIT_CARD",
          intent.external_reference,
        ) as AsaasSubscription | null;
        if (recovered?.id) {
          const customerId = recovered.customer ||
            intent.provider_customer_id ||
            record.organization.asaas_customer_id ||
            "";
          if (!customerId) {
            throw new Error("Assinatura recuperada sem cliente Asaas.");
          }
          await registerBillingCheckoutProvider({
            intentId: intent.intent_id,
            customerId,
            subscriptionId: recovered.id,
            providerResponse: cardSubscriptionSnapshot(recovered),
          });
          return cardSubscriptionResponse({
            intent,
            subscription: recovered,
            reused: true,
          });
        }

        return jsonResponse({
          success: true,
          type: body.billing_type,
          intent_id: intent.intent_id,
          processing: true,
          status: "RECOVERING",
          message:
            "O checkout anterior ainda esta sendo conciliado e nao sera duplicado.",
        }, 202);
      }

      const recovered = await recoverBillingProviderResource(
        body.billing_type,
        intent.external_reference,
      );
      if (!recovered) {
        return jsonResponse(
          {
            success: true,
            type: body.billing_type,
            intent_id: intent.intent_id,
            processing: true,
            status: "RECOVERING",
            message:
              "A criacao anterior ainda esta sendo conciliada e nao sera duplicada.",
          },
          202,
        );
      }

      const payment = recovered as AsaasPayment;
      const directPaymentInput = {
        organizationId: record.organization.id,
        intent,
        payment,
        customerId: payment.customer ||
          intent.provider_customer_id ||
          record.organization.asaas_customer_id ||
          "",
        reused: true,
      };
      return body.billing_type === "PIX"
        ? pixCheckoutResponse(directPaymentInput)
        : boletoCheckoutResponse(directPaymentInput);
    }

    if (intent.outcome !== "create") {
      throw new Error(`Resultado de intent nao suportado: ${intent.outcome}`);
    }

    const description = `Vimob - ${
      intent.plan_name || record.plan?.name || record.organization.name
    }`;
    const value = Number(intent.amount);

    if (body.billing_type === "PIX") {
      const customerId = await prepareAsaasCustomer(
        record.organization,
        billingDetails,
        record.access.canPersistBillingProfile,
      );
      providerRequestStarted = true;
      const payment = await asaasRequest<AsaasPayment>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType: "PIX",
          value,
          dueDate: isoDateFromNow(1),
          description,
          externalReference: intent.external_reference,
        }),
      });
      return pixCheckoutResponse({
        organizationId: record.organization.id,
        intent,
        payment,
        customerId,
        reused: false,
      });
    }

    if (body.billing_type === "BOLETO") {
      const customerId = await prepareAsaasCustomer(
        record.organization,
        billingDetails,
        record.access.canPersistBillingProfile,
      );
      providerRequestStarted = true;
      const payment = await asaasRequest<AsaasPayment>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType: "BOLETO",
          value,
          dueDate: isoDateFromNow(3),
          description,
          externalReference: intent.external_reference,
        }),
      });
      return boletoCheckoutResponse({
        organizationId: record.organization.id,
        intent,
        payment,
        customerId,
        reused: false,
      });
    }

    const customerId = await prepareAsaasCustomer(
      record.organization,
      billingDetails,
      record.access.canPersistBillingProfile,
    );

    if (creditCard) {
      providerRequestStarted = true;
      const subscription = await asaasRequest<AsaasSubscription>(
        "/subscriptions",
        {
          method: "POST",
          body: JSON.stringify({
            customer: customerId,
            billingType: "CREDIT_CARD",
            value,
            nextDueDate: isoDateFromNow(0),
            cycle: asaasSubscriptionCycle(intent.billing_period_months),
            description,
            externalReference: intent.external_reference,
            creditCard: {
              holderName: creditCard.holderName || billingDetails.name,
              number: creditCard.number,
              expiryMonth: creditCard.expiryMonth,
              expiryYear: creditCard.expiryYear,
              ccv: creditCard.ccv,
            },
            creditCardHolderInfo: {
              name: creditCard.holderName || billingDetails.name,
              email: billingDetails.email,
              cpfCnpj: creditCard.holderCpfCnpj || billingDetails.cpfCnpj,
              postalCode: billingDetails.postalCode,
              addressNumber: billingDetails.addressNumber,
              addressComplement: billingDetails.addressComplement || null,
              phone: billingDetails.phone.length === 10
                ? billingDetails.phone
                : null,
              mobilePhone: billingDetails.phone.length === 11
                ? billingDetails.phone
                : null,
            },
            remoteIp: cardClientIp,
          }),
        },
      );
      if (!subscription.id) {
        throw new Error("O Asaas nao retornou uma assinatura valida.");
      }

      const cardLast4 = creditCard.number.slice(-4);
      await registerBillingCheckoutProvider({
        intentId: intent.intent_id,
        customerId,
        subscriptionId: subscription.id,
        providerResponse: cardSubscriptionSnapshot(subscription, cardLast4),
      });

      return cardSubscriptionResponse({
        intent,
        subscription,
        reused: false,
        cardLast4,
      });
    }

    providerRequestStarted = true;
    const checkout = await asaasRequest<AsaasHostedCheckout>("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 120,
        externalReference: intent.external_reference,
        callback: checkoutCallbackUrls({
          checkoutToken,
        }),
        items: [{
          externalReference: intent.plan_id,
          name: intent.plan_name || "Plano Vimob",
          description,
          quantity: 1,
          value,
        }],
        customer: customerId,
        subscription: {
          cycle: asaasSubscriptionCycle(intent.billing_period_months),
          nextDueDate: `${isoDateFromNow(0)} 12:00:00`,
        },
      }),
    });
    validateHostedCheckout(checkout);
    await registerBillingHostedCheckout({
      intentId: intent.intent_id,
      checkout,
    });

    return hostedCheckoutResponse({ intent, checkout, reused: false });
  } catch (error) {
    if (
      reservedIntentId &&
      ((!providerRequestStarted && error instanceof Error) ||
        (providerRequestStarted &&
          error instanceof AsaasRequestError &&
          providerFailureIsDeterministic(error.status)))
    ) {
      try {
        await failBillingCheckoutIntent(reservedIntentId, error.message);
      } catch {
        // Preserve the provider error returned to the checkout client.
      }
    }

    console.error("Failed to create Asaas charge.", {
      status: error instanceof AsaasRequestError ? error.status : 500,
      message: error instanceof Error ? error.message : "unknown",
      intentId: reservedIntentId,
    });
    const status = error instanceof AsaasRequestError && error.status >= 400 &&
        error.status < 500
      ? 422
      : 500;
    const cardWasRefused = status === 422 &&
      requestedBillingMethod === "CREDIT_CARD";
    return jsonResponse({
      success: false,
      code: cardWasRefused ? "card_refused" : "payment_unavailable",
      error: cardWasRefused
        ? "O cartao nao autorizou a cobranca. Confira os dados ou tente outro cartao."
        : status === 422
        ? "Nao foi possivel criar a cobranca com os dados informados."
        : "Pagamento temporariamente indisponivel. Tente novamente em instantes.",
    }, status);
  }
});
