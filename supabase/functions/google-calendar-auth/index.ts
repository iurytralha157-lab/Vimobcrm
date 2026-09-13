const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/**
 * This legacy endpoint encoded the user id and return URL directly in OAuth
 * state and persisted Google tokens in plaintext columns. The supported flow
 * is google-calendar-oauth, which uses a hashed, single-use state and Vault.
 */
export function handleRequest(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse(
    {
      ok: false,
      code: "legacy_google_calendar_endpoint_retired",
      message: "This Google Calendar endpoint has been retired.",
    },
    410,
  );
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
