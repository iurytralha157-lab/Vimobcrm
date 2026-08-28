const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The legacy function used to accept arbitrary recipients and templates while
 * holding the Resend API key. Email delivery now happens only through the
 * authenticated Go notification outbox, so this public relay must stay closed.
 */
export function handleRequest(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse(
    {
      ok: false,
      code: "legacy_email_endpoint_retired",
      message: "This email endpoint has been retired.",
    },
    410,
  );
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
