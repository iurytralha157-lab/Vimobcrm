import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Compatibility adapter for legacy server-to-server callers.
 *
 * Template resolution, rendering, sanitization, dedupe and the durable insert
 * all belong to notification-dispatcher. This adapter performs no provider or
 * database I/O of its own.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(
      { success: false, queued: false, error: "method_not_allowed" },
      405,
    );
  }
  if (!authorizePrivateWorkerRequest(req)) {
    return json({ success: false, queued: false, error: "unauthorized" }, 401);
  }

  let body: JsonRecord;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) {
      return json(
        { success: false, queued: false, error: "invalid_payload" },
        400,
      );
    }
    body = parsed;
  } catch {
    return json({ success: false, queued: false, error: "invalid_json" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        success: false,
        queued: false,
        error: "notification_queue_unavailable",
      },
      503,
    );
  }

  const payload: JsonRecord = {
    event_key: firstText(
      body.event_key,
      body.eventKey,
      body.template_slug,
      body.templateSlug,
    ),
    organization_id: firstText(body.organization_id, body.organizationId),
    user_id: firstText(body.user_id, body.userId),
    lead_id: firstText(body.lead_id, body.leadId) || null,
    recipient: firstText(body.recipient) || null,
    variables: body.variables,
    dedupe_key: firstText(body.dedupe_key, body.dedupeKey) || null,
    is_test: body.is_test === true || body.isTest === true,
  };

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/notification-dispatcher`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify(payload),
      },
    );
    const result: unknown = await response.json().catch(() => null);
    if (!isRecord(result)) {
      return json(
        { success: false, queued: false, error: "dispatcher_invalid_response" },
        502,
      );
    }
    return json(result, response.status);
  } catch (error: unknown) {
    console.error(
      "notification_service_adapter_failed",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      { success: false, queued: false, error: "dispatcher_unavailable" },
      502,
    );
  }
});
