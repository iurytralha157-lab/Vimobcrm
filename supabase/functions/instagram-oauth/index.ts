const retiredHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Instagram OAuth is owned by the authenticated Go integration endpoints.
 * This legacy callback used an unsigned state value and must never exchange,
 * persist, or return provider credentials again.
 */
export function serveRetiredInstagramOAuth(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: retiredHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "instagram_oauth_endpoint_retired",
      error: "Esta rota foi desativada. Use a integracao Meta atual do Vimob.",
    }),
    { status: 410, headers: retiredHeaders },
  );
}

Deno.serve(serveRetiredInstagramOAuth);
