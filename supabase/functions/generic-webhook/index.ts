const retiredHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * The authenticated Go ingress owns generic lead webhooks now. Keeping this
 * legacy Edge endpoint as a side-effect-free tombstone gives old callers a
 * deterministic cutover signal without touching credentials or tenant data.
 */
export function serveRetiredGenericWebhook(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: retiredHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "generic_webhook_endpoint_retired",
      error: "Esta rota foi desativada. Use o endpoint publico atual do Vimob.",
      replacement: "/v1/public/webhooks/generic",
    }),
    { status: 410, headers: retiredHeaders },
  );
}

Deno.serve(serveRetiredGenericWebhook);
