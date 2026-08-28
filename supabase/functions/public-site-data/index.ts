const retiredHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * The public website reads property data from the versioned Go endpoint at
 * /v1/public/site/data. This legacy Edge endpoint must never query the
 * service-role client again: keeping a small tombstone prevents an old caller
 * from receiving a permissive or verbatim property projection.
 */
export function serveRetiredPublicSiteData(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: retiredHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "public_site_data_endpoint_retired",
      error: "Esta rota foi desativada. Use a API publica atual do Vimob.",
    }),
    { status: 410, headers: retiredHeaders },
  );
}

Deno.serve(serveRetiredPublicSiteData);
