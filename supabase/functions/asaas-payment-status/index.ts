import {
  AsaasRequestError,
  activateOrganizationPayment,
  asaasRequest,
  getSupabaseAdmin,
  handleOptions,
  isPaidStatus,
  jsonResponse,
  type AsaasPayment,
} from "../_shared/asaas.ts";

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "GET") {
      return jsonResponse({ error: "Metodo nao permitido." }, 405);
    }

    const url = new URL(request.url);
    const paymentId = url.searchParams.get("payment_id");

    if (!paymentId) {
      return jsonResponse({ error: "payment_id obrigatorio." }, 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: paymentRow } = await supabase
      .from("asaas_payments")
      .select("organization_id,status,asaas_customer_id,asaas_subscription_id")
      .eq("asaas_payment_id", paymentId)
      .maybeSingle();

    if (paymentRow?.organization_id && isPaidStatus(paymentRow.status)) {
      await activateOrganizationPayment({
        organizationId: paymentRow.organization_id,
        providerCustomerId: paymentRow.asaas_customer_id || null,
        providerSubscriptionId: paymentRow.asaas_subscription_id || null,
      });

      return jsonResponse({
        payment: {
          status: paymentRow.status,
        },
      });
    }

    const payment = await asaasRequest<AsaasPayment>(`/payments/${paymentId}`);

    await supabase
      .from("asaas_payments")
      .update({
        status: payment.status || null,
        asaas_customer_id: payment.customer || null,
        asaas_subscription_id: payment.subscription || null,
        billing_type: payment.billingType || null,
        value: payment.value ?? null,
        net_value: payment.netValue ?? null,
        due_date: payment.dueDate || null,
        payment_date: payment.paymentDate || null,
        invoice_url: payment.invoiceUrl || null,
        raw_event: payment,
      })
      .eq("asaas_payment_id", paymentId);

    if (paymentRow?.organization_id && isPaidStatus(payment.status)) {
      await activateOrganizationPayment({
        organizationId: paymentRow.organization_id,
        providerCustomerId: payment.customer || null,
        providerSubscriptionId: payment.subscription || null,
      });
    }

    return jsonResponse({
      payment: {
        status: payment.status,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Erro ao consultar pagamento.",
      },
      error instanceof AsaasRequestError ? error.status : 500,
    );
  }
});
