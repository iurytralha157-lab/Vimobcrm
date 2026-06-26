import {
  AsaasRequestError,
  asaasRequest,
  getSupabaseAdmin,
  handleOptions,
  isPaidStatus,
  jsonResponse,
} from "../_shared/asaas.ts";

type CancelPaymentRequest = {
  payment_id?: string;
  checkout_token?: string;
};

type AsaasDeletePaymentResponse = {
  id?: string;
  deleted?: boolean;
};

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "POST" && request.method !== "DELETE") {
      return jsonResponse({ success: false, error: "Metodo nao permitido." }, 405);
    }

    const body = (await request.json()) as CancelPaymentRequest;
    const paymentId = body.payment_id?.trim();
    const checkoutToken = body.checkout_token?.trim();

    if (!paymentId || !checkoutToken) {
      return jsonResponse(
        { success: false, error: "Pagamento e checkout sao obrigatorios." },
        400,
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: paymentRow, error: paymentError } = await supabase
      .from("asaas_payments")
      .select("organization_id,status")
      .eq("asaas_payment_id", paymentId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!paymentRow?.organization_id) {
      return jsonResponse({ success: false, error: "Cobranca nao encontrada." }, 404);
    }

    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select("id,checkout_token")
      .eq("id", paymentRow.organization_id)
      .maybeSingle();

    if (organizationError) throw organizationError;
    if (!organization || organization.checkout_token !== checkoutToken) {
      return jsonResponse({ success: false, error: "Checkout invalido para esta cobranca." }, 403);
    }

    if (isPaidStatus(paymentRow.status)) {
      return jsonResponse(
        { success: false, error: "Esta cobranca ja foi confirmada e nao pode ser cancelada." },
        409,
      );
    }

    const result = await asaasRequest<AsaasDeletePaymentResponse>(`/payments/${paymentId}`, {
      method: "DELETE",
    });

    await supabase
      .from("asaas_payments")
      .update({
        status: "CANCELED",
        raw_event: {
          action: "payment_cancelled_by_checkout",
          provider_response: result,
        },
      })
      .eq("asaas_payment_id", paymentId);

    return jsonResponse({
      success: true,
      payment_id: paymentId,
      status: "CANCELED",
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao cancelar cobranca.",
      },
      error instanceof AsaasRequestError ? error.status : 500,
    );
  }
});
