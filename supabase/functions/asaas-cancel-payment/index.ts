import {
  type AsaasPayment,
  type AsaasSubscription,
  asaasRequest,
  AsaasRequestError,
  cancelBillingCheckoutResource,
  claimBillingPaymentCheckoutCancellation,
  claimBillingSubscriptionCheckoutCancellation,
  failBillingPaymentCheckoutCancellation,
  failBillingSubscriptionCheckoutCancellation,
  finalizeBillingPaymentCheckoutCancellation,
  finalizeBillingSubscriptionCheckoutCancellation,
  getAuthorizedCheckoutRecord,
  getBillingCheckoutState,
  handleOptions,
  jsonResponse,
  markBillingPaymentCheckoutCancellationDeleteStarted,
  reconcileAsaasPaymentSnapshot,
  recoverBillingProviderResource,
  registerBillingCheckoutProvider,
  storeBillingCheckoutPayment,
} from "../_shared/asaas.ts";
import {
  asaasCheckoutPaymentIntegrity,
  billingCheckoutCancellationGraceMs,
  billingPaymentCancellationAction,
  cardSubscriptionRecoveryAction,
  cardSubscriptionRequiresDeletion,
  providerlessCheckoutCancellationAction,
  providerFailureIsDeterministic,
  subscriptionPaymentsPath,
} from "../_shared/asaas-billing-intent.ts";
import { validateBillingCardRecurrenceCancellationTarget } from "../_shared/asaas-card-recurrence.ts";
import { billingOrganizationIsUnavailable } from "../_shared/billing-organization-state.ts";

type CancelPaymentRequest = {
  intent_id?: string;
  payment_id?: string;
  subscription_id?: string;
  checkout_token?: string;
};

type AsaasDeleteResponse = {
  id?: string;
  deleted?: boolean;
};

type AsaasListResponse<T> = {
  data?: T[];
};

const PAYMENT_CANCELLATION_LEASE_SECONDS = 600;

type ActivePaymentCancellationClaim = {
  organizationId: string;
  intentId: string;
  claimToken: string;
  paymentId: string;
};

type ActiveSubscriptionCancellationClaim = {
  organizationId: string;
  intentId: string;
  claimToken: string;
  subscriptionId: string;
};

class PaymentCancellationProcessingError extends Error {
  constructor(
    readonly failureClass: "retryable" | "permanent",
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentCancellationProcessingError";
  }
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function paymentCancellationFailure(error: unknown) {
  if (error instanceof PaymentCancellationProcessingError) {
    return {
      failureClass: error.failureClass,
      errorCode: error.errorCode,
    } as const;
  }
  if (
    error instanceof AsaasRequestError &&
    (error.status === 401 || error.status === 403)
  ) {
    return {
      failureClass: "retryable",
      errorCode: "provider_auth_unavailable",
    } as const;
  }
  if (
    error instanceof AsaasRequestError &&
    providerFailureIsDeterministic(error.status)
  ) {
    return {
      failureClass: "permanent",
      errorCode: "provider_cancellation_request_rejected",
    } as const;
  }
  return {
    failureClass: "retryable",
    errorCode: "provider_cancellation_request_ambiguous",
  } as const;
}

function paidDuringCancellationResponse() {
  return jsonResponse({
    success: false,
    outcome: "paid_before_delete",
    error: "O pagamento foi confirmado durante o cancelamento e permanece ativo.",
  }, 409);
}

function paymentCancellationManualReviewResponse() {
  return jsonResponse({
    success: false,
    outcome: "manual_review",
    error:
      "A cobranca exige verificacao do suporte e nao pode ser removida automaticamente.",
  }, 409);
}

function subscriptionCancellationManualReviewResponse() {
  return paymentCancellationManualReviewResponse();
}

function cancellationOrganizationUnavailableResponse() {
  return jsonResponse({
    success: false,
    outcome: "organization_inactive",
    code: "organization_inactive",
    error: "Esta organizacao nao esta disponivel para cancelar cobrancas.",
  }, 410);
}

function cancellationBusyResponse(retryAfterSeconds = 30) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return jsonResponse({
    success: false,
    retryable: true,
    retry_after_seconds: retryAfter,
    outcome: "retry_later",
    error: "A cobranca ainda esta sendo conciliada. Tente novamente em instantes.",
  }, 409, { "Retry-After": String(retryAfter) });
}

async function reconcileOneOffPaymentObservation(input: {
  organizationId: string;
  payment: AsaasPayment;
  expectedPaymentId: string;
  expectedCustomerId: string;
  expectedBillingType: "PIX" | "BOLETO";
  expectedAmount: number;
  expectedDueDate: string;
  expectedExternalReference: string;
  observedAt: Date;
  source: string;
}) {
  const integrity = asaasCheckoutPaymentIntegrity({
    expectedPaymentId: input.expectedPaymentId,
    expectedCustomerId: input.expectedCustomerId,
    expectedSubscriptionId: null,
    expectedBillingType: input.expectedBillingType,
    expectedAmount: input.expectedAmount,
    expectedDueDate: input.expectedDueDate,
    expectedExternalReference: input.expectedExternalReference,
    providerPaymentId: input.payment.id,
    providerCustomerId: input.payment.customer,
    providerSubscriptionId: input.payment.subscription,
    providerBillingType: input.payment.billingType,
    providerAmount: input.payment.value,
    providerDueDate: input.payment.dueDate,
    providerExternalReference: input.payment.externalReference,
    providerDeleted: input.payment.deleted,
  });
  if (integrity !== "valid" && integrity !== "deleted") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_identity_mismatch",
      `Provider payment tuple mismatch: ${integrity}`,
    );
  }

  const status = integrity === "deleted"
    ? "DELETED"
    : input.payment.status?.trim().toUpperCase() || "";
  if (!status) {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_payment_status_missing",
      "Provider payment status is missing.",
    );
  }
  const snapshot = await reconcileAsaasPaymentSnapshot({
    organizationId: input.organizationId,
    providerPaymentId: input.expectedPaymentId,
    providerCustomerId: input.expectedCustomerId,
    providerSubscriptionId: null,
    paymentStatus: status,
    paymentAmount: input.expectedAmount,
    paymentDueDate: input.expectedDueDate,
    observedAt: input.observedAt.toISOString(),
    source: input.source,
  });
  const outcome = typeof snapshot.outcome === "string"
    ? snapshot.outcome
    : "unknown";
  if (outcome !== "applied") {
    throw new PaymentCancellationProcessingError(
      outcome === "stale_snapshot" ? "retryable" : "permanent",
      outcome === "stale_snapshot"
        ? "provider_payment_snapshot_stale"
        : "provider_payment_reconciliation_mismatch",
      `Provider payment snapshot was not reconciled: ${outcome}`,
    );
  }
  return {
    action: billingPaymentCancellationAction({
      status,
      billingType: input.expectedBillingType,
      deleted: integrity === "deleted",
    }),
    status,
    outcome,
  };
}

function checkoutPaymentIntegrity(
  input: Parameters<typeof asaasCheckoutPaymentIntegrity>[0],
) {
  return asaasCheckoutPaymentIntegrity(input);
}

async function reconcileSubscriptionCancellationPayment(input: {
  organizationId: string;
  payment: AsaasPayment;
  paymentId: string;
  subscriptionId: string;
  customerId: string;
  externalReference: string;
  amount: number;
  observedAt: Date;
}) {
  const dueDate = input.payment.dueDate?.trim() || "";
  const status = input.payment.deleted === true
    ? "DELETED"
    : input.payment.status?.trim().toUpperCase() || "";
  if (!dueDate || !status) {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_subscription_payment_snapshot_incomplete",
      "The subscription payment snapshot is incomplete.",
    );
  }
  const integrity = checkoutPaymentIntegrity({
    expectedPaymentId: input.paymentId,
    expectedCustomerId: input.customerId,
    expectedSubscriptionId: input.subscriptionId,
    expectedBillingType: "CREDIT_CARD",
    expectedAmount: input.amount,
    expectedDueDate: dueDate,
    expectedExternalReference: input.externalReference,
    providerPaymentId: input.payment.id,
    providerCustomerId: input.payment.customer,
    // Asaas may clear the link after deleting a subscription. The immutable
    // claim already proves which subscription this payment belonged to.
    providerSubscriptionId: input.subscriptionId,
    providerBillingType: input.payment.billingType,
    providerAmount: input.payment.value,
    providerDueDate: input.payment.dueDate,
    providerExternalReference: input.payment.externalReference,
    providerDeleted: input.payment.deleted,
  });
  if (integrity !== "valid" && integrity !== "deleted") {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_subscription_payment_tuple_mismatch",
      `Subscription payment tuple mismatch: ${integrity}`,
    );
  }
  const reconciliation = await reconcileAsaasPaymentSnapshot({
    organizationId: input.organizationId,
    providerPaymentId: input.paymentId,
    providerCustomerId: input.customerId,
    providerSubscriptionId: input.subscriptionId,
    paymentStatus: status,
    paymentAmount: input.amount,
    paymentDueDate: dueDate,
    observedAt: input.observedAt.toISOString(),
    source: "edge_subscription_cancellation",
  });
  if (reconciliation.outcome !== "applied") {
    throw new PaymentCancellationProcessingError(
      reconciliation.outcome === "stale_snapshot" ? "retryable" : "permanent",
      reconciliation.outcome === "stale_snapshot"
        ? "provider_subscription_payment_snapshot_stale"
        : "provider_subscription_payment_reconciliation_mismatch",
      `Subscription payment was not reconciled: ${reconciliation.outcome}`,
    );
  }
  return reconciliation;
}

async function deleteProviderResource(
  path: string,
  input: { exactIdentityVerified: boolean },
) {
  if (!input.exactIdentityVerified) {
    throw new PaymentCancellationProcessingError(
      "permanent",
      "provider_resource_not_verified",
      "The provider resource identity was not verified before deletion.",
    );
  }
  try {
    await asaasRequest<AsaasDeleteResponse>(path, { method: "DELETE" });
    return false;
  } catch (error) {
    if (!(error instanceof AsaasRequestError) || error.status !== 404) {
      throw error;
    }
    return true;
  }
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  let activePaymentCancellationClaim: ActivePaymentCancellationClaim | null =
    null;
  let activeSubscriptionCancellationClaim:
    | ActiveSubscriptionCancellationClaim
    | null = null;
  try {
    if (request.method !== "POST" && request.method !== "DELETE") {
      return jsonResponse({ success: false, error: "Metodo nao permitido." }, 405);
    }

    const body = (await request.json()) as CancelPaymentRequest;
    const checkoutToken = readText(body.checkout_token);
    const requestedIntentId = readText(body.intent_id);
    const requestedPaymentId = readText(body.payment_id);
    const requestedSubscriptionId = readText(body.subscription_id);
    if (!checkoutToken) {
      return jsonResponse(
        { success: false, error: "Checkout obrigatorio." },
        400,
      );
    }

    const record = await getAuthorizedCheckoutRecord(request, {
      token: checkoutToken,
    });
    if (!record) {
      return jsonResponse({ success: false, error: "Checkout invalido." }, 403);
    }

    const checkout = await getBillingCheckoutState(record.organization.id);
    if (!checkout) {
      return jsonResponse({
        success: true,
        status: "CANCELED",
        outcome: "already_closed",
      });
    }

    if (
      (requestedIntentId && requestedIntentId !== checkout.intent_id) ||
      (requestedPaymentId &&
        requestedPaymentId !== checkout.provider_payment_id &&
        requestedPaymentId !== checkout.payment?.id) ||
      (requestedSubscriptionId &&
        requestedSubscriptionId !== checkout.provider_subscription_id)
    ) {
      return jsonResponse(
        { success: false, error: "Cobranca nao pertence a este checkout." },
        404,
      );
    }

    let paymentId = checkout.provider_payment_id || checkout.payment?.id ||
      null;
    let subscriptionId = checkout.provider_subscription_id || null;
    let alreadyMissing = false;
    let providerAlreadyTerminal = false;
    let providerlessLookupCompleted = false;

    if (!paymentId && !subscriptionId && !checkout.provider_checkout_id) {
      const action = providerlessCheckoutCancellationAction({
        status: checkout.status,
        providerRequestStartedAt: checkout.provider_request_started_at,
        createdAt: checkout.created_at,
        paymentId,
        subscriptionId,
        checkoutId: checkout.provider_checkout_id,
      });
      if (action === "retry_later") {
        const startedAt = Date.parse(
          checkout.provider_request_started_at || checkout.created_at,
        );
        const retryAfterSeconds = Number.isFinite(startedAt)
          ? Math.max(
            1,
            Math.ceil(
              (startedAt + billingCheckoutCancellationGraceMs - Date.now()) /
                1000,
            ),
          )
          : 180;
        return jsonResponse({
          success: false,
          retryable: true,
          retry_after_seconds: retryAfterSeconds,
          outcome: "retry_later",
          error:
            "A cobranca ainda esta sendo conciliada. Tente novamente em instantes.",
        }, 409, { "Retry-After": String(retryAfterSeconds) });
      }

      if (action === "recover_then_cancel") {
        const recovered = await recoverBillingProviderResource(
          checkout.billing_method,
          checkout.external_reference,
        );
        if (recovered?.id) {
          const customerId = recovered.customer ||
            checkout.provider_customer_id ||
            record.organization.asaas_customer_id || "";
          if (!customerId) {
            return jsonResponse({
              success: false,
              retryable: true,
              outcome: "provider_resource_recovered",
              error:
                "A cobranca foi localizada e ainda esta sendo conciliada. Tente novamente em instantes.",
            }, 409);
          }

          if (checkout.billing_method === "CREDIT_CARD") {
            const subscription = recovered as AsaasSubscription;
            subscriptionId = subscription.id;
            await registerBillingCheckoutProvider({
              intentId: checkout.intent_id,
              customerId,
              subscriptionId,
              providerResponse: {
                id: subscription.id,
                status: subscription.status || null,
                nextDueDate: subscription.nextDueDate || null,
                value: subscription.value ?? checkout.amount,
                customer: subscription.customer || customerId,
                externalReference: subscription.externalReference ||
                  checkout.external_reference,
                billingType: "CREDIT_CARD",
              },
            });
          } else {
            const recoveredPayment = recovered as AsaasPayment;
            paymentId = recoveredPayment.id;
            subscriptionId = recoveredPayment.subscription || null;
            await registerBillingCheckoutProvider({
              intentId: checkout.intent_id,
              customerId,
              paymentId,
              subscriptionId,
              providerResponse: recoveredPayment,
            });
            await storeBillingCheckoutPayment({
              intentId: checkout.intent_id,
              organizationId: checkout.organization_id,
              payment: recoveredPayment,
              customerId,
              subscriptionId,
              billingType: checkout.billing_method,
              fallbackValue: checkout.amount,
            });
          }
        } else {
          providerlessLookupCompleted = true;
        }
      }
    }

    if (checkout.billing_method === "CREDIT_CARD" && subscriptionId) {
      const expectedCustomerId = checkout.provider_customer_id ||
        record.organization.asaas_customer_id || "";
      if (!expectedCustomerId || !checkout.external_reference) {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_subscription_snapshot_incomplete",
          "The local subscription cancellation tuple is incomplete.",
        );
      }

      const subscription = await asaasRequest<AsaasSubscription>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      ).catch((error: unknown) => {
        if (!(error instanceof AsaasRequestError) || error.status !== 404) {
          throw error;
        }
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_subscription_not_verified",
          "Provider subscription ownership could not be verified before cancellation.",
        );
      });
      const subscriptionValidation =
        validateBillingCardRecurrenceCancellationTarget({
          subscription,
          subscriptionId,
          externalReference: checkout.external_reference,
          customerId: expectedCustomerId,
          amount: checkout.amount,
          billingPeriodMonths: checkout.billing_period_months,
          nextDueDate: subscription.nextDueDate || "",
        });
      if (subscriptionValidation.outcome === "conflict") {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_subscription_tuple_mismatch",
          "Provider subscription does not match the checkout.",
        );
      }

      let latestPayment: AsaasPayment | null = null;
      if (paymentId) {
        try {
          latestPayment = await asaasRequest<AsaasPayment>(
            `/payments/${encodeURIComponent(paymentId)}`,
          );
        } catch (error) {
          if (!(error instanceof AsaasRequestError) || error.status !== 404) {
            throw error;
          }
        }
      }
      if (!latestPayment) {
        const result = await asaasRequest<AsaasListResponse<AsaasPayment>>(
          subscriptionPaymentsPath(subscriptionId),
        );
        latestPayment = result.data?.find((item) =>
          item.subscription === subscriptionId
        ) || null;
      }
      const action = cardSubscriptionRecoveryAction(
        latestPayment?.status,
        {
          providerRequestStartedAt: checkout.provider_request_started_at,
          createdAt: checkout.created_at,
        },
      );
      if (action === "settled") {
        return jsonResponse(
          {
            success: false,
            error:
              "O pagamento foi confirmado durante o cancelamento e permanece ativo.",
          },
          409,
        );
      }
      if (action === "assisted") {
        return jsonResponse(
          {
            success: false,
            error:
              "A cobranca do cartao exige verificacao do suporte e nao pode ser removida automaticamente.",
          },
          409,
        );
      }
      if (action === "wait") {
        return jsonResponse(
          {
            success: false,
            error:
              "A cobranca do cartao ainda esta sendo processada. Aguarde a confirmacao antes de tentar outro cartao.",
          },
          409,
        );
      }

      if (action === "cancelled") {
        providerAlreadyTerminal = true;
      }
      if (!cardSubscriptionRequiresDeletion(action)) {
        return jsonResponse(
          {
            success: false,
            error:
              "A assinatura ainda nao pode ser removida automaticamente.",
          },
          409,
        );
      }

      const claim = await claimBillingSubscriptionCheckoutCancellation({
        organizationId: checkout.organization_id,
        intentId: checkout.intent_id,
        paymentId,
        subscriptionId,
        leaseOwner: `edge:${crypto.randomUUID()}`,
        leaseSeconds: PAYMENT_CANCELLATION_LEASE_SECONDS,
      });
      if (billingOrganizationIsUnavailable(claim)) {
        return cancellationOrganizationUnavailableResponse();
      }
      if (claim.outcome === "busy") {
        return cancellationBusyResponse(
          Number(claim.retry_after_seconds) || 30,
        );
      }
      if (claim.outcome === "manual_review") {
        return subscriptionCancellationManualReviewResponse();
      }
      if (claim.outcome === "already_finalized") {
        if (claim.final_outcome === "paid_without_recurrence") {
          return paidDuringCancellationResponse();
        }
        if (claim.final_outcome === "manual_review") {
          return subscriptionCancellationManualReviewResponse();
        }
        if (claim.final_outcome === "cancelled") {
          return jsonResponse({
            success: true,
            intent_id: checkout.intent_id,
            payment_id: paymentId,
            subscription_id: subscriptionId,
            status: "CANCELED",
            outcome: "already_cancelled",
          });
        }
      }
      if (claim.outcome === "already_paid") {
        return paidDuringCancellationResponse();
      }

      const cancellationCustomerId = claim.customer_id || "";
      const cancellationExternalReference = claim.external_reference || "";
      const cancellationAmount = Number(claim.amount);
      const cancellationPeriod = Number(claim.billing_period_months);
      const cancellationNextDueDate = claim.next_due_date || "";
      if (
        !["claimed", "already_claimed"].includes(claim.outcome || "") ||
        !claim.claim_token || claim.subscription_id !== subscriptionId ||
        claim.payment_id !== paymentId ||
        cancellationCustomerId !== expectedCustomerId ||
        cancellationExternalReference !== checkout.external_reference ||
        Math.abs(cancellationAmount - checkout.amount) > 0.005 ||
        cancellationPeriod !== checkout.billing_period_months ||
        cancellationNextDueDate !== subscription.nextDueDate
      ) {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_subscription_claim_mismatch",
          `Subscription cancellation claim is invalid: ${claim.outcome}`,
        );
      }
      activeSubscriptionCancellationClaim = {
        organizationId: checkout.organization_id,
        intentId: checkout.intent_id,
        claimToken: claim.claim_token,
        subscriptionId,
      };

      const claimedSubscription = await asaasRequest<AsaasSubscription>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      );
      const claimedSubscriptionValidation =
        validateBillingCardRecurrenceCancellationTarget({
          subscription: claimedSubscription,
          subscriptionId,
          externalReference: cancellationExternalReference,
          customerId: cancellationCustomerId,
          amount: cancellationAmount,
          billingPeriodMonths: cancellationPeriod as 1 | 6 | 12,
          nextDueDate: cancellationNextDueDate,
        });
      if (claimedSubscriptionValidation.outcome === "conflict") {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_subscription_claimed_tuple_mismatch",
          "Claimed provider subscription no longer matches.",
        );
      }
      providerAlreadyTerminal =
        claimedSubscriptionValidation.outcome === "already_absent";

      // A terminal first payment does not prove that the recurring subscription
      // is inactive. Always delete the subscription for both retryable and
      // cancelled payment states so a future cycle cannot be charged.
      if (!providerAlreadyTerminal) {
        alreadyMissing = await deleteProviderResource(
          `/subscriptions/${encodeURIComponent(subscriptionId)}`,
          { exactIdentityVerified: true },
        );
      }
      const providerDeletedAt = new Date();

      const deletedSubscription = await asaasRequest<AsaasSubscription>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      ).catch((error: unknown) => {
        if (!(error instanceof AsaasRequestError) || error.status !== 404) {
          throw error;
        }
        alreadyMissing = true;
        return null;
      });
      if (deletedSubscription) {
        const deletedValidation =
          validateBillingCardRecurrenceCancellationTarget({
            subscription: deletedSubscription,
            subscriptionId,
            externalReference: cancellationExternalReference,
            customerId: cancellationCustomerId,
            amount: cancellationAmount,
            billingPeriodMonths: cancellationPeriod as 1 | 6 | 12,
            nextDueDate: cancellationNextDueDate,
          });
        if (deletedValidation.outcome !== "already_absent") {
          throw new PaymentCancellationProcessingError(
            "retryable",
            "provider_subscription_delete_not_visible",
            "Provider subscription deletion is not visible yet.",
          );
        }
      }

      const reconciliationPaymentId = claim.reconciliation_payment_id ||
        claim.payment_id || paymentId || "";
      if (reconciliationPaymentId) {
        const paymentObservedAt = new Date();
        let postDeletePayment: AsaasPayment | null = null;
        try {
          postDeletePayment = await asaasRequest<AsaasPayment>(
            `/payments/${encodeURIComponent(reconciliationPaymentId)}`,
          );
        } catch (error) {
          if (!(error instanceof AsaasRequestError) || error.status !== 404) {
            throw error;
          }
        }
        if (postDeletePayment) {
          const reconciliation = await reconcileSubscriptionCancellationPayment({
            organizationId: checkout.organization_id,
            payment: postDeletePayment,
            paymentId: reconciliationPaymentId,
            subscriptionId,
            customerId: cancellationCustomerId,
            externalReference: cancellationExternalReference,
            amount: cancellationAmount,
            observedAt: paymentObservedAt,
          });
          if (reconciliation.outcome !== "applied") {
            throw new PaymentCancellationProcessingError(
              "retryable",
              "provider_subscription_payment_reconciliation_failed",
              "The subscription payment reconciliation did not apply.",
            );
          }
        }
      }

      const finalization = await finalizeBillingSubscriptionCheckoutCancellation({
        organizationId: checkout.organization_id,
        intentId: checkout.intent_id,
        claimToken: claim.claim_token,
        subscriptionId,
        providerDeletedAt,
      });
      const finalOutcome = finalization.outcome === "already_finalized"
        ? finalization.final_outcome
        : finalization.outcome;
      if (finalOutcome === "manual_review") {
        return subscriptionCancellationManualReviewResponse();
      }
      if (finalOutcome === "paid_without_recurrence") {
        return paidDuringCancellationResponse();
      }
      if (finalOutcome !== "cancelled") {
        throw new PaymentCancellationProcessingError(
          "retryable",
          "provider_subscription_finalization_failed",
          `Subscription cancellation finalization failed: ${finalOutcome}`,
        );
      }
      return jsonResponse({
        success: true,
        intent_id: checkout.intent_id,
        payment_id: paymentId,
        subscription_id: subscriptionId,
        status: "CANCELED",
        already_missing: alreadyMissing,
        provider_already_terminal: providerAlreadyTerminal,
        outcome: finalOutcome,
      });
    } else if (paymentId) {
      const billingType = checkout.billing_method;
      const expectedCustomerId = checkout.provider_customer_id ||
        record.organization.asaas_customer_id || "";
      const expectedDueDate = checkout.payment?.due_date || "";
      if (
        !["PIX", "BOLETO"].includes(billingType) || !expectedCustomerId ||
        !expectedDueDate || !(Number(checkout.amount) > 0) ||
        !checkout.external_reference
      ) {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_payment_snapshot_incomplete",
          "The local payment cancellation tuple is incomplete.",
        );
      }

      let paymentIdentityVerified = false;
      const preflightObservedAt = new Date();
      let preflightPayment: AsaasPayment;
      try {
        preflightPayment = await asaasRequest<AsaasPayment>(
          `/payments/${encodeURIComponent(paymentId)}`,
        );
      } catch (error) {
        if (error instanceof AsaasRequestError && error.status === 404) {
          if (!paymentIdentityVerified) {
            throw new PaymentCancellationProcessingError(
              "permanent",
              "provider_payment_not_verified",
              "Provider payment ownership could not be verified before cancellation.",
            );
          }
        }
        throw error;
      }
      const preflightReconciliation = await reconcileOneOffPaymentObservation({
        organizationId: checkout.organization_id,
        payment: preflightPayment,
        expectedPaymentId: paymentId,
        expectedCustomerId,
        expectedBillingType: billingType as "PIX" | "BOLETO",
        expectedAmount: Number(checkout.amount),
        expectedDueDate,
        expectedExternalReference: checkout.external_reference,
        observedAt: preflightObservedAt,
        source: "edge_payment_cancellation_preflight",
      });
      paymentIdentityVerified = true;
      if (preflightReconciliation.action === "settled") {
        return paidDuringCancellationResponse();
      }
      if (preflightReconciliation.action === "assisted") {
        return paymentCancellationManualReviewResponse();
      }

      const claim = await claimBillingPaymentCheckoutCancellation({
        organizationId: checkout.organization_id,
        intentId: checkout.intent_id,
        providerPaymentId: paymentId,
        leaseOwner: `edge:${crypto.randomUUID()}`,
        leaseSeconds: PAYMENT_CANCELLATION_LEASE_SECONDS,
      });
      if (billingOrganizationIsUnavailable(claim)) {
        return cancellationOrganizationUnavailableResponse();
      }
      if (claim.outcome === "busy") {
        return cancellationBusyResponse(
          Number(claim.retry_after_seconds) || 30,
        );
      }
      if (claim.outcome === "already_finalized") {
        if (
          claim.final_outcome === "paid_before_delete" ||
          claim.final_outcome === "paid_after_delete"
        ) {
          return paidDuringCancellationResponse();
        }
        if (claim.final_outcome === "manual_review") {
          return paymentCancellationManualReviewResponse();
        }
        if (claim.final_outcome === "cancelled") {
          return jsonResponse({
            success: true,
            intent_id: checkout.intent_id,
            payment_id: paymentId,
            subscription_id: null,
            status: "CANCELED",
            outcome: "already_cancelled",
          });
        }
      }
      if (
        claim.outcome === "already_paid" ||
        claim.final_outcome === "paid_before_delete" ||
        claim.final_outcome === "paid_after_delete"
      ) {
        return paidDuringCancellationResponse();
      }
      if (
        claim.outcome === "manual_review" ||
        claim.final_outcome === "manual_review"
      ) {
        return paymentCancellationManualReviewResponse();
      }
      if (
        !["claimed", "already_claimed", "recover_only"].includes(
          claim.outcome || "",
        ) || !claim.claim_token || claim.payment_id !== paymentId ||
        claim.customer_id !== expectedCustomerId ||
        claim.external_reference !== checkout.external_reference ||
        Math.abs(Number(claim.amount) - Number(checkout.amount)) > 0.005 ||
        claim.billing_type !== billingType ||
        claim.due_date !== expectedDueDate
      ) {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_payment_claim_mismatch",
          `Payment cancellation claim is invalid: ${claim.outcome}`,
        );
      }
      activePaymentCancellationClaim = {
        organizationId: checkout.organization_id,
        intentId: checkout.intent_id,
        claimToken: claim.claim_token,
        paymentId,
      };

      const claimedObservedAt = new Date();
      let claimedPayment: AsaasPayment;
      try {
        claimedPayment = await asaasRequest<AsaasPayment>(
          `/payments/${encodeURIComponent(paymentId)}`,
        );
      } catch (error) {
        if (error instanceof AsaasRequestError && error.status === 404) {
          if (!paymentIdentityVerified) {
            throw new PaymentCancellationProcessingError(
              "permanent",
              "provider_payment_not_verified",
              "Provider payment ownership could not be verified after claim.",
            );
          }
          throw new PaymentCancellationProcessingError(
            "retryable",
            "provider_payment_claimed_snapshot_missing",
            "Provider payment disappeared before the delete fence.",
          );
        }
        throw error;
      }
      const reconciliation = await reconcileOneOffPaymentObservation({
        organizationId: checkout.organization_id,
        payment: claimedPayment,
        expectedPaymentId: paymentId,
        expectedCustomerId,
        expectedBillingType: billingType as "PIX" | "BOLETO",
        expectedAmount: Number(checkout.amount),
        expectedDueDate,
        expectedExternalReference: checkout.external_reference,
        observedAt: claimedObservedAt,
        source: "edge_payment_cancellation_claimed_preflight",
      });
      if (reconciliation.outcome !== "applied") {
        throw new PaymentCancellationProcessingError(
          "retryable",
          "provider_payment_reconciliation_mismatch",
          "The claimed payment snapshot was not applied.",
        );
      }
      if (reconciliation.action === "settled") {
        const paidFinalization = await finalizeBillingPaymentCheckoutCancellation(
          {
            organizationId: checkout.organization_id,
            intentId: checkout.intent_id,
            claimToken: claim.claim_token,
            providerPaymentId: paymentId,
            providerDeleteResult: "paid",
            providerDeletedAt: null,
          },
        );
        const paidOutcome = paidFinalization.outcome === "already_finalized"
          ? paidFinalization.final_outcome
          : paidFinalization.outcome;
        if (
          paidOutcome !== "paid_before_delete" &&
          paidOutcome !== "paid_after_delete"
        ) {
          throw new PaymentCancellationProcessingError(
            "retryable",
            "provider_paid_finalization_failed",
            `Paid cancellation finalization failed: ${paidOutcome}`,
          );
        }
        return paidDuringCancellationResponse();
      }
      if (reconciliation.action === "assisted") {
        throw new PaymentCancellationProcessingError(
          "permanent",
          "provider_payment_status_requires_assistance",
          "Provider payment cancellation requires assisted review.",
        );
      }
      providerAlreadyTerminal = reconciliation.action === "cancelled";

      if (!providerAlreadyTerminal) {
        const deleteStart = await markBillingPaymentCheckoutCancellationDeleteStarted(
          {
            organizationId: checkout.organization_id,
            intentId: checkout.intent_id,
            claimToken: claim.claim_token,
            providerPaymentId: paymentId,
          },
        );
        if (deleteStart.outcome === "busy") {
          return cancellationBusyResponse(
            Number(deleteStart.retry_after_seconds) || 30,
          );
        }
        if (deleteStart.outcome === "paid_before_delete") {
          return paidDuringCancellationResponse();
        }
        if (deleteStart.outcome === "already_cancelled") {
          return jsonResponse({
            success: true,
            intent_id: checkout.intent_id,
            payment_id: paymentId,
            subscription_id: null,
            status: "CANCELED",
            outcome: "already_cancelled",
          });
        }
        if (deleteStart.outcome === "manual_review") {
          return paymentCancellationManualReviewResponse();
        }
        if (deleteStart.outcome === "already_started") {
          throw new PaymentCancellationProcessingError(
            "retryable",
            "provider_payment_delete_outcome_unknown",
            "A prior provider payment deletion request is still reconciling.",
          );
        }
        if (deleteStart.outcome !== "proceed") {
          throw new PaymentCancellationProcessingError(
            "retryable",
            "provider_payment_delete_fence_lost",
            `Provider payment deletion fence failed: ${deleteStart.outcome}`,
          );
        }

        let providerDeleteResult: "deleted" | "not_found" = "deleted";
        try {
          const deletion = await asaasRequest<AsaasDeleteResponse>(
            `/payments/${encodeURIComponent(paymentId)}`,
            { method: "DELETE" },
          );
          if (deletion.id !== paymentId || deletion.deleted !== true) {
            throw new PaymentCancellationProcessingError(
              "permanent",
              "provider_payment_delete_response_invalid",
              "Provider payment deletion response is invalid.",
            );
          }
        } catch (error) {
          if (error instanceof AsaasRequestError && error.status === 404) {
            providerDeleteResult = "not_found";
            alreadyMissing = true;
          } else {
            throw error;
          }
        }
        const providerDeletedAt = new Date();

        const postDeleteObservedAt = new Date();
        let postDeletePayment: AsaasPayment | null = null;
        try {
          postDeletePayment = await asaasRequest<AsaasPayment>(
            `/payments/${encodeURIComponent(paymentId)}`,
          );
        } catch (error) {
          if (!(error instanceof AsaasRequestError) || error.status !== 404) {
            throw error;
          }
        }
        if (postDeletePayment) {
          const reconciliation = await reconcileOneOffPaymentObservation({
            organizationId: checkout.organization_id,
            payment: postDeletePayment,
            expectedPaymentId: paymentId,
            expectedCustomerId,
            expectedBillingType: billingType as "PIX" | "BOLETO",
            expectedAmount: Number(checkout.amount),
            expectedDueDate,
            expectedExternalReference: checkout.external_reference,
            observedAt: postDeleteObservedAt,
            source: "edge_payment_cancellation_post_delete",
          });
          if (reconciliation.action !== "cancelled") {
            if (reconciliation.action === "settled") {
              const paidAfterDelete = await finalizeBillingPaymentCheckoutCancellation({
                organizationId: checkout.organization_id,
                intentId: checkout.intent_id,
                claimToken: claim.claim_token,
                providerPaymentId: paymentId,
                providerDeleteResult,
                providerDeletedAt,
              });
              const paidAfterDeleteOutcome =
                paidAfterDelete.outcome === "already_finalized"
                  ? paidAfterDelete.final_outcome
                  : paidAfterDelete.outcome;
              if (
                paidAfterDeleteOutcome === "paid_before_delete" ||
                paidAfterDeleteOutcome === "paid_after_delete"
              ) {
                return paidDuringCancellationResponse();
              }
            }
            throw new PaymentCancellationProcessingError(
              "retryable",
              "provider_payment_delete_not_visible",
              "Provider payment deletion is not visible yet.",
            );
          }
        }

        const finalization = await finalizeBillingPaymentCheckoutCancellation({
          organizationId: checkout.organization_id,
          intentId: checkout.intent_id,
          claimToken: claim.claim_token,
          providerPaymentId: paymentId,
          providerDeleteResult: postDeletePayment
            ? providerDeleteResult
            : "not_found",
          providerDeletedAt,
        });
        const finalOutcome = finalization.outcome === "already_finalized"
          ? finalization.final_outcome
          : finalization.outcome;
        if (
          finalOutcome === "paid_before_delete" ||
          finalOutcome === "paid_after_delete"
        ) {
          return paidDuringCancellationResponse();
        }
        if (finalOutcome === "manual_review") {
          return paymentCancellationManualReviewResponse();
        }
        if (finalOutcome !== "cancelled") {
          throw new PaymentCancellationProcessingError(
            "retryable",
            "provider_payment_finalization_failed",
            `Payment cancellation finalization failed: ${finalOutcome}`,
          );
        }
        return jsonResponse({
          success: true,
          intent_id: checkout.intent_id,
          payment_id: paymentId,
          subscription_id: null,
          status: "CANCELED",
          already_missing: alreadyMissing,
          provider_already_terminal: false,
          outcome: finalOutcome,
        });
      }

      const alreadyCancelled = await markBillingPaymentCheckoutCancellationDeleteStarted(
        {
          organizationId: checkout.organization_id,
          intentId: checkout.intent_id,
          claimToken: claim.claim_token,
          providerPaymentId: paymentId,
        },
      );
      if (alreadyCancelled.outcome !== "already_cancelled") {
        throw new PaymentCancellationProcessingError(
          "retryable",
          "provider_payment_terminal_finalization_failed",
          `Terminal cancellation finalization failed: ${alreadyCancelled.outcome}`,
        );
      }
      return jsonResponse({
        success: true,
        intent_id: checkout.intent_id,
        payment_id: paymentId,
        subscription_id: null,
        status: "CANCELED",
        already_missing: false,
        provider_already_terminal: true,
        outcome: "already_cancelled",
      });
    } else if (!providerlessLookupCompleted) {
      return jsonResponse(
        {
          success: false,
          error: "A cobranca ainda esta sendo conciliada. Tente novamente em instantes.",
        },
        409,
      );
    }

    const cancellation = await cancelBillingCheckoutResource({
      organizationId: record.organization.id,
      intentId: checkout.intent_id,
      paymentId,
      subscriptionId,
    });
    if (cancellation.outcome === "already_paid") {
      return jsonResponse(
        {
          success: false,
          error:
            "O pagamento foi confirmado durante o cancelamento e permanece ativo.",
        },
        409,
      );
    }
    if (cancellation.outcome === "retry_later") {
      const retryAfterSeconds = Math.max(
        1,
        Number(cancellation.retry_after_seconds) || 1,
      );
      return jsonResponse({
        success: false,
        retryable: true,
        retry_after_seconds: retryAfterSeconds,
        outcome: "retry_later",
        error:
          "A cobranca ainda esta sendo conciliada. Tente novamente em instantes.",
      }, 409, { "Retry-After": String(retryAfterSeconds) });
    }
    if (cancellation.outcome === "resource_registered") {
      return jsonResponse({
        success: false,
        retryable: true,
        outcome: "resource_registered",
        payment_id: cancellation.payment_id || null,
        subscription_id: cancellation.subscription_id || null,
        checkout_id: cancellation.checkout_id || null,
        error:
          "A cobranca foi registrada durante a conciliacao. Atualize o checkout e tente novamente.",
      }, 409);
    }

    return jsonResponse({
      success: true,
      intent_id: checkout.intent_id,
      payment_id: paymentId,
      subscription_id: subscriptionId,
      status: "CANCELED",
      already_missing: alreadyMissing,
      provider_already_terminal: providerAlreadyTerminal,
      outcome: cancellation.outcome || "cancelled",
    });
  } catch (error) {
    if (activeSubscriptionCancellationClaim) {
      const failure = paymentCancellationFailure(error);
      try {
        const failureOutcome = await failBillingSubscriptionCheckoutCancellation({
          organizationId: activeSubscriptionCancellationClaim.organizationId,
          intentId: activeSubscriptionCancellationClaim.intentId,
          claimToken: activeSubscriptionCancellationClaim.claimToken,
          failureClass: failure.failureClass,
          errorCode: failure.errorCode,
        });
        const finalOutcome = failureOutcome.outcome === "already_finalized"
          ? failureOutcome.final_outcome
          : failureOutcome.outcome;
        if (finalOutcome === "manual_review") {
          return subscriptionCancellationManualReviewResponse();
        }
        if (finalOutcome === "paid_without_recurrence") {
          return paidDuringCancellationResponse();
        }
        if (finalOutcome === "cancelled") {
          return jsonResponse({
            success: true,
            intent_id: activeSubscriptionCancellationClaim.intentId,
            payment_id: null,
            subscription_id: activeSubscriptionCancellationClaim.subscriptionId,
            status: "CANCELED",
            outcome: "cancelled",
          });
        }
      } catch (failureError) {
        console.error("Subscription cancellation failure could not be fenced.", {
          intentId: activeSubscriptionCancellationClaim.intentId,
          message: failureError instanceof Error
            ? failureError.message
            : "unknown",
        });
      }
    }
    if (activePaymentCancellationClaim) {
      const failure = paymentCancellationFailure(error);
      try {
        const failureOutcome = await failBillingPaymentCheckoutCancellation({
          organizationId: activePaymentCancellationClaim.organizationId,
          intentId: activePaymentCancellationClaim.intentId,
          claimToken: activePaymentCancellationClaim.claimToken,
          failureClass: failure.failureClass,
          errorCode: failure.errorCode,
        });
        const finalOutcome = failureOutcome.outcome === "already_finalized"
          ? failureOutcome.final_outcome
          : failureOutcome.outcome;
        if (finalOutcome === "manual_review") {
          return paymentCancellationManualReviewResponse();
        }
        if (
          finalOutcome === "paid_before_delete" ||
          finalOutcome === "paid_after_delete"
        ) {
          return paidDuringCancellationResponse();
        }
        if (finalOutcome === "cancelled") {
          return jsonResponse({
            success: true,
            intent_id: activePaymentCancellationClaim.intentId,
            payment_id: activePaymentCancellationClaim.paymentId,
            subscription_id: null,
            status: "CANCELED",
            outcome: "cancelled",
          });
        }
      } catch (failureError) {
        console.error("Payment cancellation failure could not be fenced.", {
          intentId: activePaymentCancellationClaim.intentId,
          message: failureError instanceof Error
            ? failureError.message
            : "unknown",
        });
      }
    }
    console.error("Failed to cancel Asaas checkout resource.", {
      status: error instanceof AsaasRequestError ? error.status : 500,
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse(
      {
        success: false,
        error: "Nao foi possivel cancelar a cobranca agora.",
      },
      error instanceof AsaasRequestError && error.status >= 400 &&
          error.status < 500
        ? error.status
        : 503,
    );
  }
});
