import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import { buildNotificationTargetUrl } from "../_shared/notification-target.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

type NotificationTemplate = {
  id: string;
  name: string;
  slug: string;
  event_key: string | null;
  category: string | null;
  channel: string;
  channels: string[] | null;
  title: string | null;
  message: string;
  dedupe_window_seconds: number | null;
  organization_id: string | null;
  updated_at: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const EXTERNAL_CHANNELS = new Set(["whatsapp", "push", "email"]);
const LEAD_PHONE_KEYS = new Set([
  "phone",
  "telefone",
  "whatsapp",
  "lead_phone",
  "leadphone",
  "lead_whatsapp",
  "leadwhatsapp",
  "phone_line",
  "phoneline",
  "contact_phone",
  "contactphone",
  "client_phone",
  "clientphone",
]);

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isLeadScopedNotification(eventKey: string, leadId: string) {
  return Boolean(leadId) || eventKey.toLowerCase().includes("lead");
}

function sanitizeLeadVariables(
  variables: JsonRecord,
  eventKey: string,
  leadId: string,
) {
  if (!isLeadScopedNotification(eventKey, leadId)) return { ...variables };

  return Object.entries(variables).reduce<JsonRecord>((safe, [key, value]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    safe[key] = LEAD_PHONE_KEYS.has(normalizedKey) ? "" : value;
    return safe;
  }, {});
}

function scrubLeadPhoneText(value: string, eventKey: string, leadId: string) {
  if (!isLeadScopedNotification(eventKey, leadId) || !value) return value;

  return value
    .split("\n")
    .filter((line) =>
      !/^\s*(telefone|celular|whats(?:app)?|phone)\s*:/i.test(line)
    )
    .join("\n")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addVariableAliases(variables: JsonRecord) {
  const enriched = { ...variables };
  const alias = (left: string, right: string) => {
    if (enriched[left] && !enriched[right]) enriched[right] = enriched[left];
    if (enriched[right] && !enriched[left]) enriched[left] = enriched[right];
  };
  alias("nome", "user_name");
  alias("lead_name", "nome_lead");
  alias("horario", "time");
  alias("titulo", "title");
  return enriched;
}

function renderTemplate(
  template: string,
  variables: JsonRecord,
  removeOrganizationLabel: boolean,
) {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const placeholder = new RegExp(`\\{\\s*${escapedKey}\\s*\\}`, "gi");
    const text = value === null || value === undefined ? "" : String(value);

    if (key === "organization_name" && removeOrganizationLabel && !text) {
      rendered = rendered
        .replace(
          new RegExp(`(🏢 )?Organização:?\\s*\\{${escapedKey}\\}`, "gi"),
          "",
        )
        .replace(new RegExp(`\\n?🏢\\s*\\{${escapedKey}\\}`, "gi"), "");
    }
    rendered = rendered.replace(placeholder, text);
  }
  return rendered.replace(/\n\n+/g, "\n\n").trim();
}

function normalizeTemplateChannels(template: NotificationTemplate) {
  const configured =
    Array.isArray(template.channels) && template.channels.length > 0
      ? template.channels
      : [template.channel];
  return [
    ...new Set(
      configured
        .map((channel) => boundedText(channel, 40).toLowerCase())
        .filter((channel) =>
          channel === "system" || EXTERNAL_CHANNELS.has(channel)
        ),
    ),
  ];
}

function buildDispatchMetadata(channels: string[]) {
  const dispatch: JsonRecord = {};
  for (const channel of channels) {
    if (!EXTERNAL_CHANNELS.has(channel)) continue;
    dispatch[channel] = {
      required: true,
      status: "pending",
      attempts: 0,
    };
  }
  return dispatch;
}

function testDedupeKey(baseKey: string) {
  const suffix = `:test:${crypto.randomUUID()}`;
  return `${baseKey.slice(0, 180 - suffix.length)}${suffix}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "method_not_allowed" }, 405);
  }
  if (!authorizePrivateWorkerRequest(req)) {
    return json({ success: false, error: "unauthorized" }, 401);
  }

  try {
    const rawBody: unknown = await req.json();
    if (!isRecord(rawBody)) {
      return json({ success: false, error: "invalid_payload" }, 400);
    }

    const eventKey = textValue(rawBody.event_key);
    const organizationId = textValue(rawBody.organization_id);
    const userId = textValue(rawBody.user_id);
    const leadId = textValue(rawBody.lead_id);
    const requestedRecipient = textValue(rawBody.recipient);
    const requestedDedupeKey = textValue(rawBody.dedupe_key);
    const isTest = rawBody.is_test === true;

    if (!EVENT_KEY_RE.test(eventKey)) {
      return json({ success: false, error: "event_key_invalid" }, 400);
    }
    if (!UUID_RE.test(organizationId) || !UUID_RE.test(userId)) {
      return json(
        { success: false, error: "notification_context_invalid" },
        400,
      );
    }
    if (leadId && !UUID_RE.test(leadId)) {
      return json({ success: false, error: "lead_id_invalid" }, 400);
    }
    if (requestedRecipient.length > 180) {
      return json({ success: false, error: "recipient_invalid" }, 400);
    }
    if (requestedDedupeKey.length > 180) {
      return json({ success: false, error: "dedupe_key_invalid" }, 400);
    }
    if (rawBody.variables !== undefined && !isRecord(rawBody.variables)) {
      return json({ success: false, error: "variables_invalid" }, 400);
    }
    if (
      rawBody.recipient !== undefined && rawBody.recipient !== null &&
      typeof rawBody.recipient !== "string"
    ) {
      return json({ success: false, error: "recipient_invalid" }, 400);
    }
    if (
      rawBody.dedupe_key !== undefined && rawBody.dedupe_key !== null &&
      typeof rawBody.dedupe_key !== "string"
    ) {
      return json({ success: false, error: "dedupe_key_invalid" }, 400);
    }

    const rawVariables = isRecord(rawBody.variables) ? rawBody.variables : {};
    if (JSON.stringify(rawVariables).length > 32_000) {
      return json({ success: false, error: "variables_too_large" }, 413);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        { success: false, error: "notification_queue_unavailable" },
        503,
      );
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [organizationResult, userResult, membershipResult, leadResult] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("id, name")
          .eq("id", organizationId)
          .maybeSingle(),
        supabase
          .from("users")
          .select("id")
          .eq("id", userId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", organizationId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle(),
        leadId
          ? supabase
            .from("leads")
            .select("id")
            .eq("id", leadId)
            .eq("organization_id", organizationId)
            .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

    const contextError = organizationResult.error || userResult.error ||
      membershipResult.error || leadResult.error;
    if (contextError) {
      console.error(
        "notification_dispatch_context_lookup_failed",
        contextError.code,
      );
      return json(
        { success: false, error: "notification_context_unavailable" },
        503,
      );
    }
    if (
      !organizationResult.data || !userResult.data || !membershipResult.data ||
      (leadId && !leadResult.data)
    ) {
      return json(
        { success: false, error: "notification_context_invalid" },
        400,
      );
    }

    const templateSelect =
      "id, name, slug, event_key, category, channel, channels, title, message, dedupe_window_seconds, organization_id, updated_at";
    const loadTemplate = (scope: "organization" | "global") => {
      let query = supabase
        .from("notification_templates")
        .select(templateSelect)
        .eq("is_active", true)
        .or(`event_key.eq.${eventKey},slug.eq.${eventKey}`);
      query = scope === "organization"
        ? query.eq("organization_id", organizationId)
        : query.is("organization_id", null);
      return query
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
    };
    const [organizationTemplate, globalTemplate] = await Promise.all([
      loadTemplate("organization"),
      loadTemplate("global"),
    ]);
    const templateError = organizationTemplate.error || globalTemplate.error;
    if (templateError) {
      console.error(
        "notification_dispatch_template_lookup_failed",
        templateError.code,
      );
      return json({
        success: false,
        error: "notification_template_unavailable",
      }, 503);
    }
    const templateData = organizationTemplate.data || globalTemplate.data;
    if (!templateData) {
      return json(
        { success: false, error: "notification_template_not_found" },
        404,
      );
    }
    const template = templateData as NotificationTemplate;

    const safeVariables = sanitizeLeadVariables(
      rawVariables,
      eventKey,
      leadId,
    );
    const enrichedVariables = addVariableAliases(safeVariables);
    const { count: membershipCount, error: membershipCountError } =
      await supabase
        .from("organization_members")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);
    if (membershipCountError) {
      console.error(
        "notification_dispatch_membership_count_failed",
        membershipCountError.code,
      );
      return json(
        { success: false, error: "notification_context_unavailable" },
        503,
      );
    }

    const showOrganizationName = (membershipCount || 0) > 1;
    if (showOrganizationName && !enrichedVariables.organization_name) {
      enrichedVariables.organization_name = organizationResult.data.name || "";
    } else if (!showOrganizationName) {
      enrichedVariables.organization_name = "";
    }

    let formattedMessage = renderTemplate(
      boundedText(template.message, 20_000),
      enrichedVariables,
      !showOrganizationName,
    );
    let formattedTitle = renderTemplate(
      boundedText(template.title, 2_000),
      enrichedVariables,
      !showOrganizationName,
    );
    formattedMessage = scrubLeadPhoneText(formattedMessage, eventKey, leadId);
    formattedTitle = scrubLeadPhoneText(formattedTitle, eventKey, leadId);

    const title = boundedText(formattedTitle || template.name || eventKey, 180);
    const content = boundedText(formattedMessage, 1_000);
    if (!title) {
      return json({ success: false, error: "notification_title_invalid" }, 422);
    }

    const channels = normalizeTemplateChannels(template);
    const dispatch = buildDispatchMetadata(channels);
    if (channels.includes("whatsapp") && content) {
      enrichedVariables.__rendered_whatsapp_message = content;
    }

    const baseDedupeKey = requestedDedupeKey ||
      `${eventKey}:${leadId || userId}:${userId}`;
    const finalDedupeKey = isTest
      ? testDedupeKey(baseDedupeKey)
      : baseDedupeKey;
    const recipientKey = `user:${userId}`;

    const findExisting = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .eq("metadata->>dedupe_key", finalDedupeKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { data, error };
    };

    if (!isTest) {
      const existing = await findExisting();
      if (existing.error) {
        console.error(
          "notification_dispatch_dedupe_lookup_failed",
          existing.error.code,
        );
        return json(
          { success: false, error: "notification_queue_unavailable" },
          503,
        );
      }
      if (existing.data?.id) {
        return json({
          success: true,
          queued: true,
          notification_id: existing.data.id,
          deduplicated: true,
        });
      }
    }

    const metadata: JsonRecord = {
      event_key: eventKey,
      variables: enrichedVariables,
      dedupe_key: finalDedupeKey,
      requested_recipient: requestedRecipient || null,
      recipient_key: recipientKey,
      is_test: isTest,
      source: "legacy_edge_notification_dispatcher",
      template: {
        id: template.id,
        slug: template.slug,
        event_key: template.event_key,
        name: template.name,
        category: template.category,
        channel: template.channel,
        channels,
        dedupe_window_seconds: template.dedupe_window_seconds,
        organization_id: template.organization_id,
        updated_at: template.updated_at,
      },
    };
    if (Object.keys(dispatch).length > 0) metadata.dispatch = dispatch;

    const { data: inserted, error: insertError } = await supabase
      .from("notifications")
      .insert({
        organization_id: organizationId,
        user_id: userId,
        lead_id: leadId || null,
        type: boundedText(template.category, 40) || "info",
        title,
        content: content || null,
        channel: "in_app",
        target_url: buildNotificationTargetUrl(
          eventKey,
          enrichedVariables,
          leadId,
        ),
        is_read: false,
        metadata,
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const existing = await findExisting();
        if (!existing.error && existing.data?.id) {
          return json({
            success: true,
            queued: true,
            notification_id: existing.data.id,
            deduplicated: true,
          });
        }
      }
      console.error("notification_dispatch_enqueue_failed", insertError.code);
      return json(
        { success: false, error: "notification_enqueue_failed" },
        500,
      );
    }

    return json({
      success: true,
      queued: true,
      notification_id: inserted.id,
      deduplicated: false,
    }, 202);
  } catch (error: unknown) {
    console.error(
      "notification_dispatch_unexpected_error",
      error instanceof Error ? error.name : "unknown",
    );
    return json({ success: false, error: "internal_error" }, 500);
  }
});
