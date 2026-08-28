import {
  getBillingCheckoutState,
  getAuthorizedCheckoutRecord,
  handleOptions,
  isPaidStatus,
  jsonResponse,
  publicBillingCheckoutState,
} from "../_shared/asaas.ts";
import {
  asaasPaymentCheckoutState,
} from "../_shared/asaas-billing-intent.ts";
import {
  type BillingCardRecurrenceState,
  publicBillingCardRecurrenceState,
} from "../_shared/asaas-card-recurrence.ts";

type CheckoutRecord = NonNullable<
  Awaited<ReturnType<typeof getAuthorizedCheckoutRecord>>
>;

function safeCardRecurrenceStatus(
  value: string | null | undefined,
): BillingCardRecurrenceState | null {
  const recurrenceStatus = value?.trim().toLowerCase() || "";
  if (
    [
      "prepared",
      "creating",
      "recovering",
      "completed",
      "failed",
      "cancelled",
    ].includes(recurrenceStatus)
  ) {
    return recurrenceStatus as BillingCardRecurrenceState;
  }
  return null;
}

function paymentScopedCheckout(
  record: CheckoutRecord,
  paymentStatus: string | null,
) {
  if (record.access.scope !== "payment") return null;

  const checkoutState = asaasPaymentCheckoutState(paymentStatus, {
    bankSlipArtifactInvalid:
      record.access.bankSlipRegistrationCancelled === true,
  });
  if (!["pending", "processing", "retry"].includes(checkoutState)) {
    return null;
  }

  return {
    intent_id: record.access.billingIntentId || "",
    plan_id: record.access.planId,
    billing_method: record.access.billingType,
    status: checkoutState,
    billing_period_months: record.access.billingPeriodMonths,
    amount: record.access.paymentAmount,
    payment_id: record.access.providerPaymentId,
    subscription_id: record.access.providerSubscriptionId,
    checkout_id: null,
    provider_status: paymentStatus || null,
    card_last4: null,
    created_at: record.access.paymentUpdatedAt || "",
    updated_at: record.access.paymentUpdatedAt || "",
  };
}

function billingProfileIsComplete(record: CheckoutRecord) {
  const profile = record.billingProfile;
  if (!profile) return false;

  return Boolean(
    profile.name.trim() &&
      profile.email.trim() &&
      profile.cpf_cnpj.trim() &&
      profile.phone.trim() &&
      profile.postal_code.trim() &&
      profile.address.trim() &&
      profile.address_number.trim() &&
      profile.neighborhood.trim() &&
      profile.city.trim() &&
      profile.state.trim(),
  );
}

function canManagePaymentMethod(record: CheckoutRecord) {
  if (record.access.scope !== "organization") return false;

  const subscriptionStatus = record.organization.subscription_status
    ?.trim()
    .toLowerCase();
  return Boolean(
    record.organization.asaas_subscription_id?.trim() &&
      ["active", "trial"].includes(subscriptionStatus || "") &&
      record.organization.plan_id &&
      record.organization.plan_id === record.plan?.id &&
      !record.organization.pending_plan_id,
  );
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Metodo nao permitido." }, 405);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const organizationId = url.searchParams.get("organization_id");
    const record = await getAuthorizedCheckoutRecord(request, {
      token,
      organizationId,
    });

    if (!record) {
      return jsonResponse({ error: "Checkout nao encontrado." }, 404);
    }

    const organizationCheckout = record.access.scope === "organization"
      ? await getBillingCheckoutState(record.organization.id)
      : null;
    const paymentStatus = record.access.scope === "payment"
      ? record.access.paymentStatus
      : organizationCheckout?.payment?.status ||
        organizationCheckout?.provider_status || null;
    const paymentSettled = isPaidStatus(paymentStatus);
    const recurrenceStatus = record.access.scope === "payment"
      ? safeCardRecurrenceStatus(record.access.cardRecurrenceStatus)
      : null;
    const recurrence = record.access.scope === "payment" &&
        record.access.billingType === "CREDIT_CARD"
      ? publicBillingCardRecurrenceState(recurrenceStatus)
      : null;
    const activeCheckout = record.access.scope === "payment"
      ? paymentScopedCheckout(record, paymentStatus)
      : publicBillingCheckoutState(organizationCheckout);
    const completeBillingProfile = billingProfileIsComplete(record);
    const managesPaymentMethod = canManagePaymentMethod(record);

    return jsonResponse({
      organization: {
        id: record.organization.id,
        name: record.organization.name,
        logo_url: record.organization.logo_url,
        primary_color: null,
        subscription_status: record.organization.subscription_status,
        subscription_value: record.organization.subscription_value,
        plan_id: record.organization.plan_id,
        pending_plan_id: record.organization.pending_plan_id,
      },
      plan: record.plan,
      checkout_access: {
        scope: record.access.scope,
        can_change_plan: record.access.scope === "organization" &&
          !managesPaymentMethod,
        can_manage_payment_method: managesPaymentMethod,
        use_stored_billing_profile: record.access.scope === "organization" &&
          completeBillingProfile,
        payment_status: record.access.scope === "payment"
          ? paymentStatus || null
          : organizationCheckout?.payment?.status ||
            organizationCheckout?.provider_status || null,
        payment_settled: record.access.scope === "payment"
          ? paymentSettled
          : false,
        ...(record.access.scope === "payment"
          ? {
            bank_slip_registration_cancelled:
              record.access.bankSlipRegistrationCancelled === true,
          }
          : {}),
        ...(recurrence || {}),
      },
      active_checkout: activeCheckout,
      ...(organizationId && record.billingProfile
        ? {
          billing_profile: record.billingProfile,
          billing_profile_summary: {
            ...record.billingProfile,
            complete: completeBillingProfile,
          },
        }
        : {}),
    }, 200, {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Authorization",
    });
  } catch (error) {
    console.error("Failed to load checkout information.", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return jsonResponse(
      {
        error: "Nao foi possivel carregar o checkout agora.",
      },
      500,
    );
  }
});
