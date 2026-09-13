const retiredHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Public site contacts are accepted exclusively by the Go API, which provides
 * durable idempotency, rate limiting, canonical property attribution and the
 * current distribution contract. This deterministic tombstone prevents an old
 * Edge deployment from restoring a second privileged lead writer.
 */
export function serveRetiredPublicSiteContact(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: retiredHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "public_site_contact_endpoint_retired",
      error: "Esta rota foi desativada. Use a API publica atual do Vimob.",
      replacement: "/v1/public/site/contact",
    }),
    { status: 410, headers: retiredHeaders },
  );
}

Deno.serve(serveRetiredPublicSiteContact);
