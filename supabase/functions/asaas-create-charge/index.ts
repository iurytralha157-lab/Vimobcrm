import {
  AsaasRequestError,
  activateOrganizationPayment,
  asaasRequest,
  ensureAsaasCustomer,
  getCheckoutRecord,
  getCheckoutValue,
  getClientIp,
  getSupabaseAdmin,
  handleOptions,
  isoDateFromNow,
  jsonResponse,
  normalizeAsaasPhone,
  onlyDigits,
  type AsaasPayment,
  type AsaasPixQrCode,
  type AsaasSubscription,
} from "../_shared/asaas.ts";

type ChargeRequest = {
  billing_type?: "PIX" | "CREDIT_CARD";
  holder_email?: string;
  holder_cpf_cnpj?: string;
  holder_phone?: string;
  checkout_token?: string;
  organization_id?: string | null;
  holder_name?: string;
  card_number?: string;
  expiry_month?: string;
  expiry_year?: string;
  ccv?: string;
  holder_postal_code?: string;
  holder_address_number?: string;
};

function normalizeExpiryYear(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (digits.length === 2) {
    return `20${digits}`;
  }

  return digits;
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  try {
    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "Metodo nao permitido." }, 405);
    }

    const body = (await request.json()) as ChargeRequest;
    const record = await getCheckoutRecord({
      token: body.checkout_token,
      organizationId: body.organization_id,
    });

    if (!record) {
      return jsonResponse({ success: false, error: "Checkout nao encontrado." }, 404);
    }

    if (body.billing_type !== "PIX" && body.billing_type !== "CREDIT_CARD") {
      return jsonResponse({ success: false, error: "Forma de pagamento invalida." }, 400);
    }

    if (!body.holder_email || !body.holder_cpf_cnpj) {
      return jsonResponse(
        { success: false, error: "Informe e-mail e CPF/CNPJ do titular." },
        400,
      );
    }

    const value = getCheckoutValue(record);
    if (!value || value <= 0) {
      return jsonResponse({ success: false, error: "Plano sem valor para cobranca." }, 400);
    }

    const supabase = getSupabaseAdmin();
    const customerId = await ensureAsaasCustomer({
      organization: record.organization,
      holderEmail: body.holder_email,
      holderCpfCnpj: body.holder_cpf_cnpj,
      holderPhone: body.holder_phone,
    });
    const description = `Vimob - ${record.plan?.name || record.organization.name}`;

    if (body.billing_type === "PIX") {
      const payment = await asaasRequest<AsaasPayment>("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: customerId,
          billingType: "PIX",
          value,
          dueDate: isoDateFromNow(1),
          description,
          externalReference: record.organization.id,
        }),
      });
      const pix = await asaasRequest<AsaasPixQrCode>(`/payments/${payment.id}/pixQrCode`);

      await supabase.from("asaas_payments").upsert(
        {
          organization_id: record.organization.id,
          asaas_payment_id: payment.id,
          asaas_customer_id: customerId,
          asaas_subscription_id: payment.subscription || null,
          billing_type: "PIX",
          status: payment.status || null,
          value: payment.value ?? value,
          net_value: payment.netValue ?? null,
          due_date: payment.dueDate || null,
          payment_date: payment.paymentDate || null,
          invoice_url: payment.invoiceUrl || null,
          raw_event: payment,
        },
        { onConflict: "asaas_payment_id" },
      );

      return jsonResponse({
        success: true,
        type: "PIX",
        payment_id: payment.id,
        invoice_url: payment.invoiceUrl || "",
        qr_code: pix.encodedImage || "",
        qr_payload: pix.payload || "",
        value,
      });
    }

    const requiredCardFields = [
      body.holder_name,
      body.card_number,
      body.expiry_month,
      body.expiry_year,
      body.ccv,
      body.holder_postal_code,
      body.holder_address_number,
    ];

    if (requiredCardFields.some((field) => !field)) {
      return jsonResponse(
        { success: false, error: "Preencha todos os dados do cartao e titular." },
        400,
      );
    }

    const subscription = await asaasRequest<AsaasSubscription>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "CREDIT_CARD",
        value,
        nextDueDate: isoDateFromNow(0),
        cycle: "MONTHLY",
        description,
        externalReference: record.organization.id,
        creditCard: {
          holderName: body.holder_name,
          number: onlyDigits(body.card_number),
          expiryMonth: body.expiry_month,
          expiryYear: normalizeExpiryYear(body.expiry_year),
          ccv: body.ccv,
        },
        creditCardHolderInfo: {
          name: body.holder_name,
          email: body.holder_email,
          cpfCnpj: onlyDigits(body.holder_cpf_cnpj),
          postalCode: onlyDigits(body.holder_postal_code),
          addressNumber: body.holder_address_number,
          phone: normalizeAsaasPhone(body.holder_phone),
          mobilePhone: normalizeAsaasPhone(body.holder_phone),
        },
        remoteIp: getClientIp(request),
      }),
    });

    await activateOrganizationPayment({
      organizationId: record.organization.id,
      providerCustomerId: customerId,
      providerSubscriptionId: subscription.id,
    });

    return jsonResponse({
      success: true,
      type: "CREDIT_CARD",
      subscription_id: subscription.id,
      status: subscription.status || "ACTIVE",
      next_due_date: subscription.nextDueDate || isoDateFromNow(30),
      value: subscription.value ?? value,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro ao processar pagamento.",
      },
      error instanceof AsaasRequestError ? error.status : 500,
    );
  }
});
