import { vimobAPIRequest, vimobPublicAPIRequest } from "./vimob-client";
import {
  parseDomainInput,
  paymentCheckoutQuerySchema,
  paymentMutationInputSchema,
  paymentStatusQuerySchema,
  subscriptionChargeInputSchema,
} from "@/lib/validation";

export const paymentsAPI = {
  checkoutInfo<T>(
    query: { token?: string | null; organization_id?: string | null },
  ) {
    const validatedQuery = parseDomainInput(
      paymentCheckoutQuerySchema,
      query,
      "payments.checkout-info",
    );
    return vimobPublicAPIRequest<T>("/v1/public/payments/checkout-info", {
      query: validatedQuery,
      cache: "no-store",
    });
  },

  checkoutBillingProfile<T>(organizationId: string) {
    const validatedQuery = parseDomainInput(
      paymentCheckoutQuerySchema,
      { organization_id: organizationId },
      "payments.checkout-billing-profile",
    );
    return vimobAPIRequest<T>("/v1/public/payments/checkout-info", {
      query: validatedQuery,
      cache: "no-store",
    });
  },

  paymentStatus<T>(
    input: {
      checkoutToken?: string | null;
      organizationId?: string | null;
      intentId?: string | null;
      paymentId?: string | null;
      subscriptionId?: string | null;
      cardUpdateJobId?: string | null;
    } | string,
    legacyCheckoutToken?: string,
  ) {
    const normalizedInput = typeof input === "string"
      ? { checkoutToken: legacyCheckoutToken || "", paymentId: input }
      : input;
    const query = parseDomainInput(paymentStatusQuerySchema, {
      checkout_token: normalizedInput.checkoutToken,
      organization_id: "organizationId" in normalizedInput
        ? normalizedInput.organizationId
        : undefined,
      intent_id: "intentId" in normalizedInput
        ? normalizedInput.intentId
        : undefined,
      payment_id: "paymentId" in normalizedInput
        ? normalizedInput.paymentId
        : undefined,
      subscription_id: "subscriptionId" in normalizedInput
        ? normalizedInput.subscriptionId
        : undefined,
      card_update_job_id: "cardUpdateJobId" in normalizedInput
        ? normalizedInput.cardUpdateJobId
        : undefined,
    }, "payments.status");
    if (query.organization_id) {
      return vimobAPIRequest<T>("/v1/public/payments/status", {
        query,
        cache: "no-store",
        organizationId: query.organization_id,
      });
    }
    return vimobPublicAPIRequest<T>("/v1/public/payments/status", {
      query,
      cache: "no-store",
    });
  },

  createCharge<T>(body: Record<string, unknown>) {
    const input = parseDomainInput(
      subscriptionChargeInputSchema,
      body,
      "payments.charge",
    );
    if (input.organization_id) {
      return vimobAPIRequest<T>("/v1/public/payments/charge", {
        method: "POST",
        body: input,
        timeoutMs: 105_000,
        organizationId: input.organization_id,
      });
    }
    return vimobPublicAPIRequest<T>("/v1/public/payments/charge", {
      method: "POST",
      body: input,
      timeoutMs: 105_000,
    });
  },

  cancelPayment<T>(body: Record<string, unknown>) {
    const input = parseDomainInput(
      paymentMutationInputSchema,
      body,
      "payments.cancel",
    );
    if (input.organization_id) {
      return vimobAPIRequest<T>("/v1/public/payments/cancel", {
        method: "POST",
        body: input,
        organizationId: input.organization_id,
      });
    }
    return vimobPublicAPIRequest<T>("/v1/public/payments/cancel", {
      method: "POST",
      body: input,
    });
  },
};
