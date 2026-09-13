const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

/**
 * The former one-off importer wrote public Storage objects and legacy property
 * columns directly. That bypassed the canonical private upload-intent,
 * property_assets, cleanup-outbox and 20-photo contracts. Keep a deterministic
 * tombstone while the function remains deployed so no caller can revive that
 * unsafe media path accidentally.
 */
export function handleRequest(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "legacy_property_media_migration_retired",
      error: "Esta migracao de imagens foi desativada.",
      replacement: [
        "POST /v1/properties/{id}/assets/upload-intents",
        "POST /v1/properties/{id}/assets",
      ],
    }),
    { status: 410, headers: responseHeaders },
  );
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
