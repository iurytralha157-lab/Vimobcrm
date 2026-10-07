import { handleOptions, jsonResponse } from "../_shared/google-calendar.ts";

// Legacy Google push channels may keep notifying this URL until they expire.
// Vimob is now the source of truth; acknowledge those requests without
// reading Google events, queuing pull jobs, or changing schedule events.
Deno.serve((req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method === "GET") {
    return jsonResponse({ ok: true, service: "google-calendar-webhook", inbound_sync: false });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Metodo nao permitido." }, 405);
  }

  return jsonResponse({ ok: true, ignored: true, reason: "INBOUND_SYNC_DISABLED" });
});
