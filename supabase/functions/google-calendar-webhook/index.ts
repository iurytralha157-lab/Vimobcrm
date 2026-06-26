import {
  enqueueSyncJob,
  errorMessage,
  handleOptions,
  jsonResponse,
  sha256Hex,
  supabase,
} from "../_shared/google-calendar.ts";

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method === "GET") {
    return jsonResponse({ ok: true, service: "google-calendar-webhook" });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const channelId = req.headers.get("x-goog-channel-id") || "";
    const channelToken = req.headers.get("x-goog-channel-token") || "";
    const resourceState = req.headers.get("x-goog-resource-state") || "";
    const resourceId = req.headers.get("x-goog-resource-id") || "";

    if (!channelId || !channelToken) {
      return jsonResponse({ ok: false, error: "Headers Google ausentes." }, 400);
    }

    const { data: channel, error } = await supabase
      .from("google_calendar_channels")
      .select("*")
      .eq("channel_id", channelId)
      .is("stopped_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) throw error;
    if (!channel) {
      return jsonResponse({ ok: true, ignored: true, reason: "UNKNOWN_CHANNEL" });
    }

    const tokenHash = await sha256Hex(channelToken);
    if (tokenHash !== channel.token_hash) {
      return jsonResponse({ ok: false, error: "Token do canal invalido." }, 403);
    }

    if (resourceId && channel.resource_id && resourceId !== channel.resource_id) {
      return jsonResponse({ ok: true, ignored: true, reason: "RESOURCE_MISMATCH" });
    }

    await enqueueSyncJob({
      organizationId: channel.organization_id,
      connectionId: channel.connection_id,
      action: "pull_incremental",
      payload: {
        channel_id: channelId,
        resource_id: resourceId,
        resource_state: resourceState,
      },
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("google-calendar-webhook error", error);
    return jsonResponse({ ok: false, error: errorMessage(error) }, 500);
  }
});
