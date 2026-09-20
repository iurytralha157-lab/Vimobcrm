/**
 * Retired legacy WhatsApp notifier.
 *
 * External notification delivery is owned by the durable backend dispatcher.
 * Keeping the former direct provider sender here would reintroduce a second
 * delivery authority with no atomic outbox/binding boundary. This tombstone is
 * intentionally free of database clients, provider I/O and secrets so an
 * accidental publication fails closed.
 */

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "whatsapp_notifier_retired",
      message: "WhatsApp notification delivery is handled by the backend dispatcher.",
    }),
    { status: 410, headers: responseHeaders },
  );
});
