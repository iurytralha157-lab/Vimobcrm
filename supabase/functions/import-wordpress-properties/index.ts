const retiredHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * WordPress imports have no active CRM consumer and must not retain a public
 * privileged write path. A future importer belongs behind the authenticated
 * Go API with tenant authorization, a validated DTO, and an explicit limit.
 */
export function serveRetiredWordPressPropertyImport(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: retiredHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "wordpress_property_import_retired",
      error: "Esta rota de importacao foi desativada.",
    }),
    { status: 410, headers: retiredHeaders },
  );
}

Deno.serve(serveRetiredWordPressPropertyImport);
