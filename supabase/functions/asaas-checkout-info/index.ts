import {
  getCheckoutRecord,
  handleOptions,
  jsonResponse,
} from "../_shared/asaas.ts";

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
    const record = await getCheckoutRecord({ token, organizationId });

    if (!record) {
      return jsonResponse({ error: "Checkout nao encontrado." }, 404);
    }

    return jsonResponse({
      organization: {
        id: record.organization.id,
        name: record.organization.name,
        logo_url: record.organization.logo_url,
        primary_color: null,
        subscription_status: record.organization.subscription_status,
        subscription_value: record.organization.subscription_value,
      },
      plan: record.plan,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Erro ao carregar checkout.",
      },
      500,
    );
  }
});
