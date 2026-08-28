import {
  type AsaasBoletoIdentification,
  type AsaasPayment,
  type AsaasPixQrCode,
  type AsaasSubscription,
  asaasRequest,
  AsaasRequestError,
  type BillingCheckoutState,
  cancelBillingCheckoutResource,
  getAuthorizedCheckoutRecord,
  getBillingCheckoutState,
  getSupabaseAdmin,
  handleOptions,
  isPaidStatus,
  jsonResponse,
  onlyDigits,
  paymentCapabilityCheckoutIntegrity,
  paymentCapabilityExpectedExternalReference,
  publicBillingCheckoutState,
  reconcileBillingCheckoutPaidPayment,
  recoverBillingProviderResource,
  reconcilePaymentCapabilityMethodChange,
  registerBillingCheckoutProvider,
  reconcileAsaasPaymentSnapshot,
  storeBillingCheckoutPayment,
} from "../_shared/asaas.ts";
import {
  asaasCheckoutPaymentIntegrity,
  asaasPaymentCheckoutState,
  authoritativePaymentCheckoutState,
  cardSubscriptionRecoveryAction,
  selectBillingSubscriptionPaymentCandidate,
  subscriptionPaymentsPath,
} from "../_shared/asaas-billing-intent.ts";
import {
  publicBillingCardRecurrenceState,
} from "../_shared/asaas-card-recurrence.ts";
import {
  publicBillingPaymentReceiptReference,
  type PublicBillingPaymentReceiptReference,
} from "../_shared/billing-payment-receipt.ts";

type PaymentState =
  | "creating"
  | "pending"
  | "processing"
  | "settled"
  | "retry"
  | "assisted"
  | "cancelled";

type AsaasListResponse<T> = {
  data?: T[];
  hasMore?: boolean;
};

function readQueryValue(url: URL, name: string) {
  return (url.searchParams.get(name) || "").trim();
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

function paymentState(status?: string | null): PaymentState {
  return asaasPaymentCheckoutState(status);
}

function canEmitAuthoritativePaidPollingEvent(status?: string | null) {
  const normalized = (status || "").trim().toUpperCase();
  return isPaidStatus(normalized) &&
    ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(normalized);
}

function safeCardRecurrenceStatus(
  value: string | null | undefined,
): Parameters<typeof publicBillingCardRecurrenceState>[0] {
  const normalized = (value || "").trim().toLowerCase();
  if (
    [
      "prepared",
      "creating",
      "recovering",
      "completed",
      "failed",
      "cancelled",
    ].includes(normalized)
  ) {
    return normalized as Parameters<typeof publicBillingCardRecurrenceState>[0];
  }
  return null;
}

function responseMessage(state: PaymentState, method: string) {
  if (state === "settled") return "Pagamento confirmado.";
  if (state === "retry" && method === "CREDIT_CARD") {
    return "O cartao nao autorizou a cobranca. Confira os dados ou tente outro cartao.";
  }
  if (state === "retry") {
    return "A cobranca venceu ou nao pode mais ser paga. Gere uma nova cobranca.";
  }
  if (state === "assisted") {
    return "Esta cobranca precisa de verificacao do suporte antes de continuar.";
  }
  if (state === "cancelled") return "A cobranca foi cancelada.";
  if (state === "creating") return "A cobranca ainda esta sendo criada.";
  return method === "BOLETO"
    ? "Boleto aguardando compensacao."
    : "Pagamento aguardando confirmacao.";
}

async function getBillingPaymentReceiptReference(
  organizationId: string,
  providerPaymentId: string,
): Promise<PublicBillingPaymentReceiptReference | null> {
  const supabase = getSupabaseAdmin();
  const normalizedProviderPaymentId = providerPaymentId.trim();
  if (!normalizedProviderPaymentId) return null;

  const { data: paymentRow, error: paymentError } = await supabase
    .from("asaas_payments")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("asaas_payment_id", normalizedProviderPaymentId)
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!paymentRow?.id) return null;

  const { data: receipt, error: receiptError } = await supabase
    .from("billing_payment_receipts")
    .select("receipt_number,verification_token")
    .eq("organization_id", organizationId)
    .eq("payment_id", paymentRow.id)
    .maybeSingle();
  if (receiptError) throw receiptError;

  return publicBillingPaymentReceiptReference(receipt);
}

async function tryBillingPaymentReceiptReference(
  organizationId: string,
  providerPaymentId?: string | null,
) {
  // A checkout capability identifies the organization, not one immutable
  // charge. Never fall back to the organization's latest receipt: an old
  // checkout link must not reveal a later renewal or plan-change receipt.
  if (!providerPaymentId?.trim()) return null;

  try {
    return await getBillingPaymentReceiptReference(
      organizationId,
      providerPaymentId,
    );
  } catch (error) {
    // Receipt delivery must never turn an already-confirmed payment back into
    // an error response. A later poll can recover the immutable reference.
    console.error("Failed to load the Vimob payment receipt reference.", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

type LocalPaymentAuthority = {
  authoritative: boolean;
  state: Exclude<PaymentState, "creating">;
  checkoutClosed: boolean;
  localPaymentId: string;
  providerPaymentId: string;
  providerCustomerId: string;
  providerSubscriptionId: string | null;
  billingType: BillingCheckoutState["billing_method"];
  status: string;
  amount: number;
  dueDate: string;
  paymentDate: string | null;
  invoiceUrl: string;
};

function localRawExternalReference(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  const direct = snapshot.externalReference ?? snapshot.external_reference;
  return typeof direct === "string" && direct.trim() ? direct.trim() : null;
}

async function loadExactLocalPaymentAuthority(input: {
  localPaymentId?: string | null;
  organizationId: string;
  billingIntentId?: string | null;
  paymentSnapshotSource?: string | null;
  providerPaymentId: string;
  providerCustomerId: string;
  providerSubscriptionId?: string | null;
  billingType: BillingCheckoutState["billing_method"];
  amount: number;
  dueDate: string;
  expectedExternalReference?: string | null;
}): Promise<LocalPaymentAuthority | null> {
  if (
    !input.organizationId || !input.providerPaymentId ||
    !input.providerCustomerId || !Number.isFinite(input.amount) ||
    input.amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
  ) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("asaas_payments")
    .select(
      "id,organization_id,billing_intent_id,asaas_payment_id,asaas_customer_id,asaas_subscription_id,billing_type,status,value,due_date,payment_date,invoice_url,raw_event",
    )
    .eq("organization_id", input.organizationId)
    .eq("asaas_payment_id", input.providerPaymentId);
  if (input.localPaymentId?.trim()) {
    query = query.eq("id", input.localPaymentId.trim());
  }
  if (input.billingIntentId?.trim()) {
    query = query.eq("billing_intent_id", input.billingIntentId.trim());
  } else if (
    input.paymentSnapshotSource === "subscription" ||
    input.paymentSnapshotSource === "legacy_catalog"
  ) {
    query = query.is("billing_intent_id", null);
  }

  const { data: payment, error } = await query.maybeSingle();
  if (error) throw error;
  if (!payment) return null;

  const integrity = asaasCheckoutPaymentIntegrity({
    expectedPaymentId: input.providerPaymentId,
    expectedCustomerId: input.providerCustomerId,
    expectedSubscriptionId: input.providerSubscriptionId,
    expectedBillingType: input.billingType,
    expectedAmount: input.amount,
    expectedDueDate: input.dueDate,
    expectedExternalReference: input.expectedExternalReference,
    providerPaymentId: payment.asaas_payment_id,
    providerCustomerId: payment.asaas_customer_id,
    providerSubscriptionId: payment.asaas_subscription_id,
    providerBillingType: payment.billing_type,
    providerAmount: Number(payment.value),
    providerDueDate: payment.due_date,
    providerExternalReference: localRawExternalReference(payment.raw_event),
    providerDeleted: false,
  });
  if (integrity !== "valid") return null;

  const localState = asaasPaymentCheckoutState(payment.status);
  const activeCheckout = await getBillingCheckoutState(input.organizationId);
  const checkoutClosed = !activeCheckout ||
    activeCheckout.intent_id !== input.billingIntentId;
  const authority = authoritativePaymentCheckoutState({
    providerState: localState,
    reconciliationOutcome: null,
    localState,
    localCheckoutClosed: checkoutClosed,
  });

  return {
    authoritative: authority.authoritative,
    state: authority.state,
    checkoutClosed,
    localPaymentId: payment.id,
    providerPaymentId: payment.asaas_payment_id,
    providerCustomerId: payment.asaas_customer_id,
    providerSubscriptionId: payment.asaas_subscription_id || null,
    billingType: payment.billing_type,
    status: payment.status,
    amount: Number(payment.value),
    dueDate: payment.due_date,
    paymentDate: payment.payment_date || null,
    invoiceUrl: safeAsaasPublicUrl(payment.invoice_url),
  } as LocalPaymentAuthority;
}

function isClosedTerminalLocalPaymentAuthority(
  authority: LocalPaymentAuthority | null,
) {
  return authority?.checkoutClosed === true &&
    (authority.state === "settled" || authority.state === "cancelled");
}

async function exactLocalTerminalPaymentResponse(input: {
  authority: LocalPaymentAuthority | null;
  organizationId: string;
  recurrenceStatus?: Parameters<typeof publicBillingCardRecurrenceState>[0];
}) {
  if (!isClosedTerminalLocalPaymentAuthority(input.authority)) return null;
  const authority = input.authority!;
  const billingType = authority.billingType;
  const recurrenceStatus = input.recurrenceStatus;
  const recurrence = billingType === "CREDIT_CARD"
    ? publicBillingCardRecurrenceState(recurrenceStatus)
    : null;
  const receipt = authority.state === "settled"
    ? await tryBillingPaymentReceiptReference(
      input.organizationId,
      authority.providerPaymentId,
    )
    : null;

  // Polling reports only the durable recurrence job state; a paid invoice is
  // not proof that the future card subscription was persisted.
  return jsonResponse({
    checkout: null,
    state: authority.state,
    message: responseMessage(authority.state, billingType),
    payment: {
      id: authority.providerPaymentId,
      status: authority.status,
      billing_type: billingType,
      value: authority.amount,
      due_date: authority.dueDate,
      payment_date: authority.paymentDate,
      invoice_url: authority.invoiceUrl,
    },
    ...(recurrence ? { recurrence } : {}),
    ...(receipt ? { receipt } : {}),
  }, 200, {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
  });
}

function paymentReconciliationUnavailableResponse(paymentId?: string | null) {
  return jsonResponse({
    state: "assisted",
    code: "payment_reconciliation_required",
    message:
      "O status desta cobranca ainda nao pode ser confirmado. Tente novamente em instantes.",
    ...(paymentId ? { payment_id: paymentId } : {}),
  }, 503, {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
  });
}

async function getExactRequestedPaymentReceiptEvidence(
  organizationId: string,
  input: { intentId: string; paymentId: string; subscriptionId: string },
) {
  if (!input.intentId && !input.paymentId && !input.subscriptionId) return null;

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("asaas_payments")
    .select("asaas_payment_id,status")
    .eq("organization_id", organizationId)
    .limit(2);
  if (input.intentId) query = query.eq("billing_intent_id", input.intentId);
  if (input.paymentId) query = query.eq("asaas_payment_id", input.paymentId);
  if (input.subscriptionId) {
    query = query.eq("asaas_subscription_id", input.subscriptionId);
  }
  const { data, error } = await query;
  if (error) throw error;
  const payments = Array.isArray(data) ? data : [];
  if (payments.length !== 1) return null;
  const payment = payments[0];
  if (asaasPaymentCheckoutState(payment.status) !== "settled") return null;
  const providerPaymentId = payment.asaas_payment_id;
  if (!providerPaymentId) return null;
  const receipt = await getBillingPaymentReceiptReference(
    organizationId,
    providerPaymentId,
  );
  return receipt ? { providerPaymentId, receipt } : null;
}

async function tryPixArtifact(paymentId: string) {
  try {
    const pix = await asaasRequest<AsaasPixQrCode>(
      `/payments/${encodeURIComponent(paymentId)}/pixQrCode`,
    );
    return {
      qr_code: pix.encodedImage || "",
      qr_payload: pix.payload || "",
    };
  } catch (error) {
    console.warn("Pix artifact is not available yet.", {
      paymentId,
      status: error instanceof AsaasRequestError ? error.status : 500,
    });
    return { qr_code: "", qr_payload: "" };
  }
}

async function tryBoletoArtifact(payment: AsaasPayment) {
  let identificationField = "";
  let barCode = "";
  try {
    const identification = await asaasRequest<AsaasBoletoIdentification>(
      `/payments/${encodeURIComponent(payment.id)}/identificationField`,
    );
    identificationField = onlyDigits(identification.identificationField || "");
    barCode = onlyDigits(identification.barCode || "");
  } catch (error) {
    console.warn("Boleto artifact is not available yet.", {
      paymentId: payment.id,
      status: error instanceof AsaasRequestError ? error.status : 500,
    });
  }

  return {
    bank_slip_url: safeAsaasPublicUrl(payment.bankSlipUrl) ||
      safeAsaasPublicUrl(payment.invoiceUrl),
    identification_field: identificationField,
    bar_code: barCode,
  };
}

async function paymentScopedStatusResponse(
  record: NonNullable<Awaited<ReturnType<typeof getAuthorizedCheckoutRecord>>>,
) {
  const access = record.access;
  if (access.scope !== "payment") {
    return paymentReconciliationUnavailableResponse();
  }

  const paymentAmount = Number(access.paymentAmount);
  const paymentDueDate = access.paymentDueDate;
  const providerCustomerId = access.providerCustomerId;
  const expectedExternalReference =
    paymentCapabilityExpectedExternalReference(access);
  const observedAt = new Date();
  let payment: AsaasPayment;
  let preloadedLocalAuthority: LocalPaymentAuthority | null = null;

  try {
    payment = await asaasRequest<AsaasPayment>(
      `/payments/${encodeURIComponent(access.providerPaymentId)}`,
    );
  } catch (error) {
    if (error instanceof AsaasRequestError && error.status === 404) {
      preloadedLocalAuthority = await loadExactLocalPaymentAuthority({
        localPaymentId: access.paymentId,
        organizationId: record.organization.id,
        billingIntentId: access.billingIntentId,
        paymentSnapshotSource: access.paymentSnapshotSource,
        providerPaymentId: access.providerPaymentId,
        providerCustomerId,
        providerSubscriptionId: access.providerSubscriptionId,
        billingType: access.billingType,
        amount: paymentAmount,
        dueDate: paymentDueDate,
        expectedExternalReference,
      });
      const localResponse = await exactLocalTerminalPaymentResponse({
        authority: preloadedLocalAuthority,
        organizationId: record.organization.id,
        recurrenceStatus: safeCardRecurrenceStatus(
          access.cardRecurrenceStatus,
        ),
      });
      return localResponse ||
        paymentReconciliationUnavailableResponse(access.providerPaymentId);
    }
    throw error;
  }

  let paymentIntegrity = paymentCapabilityCheckoutIntegrity({
    access,
    payment,
    validateMutableFields: false,
  });
  if (paymentIntegrity !== "valid" && paymentIntegrity !== "deleted") {
    return jsonResponse({ error: "Cobranca nao encontrada neste checkout." }, 404);
  }
  if (paymentIntegrity === "deleted") {
    payment = { ...payment, status: "DELETED" };
  }

  const providerBillingType = (payment.billingType || "")
    .trim()
    .toUpperCase() as BillingCheckoutState["billing_method"];
  const providerDueDate = payment.dueDate || "";
  const mutableSnapshotChanged = providerBillingType !== access.billingType ||
    providerDueDate !== access.paymentDueDate;
  if (paymentIntegrity === "valid" && mutableSnapshotChanged) {
    const methodChange = await reconcilePaymentCapabilityMethodChange({
      record,
      payment,
      observedAt,
    });
    if (!["updated", "already_updated"].includes(methodChange.outcome || "")) {
      preloadedLocalAuthority = await loadExactLocalPaymentAuthority({
        localPaymentId: access.paymentId,
        organizationId: record.organization.id,
        billingIntentId: access.billingIntentId,
        paymentSnapshotSource: access.paymentSnapshotSource,
        providerPaymentId: payment.id,
        providerCustomerId: payment.customer || providerCustomerId,
        providerSubscriptionId: payment.subscription ||
          access.providerSubscriptionId,
        billingType: providerBillingType,
        amount: Number(payment.value),
        dueDate: providerDueDate,
        expectedExternalReference,
      });
      if (!preloadedLocalAuthority?.authoritative) {
        return paymentReconciliationUnavailableResponse(payment.id);
      }
    }
  }

  paymentIntegrity = paymentCapabilityCheckoutIntegrity({
    access,
    payment,
    validateMutableFields: false,
  });
  if (paymentIntegrity !== "valid" && paymentIntegrity !== "deleted") {
    return jsonResponse({ error: "Cobranca nao encontrada neste checkout." }, 404);
  }

  const providerState = paymentState(payment.status);
  const reconciliation = await reconcileAsaasPaymentSnapshot({
    organizationId: record.organization.id,
    providerPaymentId: payment.id,
    providerCustomerId: payment.customer || providerCustomerId,
    providerSubscriptionId: payment.subscription ||
      access.providerSubscriptionId,
    paymentStatus: payment.status || "",
    paymentAmount: Number(payment.value),
    paymentDueDate: payment.dueDate || "",
    observedAt: observedAt.toISOString(),
    source: "edge_payment_checkout",
  });
  const reconciliationOutcome = reconciliation.outcome || null;
  let localAuthority = preloadedLocalAuthority;
  if (reconciliationOutcome !== "applied" || !localAuthority) {
    localAuthority = await loadExactLocalPaymentAuthority({
      localPaymentId: access.paymentId,
      organizationId: record.organization.id,
      billingIntentId: access.billingIntentId,
      paymentSnapshotSource: access.paymentSnapshotSource,
      providerPaymentId: payment.id,
      providerCustomerId: payment.customer || providerCustomerId,
      providerSubscriptionId: payment.subscription ||
        access.providerSubscriptionId,
      billingType: providerBillingType,
      amount: Number(payment.value),
      dueDate: payment.dueDate || "",
      expectedExternalReference,
    });
  }
  const authority = authoritativePaymentCheckoutState({
    providerState,
    reconciliationOutcome,
    localState: localAuthority?.state,
    localCheckoutClosed: localAuthority?.checkoutClosed,
  });
  if (!authority.authoritative) {
    return paymentReconciliationUnavailableResponse(payment.id);
  }

  if (
    authority.state === "settled" &&
    canEmitAuthoritativePaidPollingEvent(payment.status)
  ) {
    await reconcileBillingCheckoutPaidPayment(payment, observedAt);
  }

  const pix = access.billingType === "PIX" && authority.state !== "cancelled"
    ? await tryPixArtifact(payment.id)
    : undefined;
  const boleto = access.billingType === "BOLETO" &&
      authority.state !== "cancelled"
    ? await tryBoletoArtifact(payment)
    : undefined;
  const billingType = providerBillingType;
  const recurrenceStatus = safeCardRecurrenceStatus(
    access.cardRecurrenceStatus,
  );
  const recurrence = billingType === "CREDIT_CARD"
    ? publicBillingCardRecurrenceState(recurrenceStatus)
    : null;
  const receipt = authority.state === "settled"
    ? await tryBillingPaymentReceiptReference(
      record.organization.id,
      payment.id,
    )
    : null;

  // A paid invoice only queues the durable recurrence job. Its persisted
  // status above is the sole source of recurrence flags returned publicly.
  return jsonResponse({
    checkout: null,
    state: authority.state,
    message: responseMessage(authority.state, billingType),
    payment: {
      id: payment.id,
      status: payment.status || null,
      billing_type: billingType,
      value: payment.value ?? paymentAmount,
      due_date: payment.dueDate || null,
      payment_date: payment.paymentDate || null,
      invoice_url: safeAsaasPublicUrl(payment.invoiceUrl),
    },
    ...(pix ? { pix } : {}),
    ...(boleto ? { boleto } : {}),
    ...(recurrence ? { recurrence } : {}),
    ...(receipt ? { receipt } : {}),
  }, 200, {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
  });
}

async function recoverProviderResource(
  state: BillingCheckoutState,
  organizationCustomerId: string | null,
) {
  if (
    state.provider_payment_id || state.provider_subscription_id ||
    state.provider_checkout_id
  ) {
    return state;
  }

  const recovered = await recoverBillingProviderResource(
    state.billing_method,
    state.external_reference,
  );
  if (!recovered?.id) return state;

  const customerId = recovered.customer || state.provider_customer_id ||
    organizationCustomerId || "";
  if (!customerId) return state;

  if (state.billing_method === "CREDIT_CARD") {
    const subscription = recovered as AsaasSubscription;
    await registerBillingCheckoutProvider({
      intentId: state.intent_id,
      customerId,
      subscriptionId: subscription.id,
      providerResponse: {
        id: subscription.id,
        status: subscription.status || null,
        nextDueDate: subscription.nextDueDate || null,
        value: subscription.value ?? state.amount,
        customer: subscription.customer || customerId,
        externalReference: subscription.externalReference ||
          state.external_reference,
        billingType: "CREDIT_CARD",
      },
    });
  } else {
    const payment = recovered as AsaasPayment;
    await registerBillingCheckoutProvider({
      intentId: state.intent_id,
      customerId,
      paymentId: payment.id,
      subscriptionId: payment.subscription || null,
      providerResponse: payment,
    });
    await storeBillingCheckoutPayment({
      intentId: state.intent_id,
      organizationId: state.organization_id,
      payment,
      customerId,
      billingType: state.billing_method,
      fallbackValue: state.amount,
    });
  }

  return await getBillingCheckoutState(state.organization_id) || state;
}

function ensureRequestedResourceMatches(
  state: BillingCheckoutState,
  input: { intentId: string; paymentId: string; subscriptionId: string },
) {
  if (input.intentId && input.intentId !== state.intent_id) return false;
  if (
    input.paymentId && input.paymentId !== state.provider_payment_id &&
    input.paymentId !== state.payment?.id
  ) {
    return false;
  }
  if (
    input.subscriptionId &&
    input.subscriptionId !== state.provider_subscription_id
  ) {
    return false;
  }
  return true;
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Metodo nao permitido." }, 405);
    }

    const url = new URL(request.url);
    const checkoutToken = readQueryValue(url, "checkout_token");
    const intentId = readQueryValue(url, "intent_id");
    const paymentId = readQueryValue(url, "payment_id");
    const subscriptionId = readQueryValue(url, "subscription_id");
    if (!checkoutToken) {
      return jsonResponse({ error: "Checkout obrigatorio." }, 400);
    }

    const record = await getAuthorizedCheckoutRecord(request, {
      token: checkoutToken,
    });
    if (!record) {
      return jsonResponse({ error: "Checkout nao encontrado." }, 404);
    }

    if (record.access.scope === "payment") {
      return await paymentScopedStatusResponse(record);
    }

    let checkout = await getBillingCheckoutState(record.organization.id);
    if (!checkout) {
      const requestedResource = Boolean(
        intentId || paymentId || subscriptionId,
      );
      if (requestedResource) {
        const evidence = await getExactRequestedPaymentReceiptEvidence(
          record.organization.id,
          { intentId, paymentId, subscriptionId },
        );
        if (!evidence) {
          return paymentReconciliationUnavailableResponse(paymentId);
        }
        return jsonResponse({
          checkout: null,
          state: "settled",
          message: "Pagamento confirmado.",
          receipt: evidence.receipt,
          payment: { id: evidence.providerPaymentId, status: "CONFIRMED" },
        }, 200, {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
        });
      }

      const settled = record.organization.subscription_status === "active" &&
        record.organization.pending_plan_id === null;
      const receipt = settled
        ? await tryBillingPaymentReceiptReference(
          record.organization.id,
          paymentId,
        )
        : null;
      return jsonResponse({
        checkout: null,
        state: settled ? "settled" : "cancelled",
        message: settled
          ? "Pagamento confirmado."
          : "Nao existe uma cobranca ativa neste checkout.",
        ...(receipt ? { receipt } : {}),
      }, 200, { "Cache-Control": "private, no-store, max-age=0" });
    }

    if (!ensureRequestedResourceMatches(checkout, {
      intentId,
      paymentId,
      subscriptionId,
    })) {
      return jsonResponse({ error: "Cobranca nao encontrada neste checkout." }, 404);
    }

    const paymentObservedAt = new Date();
    checkout = await recoverProviderResource(
      checkout,
      record.organization.asaas_customer_id,
    );

    let payment: AsaasPayment | null = null;
    let state: PaymentState = checkout.status === "creating"
      ? "creating"
      : "pending";
    let pix: Awaited<ReturnType<typeof tryPixArtifact>> | undefined;
    let boleto: Awaited<ReturnType<typeof tryBoletoArtifact>> | undefined;
    if (
      checkout.billing_method === "PIX" ||
      checkout.billing_method === "BOLETO"
    ) {
      const directPaymentId = checkout.provider_payment_id ||
        checkout.payment?.id;
      if (directPaymentId) {
        const paymentAmount = Number(
          checkout.payment?.value ?? checkout.amount,
        );
        const paymentDueDate = checkout.payment?.due_date || "";
        const providerCustomerId = checkout.provider_customer_id ||
          record.organization.asaas_customer_id || "";
        let localAuthority: LocalPaymentAuthority | null = null;
        try {
          payment = await asaasRequest<AsaasPayment>(
            `/payments/${encodeURIComponent(directPaymentId)}`,
          );
        } catch (error) {
          if (!(error instanceof AsaasRequestError) || error.status !== 404) {
            throw error;
          }
          localAuthority = await loadExactLocalPaymentAuthority({
            organizationId: checkout.organization_id,
            billingIntentId: checkout.intent_id,
            providerPaymentId: directPaymentId,
            providerCustomerId,
            providerSubscriptionId: null,
            billingType: checkout.billing_method,
            amount: paymentAmount,
            dueDate: paymentDueDate,
            expectedExternalReference: checkout.external_reference,
          });
          const localResponse = await exactLocalTerminalPaymentResponse({
            authority: localAuthority,
            organizationId: checkout.organization_id,
          });
          if (localResponse) return localResponse;
          return paymentReconciliationUnavailableResponse(directPaymentId);
        }

        const integrity = asaasCheckoutPaymentIntegrity({
          expectedPaymentId: directPaymentId,
          expectedCustomerId: providerCustomerId,
          expectedSubscriptionId: null,
          expectedBillingType: checkout.billing_method,
          expectedAmount: paymentAmount,
          expectedDueDate: paymentDueDate,
          expectedExternalReference: checkout.external_reference,
          providerPaymentId: payment.id,
          providerCustomerId: payment.customer,
          providerSubscriptionId: payment.subscription,
          providerBillingType: payment.billingType,
          providerAmount: payment.value,
          providerDueDate: payment.dueDate,
          providerExternalReference: payment.externalReference,
          providerDeleted: payment.deleted,
        });
        if (integrity !== "valid" && integrity !== "deleted") {
          return paymentReconciliationUnavailableResponse(payment.id);
        }
        if (integrity === "deleted") {
          payment = { ...payment, status: "DELETED" };
        }

        const stored = await storeBillingCheckoutPayment({
          intentId: checkout.intent_id,
          organizationId: checkout.organization_id,
          payment,
          customerId: providerCustomerId,
          billingType: checkout.billing_method,
          fallbackValue: checkout.amount,
        });
        if (!stored || typeof stored !== "object") {
          throw new Error("One-off payment snapshot was not stored.");
        }
        const storedStatus = typeof stored.status === "string"
          ? stored.status
          : payment.status || "";
        state = paymentState(storedStatus);
        const snapshot = await reconcileAsaasPaymentSnapshot({
          organizationId: checkout.organization_id,
          providerPaymentId: payment.id,
          providerCustomerId: payment.customer || providerCustomerId,
          providerSubscriptionId: null,
          paymentStatus: payment.status || storedStatus,
          paymentAmount: Number(payment.value),
          paymentDueDate: payment.dueDate || paymentDueDate,
          observedAt: paymentObservedAt.toISOString(),
          source: "edge_organization_checkout",
        });
        const reconciliationOutcome = snapshot.outcome || null;
        const snapshotApplied = reconciliationOutcome === "applied";
        const requiresLocalAuthority = !snapshotApplied;
        localAuthority = await loadExactLocalPaymentAuthority({
          organizationId: checkout.organization_id,
          billingIntentId: checkout.intent_id,
          providerPaymentId: payment.id,
          providerCustomerId: payment.customer || providerCustomerId,
          providerSubscriptionId: null,
          billingType: checkout.billing_method,
          amount: Number(payment.value),
          dueDate: payment.dueDate || paymentDueDate,
          expectedExternalReference: checkout.external_reference,
        });
        const authority = authoritativePaymentCheckoutState({
          providerState: state === "creating" ? "assisted" : state,
          reconciliationOutcome,
          localState: localAuthority?.state,
          localCheckoutClosed: localAuthority?.checkoutClosed,
        });
        if (
          !authority.authoritative ||
          (requiresLocalAuthority && !localAuthority)
        ) {
          return paymentReconciliationUnavailableResponse(payment.id);
        }
        state = authority.state;
        if (["pending", "processing"].includes(state)) {
          if (checkout.billing_method === "PIX") {
            pix = await tryPixArtifact(payment.id);
          } else {
            boleto = await tryBoletoArtifact(payment);
          }
        }
      }
    } else if (checkout.provider_subscription_id) {
      const providerCustomerId = checkout.provider_customer_id ||
        record.organization.asaas_customer_id || "";
      const paymentAmount = Number(
        checkout.payment?.value ?? checkout.amount,
      );
      const paymentDueDate = checkout.payment?.due_date || "";
      if (checkout.payment?.id) {
        try {
          payment = await asaasRequest<AsaasPayment>(
            `/payments/${encodeURIComponent(checkout.payment.id)}`,
          );
          const integrity = asaasCheckoutPaymentIntegrity({
            expectedPaymentId: checkout.payment.id,
            expectedCustomerId: providerCustomerId,
            expectedSubscriptionId: checkout.provider_subscription_id,
            expectedBillingType: "CREDIT_CARD",
            expectedAmount: checkout.amount,
            expectedDueDate: checkout.payment.due_date || "",
            expectedExternalReference: checkout.external_reference,
            providerPaymentId: payment.id,
            providerCustomerId: payment.customer,
            providerSubscriptionId: payment.subscription,
            providerBillingType: payment.billingType,
            providerAmount: payment.value,
            providerDueDate: payment.dueDate,
            providerExternalReference: payment.externalReference,
            providerDeleted: payment.deleted,
          });
          if (integrity !== "valid" && integrity !== "deleted") {
            return paymentReconciliationUnavailableResponse(payment.id);
          }
          if (integrity === "deleted") {
            payment = { ...payment, status: "DELETED" };
          }
        } catch (error) {
          if (!(error instanceof AsaasRequestError) || error.status !== 404) {
            throw error;
          }
        }
      }
      if (!payment) {
        const result = await asaasRequest<AsaasListResponse<AsaasPayment>>(
          `${subscriptionPaymentsPath(checkout.provider_subscription_id)}&includeDeleted=true`,
        );
        const candidates = checkout.payment?.id
          ? (result.data || []).filter((item) =>
            item.id === checkout.payment?.id
          )
          : result.data || [];
        const selection = selectBillingSubscriptionPaymentCandidate({
          subscriptionId: checkout.provider_subscription_id,
          externalReference: checkout.external_reference,
          expectedCustomerId: providerCustomerId,
          expectedAmount: checkout.amount,
          candidates,
          hasMore: result.hasMore,
        });
        payment = selection.outcome === "found" ? selection.resource : null;
        if (payment && payment.deleted === true) {
          payment = { ...payment, status: "DELETED" };
        }
      }
      if (payment?.id) {
        const stored = await storeBillingCheckoutPayment({
          intentId: checkout.intent_id,
          organizationId: checkout.organization_id,
          payment,
          customerId: providerCustomerId,
          subscriptionId: checkout.provider_subscription_id,
          billingType: "CREDIT_CARD",
          fallbackValue: checkout.amount,
        });
        const storedStatus = typeof stored?.status === "string"
          ? stored.status
          : payment.status || "";
        const action = cardSubscriptionRecoveryAction(
          storedStatus,
          {
            providerRequestStartedAt: checkout.provider_request_started_at,
            createdAt: checkout.created_at,
          },
        );
        state = action === "settled"
          ? "settled"
          : action === "retry"
          ? "retry"
          : action === "cancelled"
          ? "cancelled"
          : action === "assisted"
          ? "assisted"
          : "pending";
        const snapshot = await reconcileAsaasPaymentSnapshot({
          organizationId: checkout.organization_id,
          providerPaymentId: payment.id,
          providerCustomerId: payment.customer || providerCustomerId,
          providerSubscriptionId: payment.subscription ||
            checkout.provider_subscription_id,
          paymentStatus: payment.status || storedStatus,
          paymentAmount: Number(payment.value),
          paymentDueDate: payment.dueDate || paymentDueDate,
          observedAt: paymentObservedAt.toISOString(),
          source: "edge_subscription_checkout",
        });
        const reconciliationOutcome = snapshot.outcome || null;
        const requiresLocalAuthority = reconciliationOutcome !== "applied";
        const localAuthority = await loadExactLocalPaymentAuthority({
          organizationId: checkout.organization_id,
          billingIntentId: checkout.intent_id,
          providerPaymentId: payment.id,
          providerCustomerId: payment.customer || providerCustomerId,
          providerSubscriptionId: payment.subscription ||
            checkout.provider_subscription_id,
          billingType: "CREDIT_CARD",
          amount: paymentAmount,
          dueDate: paymentDueDate,
          expectedExternalReference: checkout.external_reference,
        });
        const authority = authoritativePaymentCheckoutState({
          providerState: state === "creating" ? "assisted" : state,
          reconciliationOutcome,
          localState: localAuthority?.state,
          localCheckoutClosed: localAuthority?.checkoutClosed,
        });
        if (!authority.authoritative || !localAuthority) {
          return paymentReconciliationUnavailableResponse(payment.id);
        }
        if (requiresLocalAuthority && !localAuthority) {
          return paymentReconciliationUnavailableResponse(payment.id);
        }
        state = authority.state;
        if (state === "cancelled") {
          state = "retry";
        }
      }
      if (!payment) {
        if (checkout.payment?.id) {
          return paymentReconciliationUnavailableResponse(
            checkout.payment.id,
          );
        }
        const action = cardSubscriptionRecoveryAction(null, {
          providerRequestStartedAt: checkout.provider_request_started_at,
          createdAt: checkout.created_at,
        });
        state = action === "retry" ? "retry" : "pending";
      }
    }

    if (payment?.id && state === "settled") {
      if (canEmitAuthoritativePaidPollingEvent(payment.status)) {
        const reconciliation = await reconcileBillingCheckoutPaidPayment(
          payment,
          paymentObservedAt,
        );
        if (reconciliation.outcome === "unmatched") {
          console.warn("Paid Asaas payment was not matched during polling.", {
            paymentId: payment.id,
            intentId: checkout.intent_id,
          });
        }
      }
    } else if (state === "cancelled") {
      const cancellation = await cancelBillingCheckoutResource({
        organizationId: checkout.organization_id,
        intentId: checkout.intent_id,
        paymentId: payment?.id || checkout.provider_payment_id ||
          checkout.payment?.id || null,
        subscriptionId: checkout.provider_subscription_id,
      });
      if (
        cancellation.outcome !== "already_paid" &&
        !["cancelled", "already_cancelled"].includes(
          cancellation.outcome || "",
        )
      ) {
        return paymentReconciliationUnavailableResponse(payment?.id);
      }
      if (!payment?.id) {
        return paymentReconciliationUnavailableResponse();
      }
      const providerCustomerId = payment.customer ||
        checkout.provider_customer_id ||
        record.organization.asaas_customer_id || "";
      const localAuthority = await loadExactLocalPaymentAuthority({
        organizationId: checkout.organization_id,
        billingIntentId: checkout.intent_id,
        providerPaymentId: payment.id,
        providerCustomerId,
        providerSubscriptionId: payment.subscription ||
          checkout.provider_subscription_id,
        billingType: checkout.billing_method,
        amount: Number(payment.value ?? checkout.amount),
        dueDate: payment.dueDate || checkout.payment?.due_date || "",
        expectedExternalReference: checkout.external_reference,
      });
      if (!localAuthority?.authoritative) {
        return paymentReconciliationUnavailableResponse(payment.id);
      }
      state = localAuthority.state;
    }

    const refreshedCheckout = await getBillingCheckoutState(
      record.organization.id,
    );
    const receipt = state === "settled"
      ? await tryBillingPaymentReceiptReference(
        record.organization.id,
        payment?.id || refreshedCheckout?.provider_payment_id ||
          checkout.provider_payment_id || checkout.payment?.id || null,
      )
      : null;
    return jsonResponse({
      checkout: refreshedCheckout
        ? publicBillingCheckoutState(refreshedCheckout)
        : state === "settled" || state === "cancelled"
        ? null
        : publicBillingCheckoutState(checkout),
      state,
      message: responseMessage(state, checkout.billing_method),
      ...(payment
        ? {
          payment: {
            id: payment.id,
            status: payment.status || null,
            billing_type: payment.billingType || checkout.billing_method,
            value: payment.value ?? checkout.amount,
            due_date: payment.dueDate || null,
            payment_date: payment.paymentDate || null,
            invoice_url: safeAsaasPublicUrl(payment.invoiceUrl),
          },
        }
        : {}),
      ...(pix ? { pix } : {}),
      ...(boleto ? { boleto } : {}),
      ...(receipt ? { receipt } : {}),
    }, 200, {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    });
  } catch (error) {
    console.error("Failed to reconcile Asaas payment status.", {
      status: error instanceof AsaasRequestError ? error.status : 500,
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse(
      { error: "Nao foi possivel consultar o pagamento agora." },
      error instanceof AsaasRequestError && error.status >= 400 &&
          error.status < 500
        ? error.status
        : 503,
    );
  }
});
