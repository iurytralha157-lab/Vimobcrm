/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NODES_PER_RUN = 50;
const AUTOMATION_BUCKET = "automation-media";
const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
const MAX_AUTOMATION_MEDIA_BYTES = 10 * 1024 * 1024;

export type RuntimeResult = Record<string, unknown>;

type FlowNode = {
  id: string;
  type: "trigger" | "action" | "condition" | "delay";
  action_type?: string | null;
  config?: Record<string, any>;
};

type FlowConnection = {
  source: string;
  target: string;
  source_handle?: string | null;
  condition_branch?: string | null;
};

type FlowGraph = {
  nodes: FlowNode[];
  connections: FlowConnection[];
  settings?: Record<string, any>;
};

type ClaimedExecution = {
  id: string;
  automation_id: string;
  organization_id: string;
  flow_version_id: string;
  lead_id: string;
  conversation_id?: string | null;
  current_node_key: string;
  status: string;
  attempt_count: number;
  execution_data?: Record<string, any>;
  locked_by?: string | null;
};

type AutomationEvent = {
  id: string;
  organization_id: string;
  event_type: string;
  lead_id: string;
  conversation_id?: string | null;
  payload?: Record<string, any>;
  attempts: number;
};

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase service runtime is not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "vimob-automation-runtime/1.0" } },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
}

export function authorizeServiceRequest(req: Request): Response | null {
  if (!SERVICE_KEY) return jsonResponse({ ok: false, error: "runtime_not_configured" }, 503);
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token || !constantTimeEqual(token, SERVICE_KEY)) {
    return jsonResponse({ ok: false, error: "service_role_required" }, 401);
  }
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function parseObjectBody(req: Request): Promise<Record<string, any>> {
  const length = Number(req.headers.get("content-length") || "0");
  if (length > 64 * 1024) throw new Error("request_too_large");
  const body = await req.json().catch(() => ({}));
  if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("invalid_json_body");
  return body;
}

function bounded(value: unknown, fallback: number, max = 100): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function workerID(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 1000) || "unknown_error";
}

async function moduleEnabled(client: SupabaseClient, organizationID: string): Promise<boolean> {
  const { data, error } = await client
    .from("organization_modules")
    .select("id")
    .eq("organization_id", organizationID)
    .ilike("module_name", "automations")
    .eq("is_enabled", true)
    .limit(1);
  if (error) throw error;
  return (data?.length || 0) > 0;
}

function triggerMatches(config: Record<string, any>, event: AutomationEvent, createdBy?: string | null): boolean {
  const payload = event.payload || {};
  const filterUser = String(config.filter_user_id || "");
  if (filterUser) {
    const expected = filterUser === "__me__" ? createdBy : filterUser;
    if (!expected || payload.assigned_user_id !== expected) return false;
  }
  switch (event.event_type) {
    case "lead_created":
      return (!config.source || config.source === payload.source) &&
        (!config.meta_form_id || config.meta_form_id === payload.meta_form_id);
    case "lead_stage_changed":
      return (!config.pipeline_id || config.pipeline_id === payload.pipeline_id) &&
        (!config.to_stage_id || config.to_stage_id === payload.to_stage_id);
    case "tag_added":
      return config.tag_id === payload.tag_id;
    case "message_received":
      return !config.session_id || config.session_id === payload.session_id;
    case "scheduled":
    case "inactivity":
      return !payload.flow_version_id || payload.flow_version_id === config.flow_version_id;
    default:
      return false;
  }
}

async function processReplyAwareInboundMessage(client: SupabaseClient, event: AutomationEvent): Promise<void> {
  const payload = event.payload || {};
  const messageID = String(payload.message_id || event.entity_id || "");
  const occurredAt = String(payload.occurred_at || "");
  if (!UUID_RE.test(messageID) || !Number.isFinite(new Date(occurredAt).getTime())) return;

  const { data, error } = await client.rpc("process_automation_inbound_message", {
    p_organization_id: event.organization_id,
    p_lead_id: event.lead_id,
    p_conversation_id: event.conversation_id || payload.conversation_id || null,
    p_message_id: messageID,
    p_message_type: String(payload.message_type || "text"),
    p_content: typeof payload.content === "string" ? payload.content : null,
    p_occurred_at: occurredAt,
  });
  if (error) throw error;
  if (data?.ok === false) throw new Error(`inbound_message_processing_failed:${data?.status || "unknown"}`);
}

async function processEvent(client: SupabaseClient, event: AutomationEvent): Promise<number> {
  if (!(await moduleEnabled(client, event.organization_id))) return 0;
  if (event.event_type === "message_received") await processReplyAwareInboundMessage(client, event);
  const { data: lead, error: leadError } = await client.from("leads")
    .select("id,assigned_user_id,last_contact_at,updated_at,created_at")
    .eq("id", event.lead_id).eq("organization_id", event.organization_id).maybeSingle();
  if (leadError) throw leadError;
  if (!lead) return 0;
  event.payload = { ...(event.payload || {}), assigned_user_id: lead.assigned_user_id };
  if (event.event_type === "inactivity" && event.payload.last_activity_at) {
    const currentActivity = [lead.last_contact_at, lead.updated_at, lead.created_at]
      .filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
    const expectedActivity = new Date(event.payload.last_activity_at).getTime();
    if (currentActivity.length === 0 || Math.max(...currentActivity) !== expectedActivity) return 0;
  }

  let queued = 0;
  let afterID = "";
  for (let page = 0; page < 250; page += 1) {
    let query = client.from("automations")
      .select("id,created_by,active_flow_version_id")
      .eq("organization_id", event.organization_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .not("active_flow_version_id", "is", null)
      .order("id", { ascending: true })
      .limit(100);
    if (afterID) query = query.gt("id", afterID);
    const { data: automations, error } = await query;
    if (error) throw error;
    if (!automations?.length) return queued;
    const versionIDs = automations.map((item) => item.active_flow_version_id).filter(Boolean);
    const { data: versions, error: versionError } = await client
      .from("automation_flow_versions")
      .select("id,automation_id,trigger_type,trigger_config,first_node_key,requires_review")
      .eq("organization_id", event.organization_id)
      .eq("trigger_type", event.event_type)
      .eq("requires_review", false)
      .in("id", versionIDs);
    if (versionError) throw versionError;
    const automationByVersion = new Map<string, any>(automations.map((item: any) => [item.active_flow_version_id, item]));
    for (const version of versions || []) {
      const automation = automationByVersion.get(version.id);
      const config = { ...(version.trigger_config || {}), flow_version_id: version.id };
      if (!automation || !triggerMatches(config, event, automation.created_by)) continue;
      const causalDepth = Number(event.payload?.causal_depth || 0);
      const executionData = {
        trigger_data: event.payload || {}, variables: {},
        causal_depth: Number.isFinite(causalDepth) ? causalDepth : 0,
        origin_execution_id: event.payload?.origin_execution_id || null,
      };
      const { data: result, error: startError } = await client.rpc("start_automation_execution_from_event", {
        p_event_id: event.id,
        p_automation_id: automation.id,
        p_flow_version_id: version.id,
        p_lead_id: event.lead_id,
        p_conversation_id: event.conversation_id || null,
        p_first_node_key: version.first_node_key,
        p_execution_data: executionData,
      });
      if (startError) throw startError;
      if (result?.status === "queued") queued += 1;
    }
    afterID = automations[automations.length - 1].id;
    if (automations.length < 100) return queued;
  }
  throw new Error("automation_candidate_page_limit_exceeded");
}

export async function processTriggerEvents(limit = 25): Promise<RuntimeResult> {
  const client = adminClient();
  const id = workerID("events");
  const { data: events, error } = await client.rpc("claim_automation_events", {
    p_worker_id: id,
    p_batch_size: bounded(limit, 25),
  });
  if (error) throw error;
  let queued = 0;
  let failed = 0;
  for (const raw of events || []) {
    const event = raw as AutomationEvent;
    try {
      queued += await processEvent(client, event);
      const { error: completeError } = await client.rpc("complete_automation_event", { p_event_id: event.id, p_worker_id: id });
      if (completeError) throw completeError;
    } catch (eventError) {
      failed += 1;
      const retrySeconds = Math.min(3600, 5 * (2 ** Math.min(Number(event.attempts || 1), 8)));
      await client.rpc("fail_automation_event", {
        p_event_id: event.id,
        p_worker_id: id,
        p_error: sanitizeError(eventError),
        p_retry_seconds: retrySeconds,
      });
    }
  }
  return { claimed: events?.length || 0, queued, failed };
}

export async function enqueueDueSchedules(limit = 50): Promise<RuntimeResult> {
  const client = adminClient();
  const { data, error } = await client.rpc("enqueue_due_automation_schedules", {
    p_batch_size: bounded(limit, 50),
  });
  if (error) throw error;
  return { enqueued: data?.length || 0 };
}

export async function enqueueDueInactivity(limit = 50): Promise<RuntimeResult> {
  const client = adminClient();
  const { data, error } = await client.rpc("enqueue_due_automation_inactivity", {
    p_batch_size: bounded(limit, 100, 500),
  });
  if (error) throw error;
  return { enqueued: data?.length || 0 };
}

function graphNode(graph: FlowGraph, key: string): FlowNode | undefined {
  return graph.nodes.find((node) => node.id === key);
}

function nextNode(graph: FlowGraph, source: string, branch?: string): string | null {
  const outgoing = graph.connections.filter((edge) => edge.source === source);
  if (!branch) return outgoing.length === 1 ? outgoing[0].target : null;
  const match = outgoing.find((edge) => (edge.condition_branch || edge.source_handle) === branch);
  return match?.target || null;
}

export function replyWinsDelayWindow(waitStartedAt: number, deadline: number, occurredAt: number): boolean {
  return Number.isFinite(waitStartedAt) && Number.isFinite(deadline) && Number.isFinite(occurredAt) &&
    occurredAt >= waitStartedAt && occurredAt <= deadline;
}

function nestedValue(source: Record<string, any>, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], source as any);
}

function evaluateCondition(config: Record<string, any>, context: Record<string, any>): boolean {
  if (config.condition_type === "response_sentiment") {
    const content = String(context.execution?.trigger_data?.content || context.execution?.reply_payload?.content || "").toLowerCase();
    const positives = String(config.positive_keywords || "sim,quero,aceito,ok").split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
    const negatives = String(config.negative_keywords || "nao,não,sem interesse,dispenso").split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
    const positive = positives.some((word) => content.includes(word));
    const negative = negatives.some((word) => content.includes(word));
    return positive && !negative;
  }
  const actual = nestedValue(context, String(config.variable || ""));
  const expected = config.value;
  switch (config.operator) {
    case "equals": return String(actual ?? "") === String(expected ?? "");
    case "not_equals": return String(actual ?? "") !== String(expected ?? "");
    case "contains": return String(actual ?? "").includes(String(expected ?? ""));
    case "not_contains": return !String(actual ?? "").includes(String(expected ?? ""));
    case "greater_than": return Number(actual) > Number(expected);
    case "less_than": return Number(actual) < Number(expected);
    case "is_set": return actual !== undefined && actual !== null && actual !== "";
    case "is_not_set": return actual === undefined || actual === null || actual === "";
    default: throw new Error("unsupported_condition_operator");
  }
}

function renderTemplate(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path) => {
    const value = nestedValue(context, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

function parseIPv6(raw: string): number[] | null {
  const address = raw.split("%")[0].toLowerCase();
  if (address.split("::").length > 2) return null;
  const [headRaw, tailRaw] = address.includes("::") ? address.split("::") : [address, ""];
  const parseParts = (value: string): number[] | null => {
    if (!value) return [];
    const parts = value.split(":");
    const output: number[] = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const bytes = part.split(".").map(Number);
        if (bytes.length !== 4 || bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
        output.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        output.push(Number.parseInt(part, 16));
      }
    }
    return output;
  };
  const head = parseParts(headRaw);
  const tail = parseParts(tailRaw);
  if (!head || !tail) return null;
  if (!address.includes("::")) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

export function isPrivateIP(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes(":")) {
    const hextets = parseIPv6(normalized);
    if (!hextets) return true;
    const allZero = hextets.every((value) => value === 0);
    const loopback = hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1;
    const mapped = hextets.slice(0, 5).every((value) => value === 0) && hextets[5] === 0xffff;
    if (mapped) {
      const high = hextets[6];
      const low = hextets[7];
      return isPrivateIP(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return allZero || loopback ||
      (hextets[0] & 0xfe00) === 0xfc00 || // unique-local fc00::/7
      (hextets[0] & 0xff00) === 0xfe00 || // link/site-local and reserved fe00::/8
      (hextets[0] & 0xff00) === 0xff00 || // multicast
      (hextets[0] === 0x2001 && hextets[1] === 0x0db8) || // documentation
      (hextets[0] === 0x0064 && hextets[1] === 0xff9b) || // NAT64 translation ranges
      (hextets[0] === 0x0100 && hextets[1] === 0); // discard-only 100::/64
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 192 && (parts[1] === 168 || parts[1] === 0 || parts[1] === 2)) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51 && parts[2] === 100)) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224;
}

async function assertWebhookTarget(rawURL: string): Promise<URL> {
  const target = new URL(rawURL);
  if (target.protocol !== "https:" || target.username || target.password || target.port && target.port !== "443") throw new Error("unsafe_webhook_url");
  const host = target.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("unsafe_webhook_host");
  const allowlist = (Deno.env.get("AUTOMATION_WEBHOOK_ALLOWED_HOSTS") || "")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (allowlist.length === 0) throw new Error("webhook_allowlist_required");
  if (!allowlist.includes(host)) throw new Error("webhook_host_not_allowlisted");
  const addresses = new Set<string>();
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      for (const address of await Deno.resolveDns(host, recordType)) addresses.add(address);
    } catch {
      // A hostname may legitimately have only one address family.
    }
  }
  if (addresses.size === 0 || [...addresses].some(isPrivateIP)) throw new Error("unsafe_webhook_dns_target");
  return target;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (remaining <= 0) break;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function webhookSignature(payload: string): Promise<string | null> {
  const secret = Deno.env.get("AUTOMATION_WEBHOOK_HMAC_SECRET") || "";
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return `sha256=${[...signature].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function callWebhook(url: string, method: string, payload: unknown, effectKey: string): Promise<Record<string, any>> {
  const target = await assertWebhookTarget(url);
  const serialized = JSON.stringify(payload);
  const signature = await webhookSignature(serialized);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "idempotency-key": effectKey,
      "user-agent": "Vimob-Automations/1.0",
    };
    if (signature) headers["x-vimob-signature"] = signature;
    const response = await fetch(target, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers,
      body: serialized,
    });
    if (response.status >= 300 && response.status < 400) throw new Error("webhook_redirects_are_disabled");
    const body = await readLimitedText(response, 64 * 1024);
    if (!response.ok) throw new Error(`webhook_http_${response.status}:${body.slice(0, 500)}`);
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

function mediaFolder(actionType: string): string {
  return ({ send_image: "images", send_audio: "audios", send_video: "videos" } as Record<string, string>)[actionType] || "";
}

type PreparedMedia = { storagePath: string; mimeType: string; size: number };

async function prepareAutomationMedia(
  client: SupabaseClient,
  execution: ClaimedExecution,
  node: FlowNode,
  sessionID: string,
): Promise<PreparedMedia> {
  const config = node.config || {};
  const actionType = String(node.action_type || "");
  const sourcePath = String(config.media_path || "");
  const expectedPrefix = `${execution.organization_id}/${mediaFolder(actionType)}/`;
  if (config.media_bucket !== AUTOMATION_BUCKET || !sourcePath.startsWith(expectedPrefix) || sourcePath.includes("..") || sourcePath.includes("\\")) {
    throw new Error("cross_tenant_or_invalid_media_path");
  }
  const { data: blob, error: downloadError } = await client.storage.from(AUTOMATION_BUCKET).download(sourcePath);
  if (downloadError || !blob) throw downloadError || new Error("media_download_failed");
  if (blob.size < 1 || blob.size > MAX_AUTOMATION_MEDIA_BYTES) throw new Error("invalid_automation_media_size");

  const sourceExtension = sourcePath.split(".").pop()?.toLowerCase() || "";
  const fallbackExtension = ({ send_image: "jpg", send_audio: "ogg", send_video: "mp4" } as Record<string, string>)[actionType] || "bin";
  const extension = /^[a-z0-9]{1,8}$/.test(sourceExtension) ? sourceExtension : fallbackExtension;
  const safeNodeKey = node.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "node";
  const destinationPath = `orgs/${execution.organization_id}/sessions/${sessionID}/outgoing/automation-${execution.id}-${safeNodeKey}.${extension}`;
  const mimeType = String(blob.type || config.mimetype || "application/octet-stream").split(";")[0];
  const { error: uploadError } = await client.storage.from(WHATSAPP_MEDIA_BUCKET).upload(destinationPath, blob, {
    contentType: mimeType,
    upsert: true,
  });
  if (uploadError) throw uploadError;
  // The durable outbox worker creates a fresh short-lived URL immediately
  // before each provider attempt. Persisting an URL here would make retries
  // depend on an already-expired credential.
  return { storagePath: destinationPath, mimeType, size: blob.size };
}

async function resolveConversation(client: SupabaseClient, execution: ClaimedExecution, sessionID: string): Promise<Record<string, any>> {
  const { data, error } = await client.rpc("resolve_automation_whatsapp_conversation", {
    p_organization_id: execution.organization_id,
    p_execution_id: execution.id,
    p_node_key: execution.current_node_key,
    p_lease_token: execution.locked_by,
    p_session_id: sessionID,
  });
  if (error) throw error;
  if (!data?.ok || !data?.id) throw new Error(String(data?.status || "matching_conversation_not_found"));
  execution.conversation_id = data.id;
  return data;
}

async function reserveExternalEffect(client: SupabaseClient, execution: ClaimedExecution, node: FlowNode, effectKey: string): Promise<Record<string, any>> {
  const { data, error } = await client.rpc("reserve_automation_external_effect", {
    p_organization_id: execution.organization_id,
    p_execution_id: execution.id,
    p_node_key: node.id,
    p_lease_token: execution.locked_by,
    p_effect_key: effectKey,
    p_effect_type: node.action_type,
    p_request: node.config || {},
  });
  if (error) throw error;
  if (!data?.execute && data?.status !== "succeeded") throw new Error(`effect_fail_closed:${data?.status || "unknown"}`);
  return data || {};
}

async function reserveDurableWhatsAppEffect(
  client: SupabaseClient,
  execution: ClaimedExecution,
  node: FlowNode,
  effectKey: string,
): Promise<Record<string, any>> {
  const { data, error } = await client.rpc("reserve_automation_external_effect", {
    p_organization_id: execution.organization_id,
    p_execution_id: execution.id,
    p_node_key: node.id,
    p_lease_token: execution.locked_by,
    p_effect_key: effectKey,
    p_effect_type: node.action_type,
    p_request: {
      ...(node.config || {}),
      delivery_contract: "canonical_whatsapp_outbox_v1",
    },
  });
  if (error) throw error;
  return normalizeDurableWhatsAppReservation(data || {});
}

export function normalizeDurableWhatsAppReservation(data: Record<string, any>): Record<string, any> {
  if (data?.status === "succeeded") return data || {};
  // A DB-first effect can be retried safely while it is still `sending`: the
  // enqueue RPC below is atomic and idempotent. The RPC also requires the
  // delivery_contract marker, so an old provider-first effect fails closed.
  if (data?.status === "sending") return { ...data, execute: true };
  if (!data?.execute) {
    throw new Error(`effect_fail_closed:${data?.status || "unknown"}`);
  }
  return data || {};
}

async function finishExternalEffect(client: SupabaseClient, effectKey: string, status: "succeeded" | "failed" | "unknown", response: unknown, providerID?: string, errorMessage?: string): Promise<void> {
  const { data, error } = await client.rpc("finish_automation_external_effect", {
    p_effect_key: effectKey,
    p_status: status,
    p_response: response || {},
    p_provider_id: providerID || null,
    p_error: errorMessage || null,
  });
  if (error) throw error;
  if (data !== true) throw new Error("effect_finish_fencing_conflict");
}

async function invokeEvolution(client: SupabaseClient, execution: ClaimedExecution, node: FlowNode, context: Record<string, any>, effectKey: string): Promise<Record<string, any>> {
  const config = node.config || {};
  const sessionID = String(config.session_id || "");
  if (!UUID_RE.test(sessionID)) throw new Error("invalid_whatsapp_session");
  const conversation = await resolveConversation(client, execution, sessionID);

  const remoteJID = String(conversation.remote_jid || "");
  const destination = conversation.is_group === true
    ? remoteJID
    : remoteJID.replace(/@(s\.whatsapp\.net|c\.us)$/i, "").replace(/\D/g, "");
  if (conversation.is_group !== true && (destination.length < 10 || destination.length > 15)) {
    throw new Error("conversation_has_no_canonical_whatsapp_destination");
  }
  let storedContent = "";
  let preparedMedia: PreparedMedia | null = null;
  if (node.action_type === "send_whatsapp") {
    storedContent = renderTemplate(String(config.message || ""), context);
  } else {
    preparedMedia = await prepareAutomationMedia(client, execution, node, sessionID);
    storedContent = renderTemplate(String(config.caption || ""), context);
  }

  // Every failure above is preflight-only. Reserve the idempotency ledger only
  // after conversation and private media persistence are ready.
  const reservation = await reserveDurableWhatsAppEffect(client, execution, node, effectKey);
  if (!reservation.execute) return { deduplicated: true };
  const messageType = node.action_type === "send_whatsapp" ? "text" : String(node.action_type).replace("send_", "");
  const { data: queued, error: queueError } = await client.rpc("enqueue_automation_whatsapp_outbox", {
    p_organization_id: execution.organization_id,
    p_execution_id: execution.id,
    p_node_key: node.id,
    p_lease_token: execution.locked_by,
    p_effect_key: effectKey,
    p_conversation_id: conversation.id,
    p_session_id: sessionID,
    p_client_message_id: effectKey,
    p_message_type: messageType,
    p_content: storedContent || null,
    p_media_mime_type: preparedMedia?.mimeType || null,
    p_media_storage_path: preparedMedia?.storagePath || null,
    p_media_size: preparedMedia?.size || null,
    p_filename: config.filename || null,
  });
  if (queueError) throw queueError;
  if (!queued?.ok || !queued?.outbox_id || !queued?.message_id) {
    throw new Error(`whatsapp_outbox_enqueue_failed:${queued?.status || "unknown"}`);
  }
  return {
    delivery: "outbox",
    status: "queued",
    outbox_id: queued.outbox_id,
    message_id: queued.message_id,
  };
}

async function executeAction(client: SupabaseClient, execution: ClaimedExecution, node: FlowNode, context: Record<string, any>): Promise<Record<string, any>> {
  const actionType = String(node.action_type || "");
  const config = node.config || {};
  const effectType = actionType === "set_variable" ? String(config.actionType || "") : actionType;
  const effectKey = `automation:${execution.id}:${node.id}:${effectType}`;
  if (["send_whatsapp", "send_image", "send_audio", "send_video"].includes(actionType)) {
    return invokeEvolution(client, execution, node, context, effectKey);
  }
  if (actionType === "webhook") {
    const reservation = await reserveExternalEffect(client, execution, node, effectKey);
    if (!reservation.execute) return { deduplicated: true };
    if (!(await moduleEnabled(client, execution.organization_id))) {
      await finishExternalEffect(client, effectKey, "failed", {}, undefined, "module_disabled");
      throw new Error("module_disabled");
    }
    try {
      const result = await callWebhook(String(config.webhook_url || ""), String(config.method || "POST").toUpperCase(), {
        event: "automation.node",
        execution_id: execution.id,
        automation_id: execution.automation_id,
        node_key: node.id,
        lead: context.lead,
      }, effectKey);
      await finishExternalEffect(client, effectKey, "succeeded", result);
      return result;
    } catch (webhookError) {
      const message = sanitizeError(webhookError);
      const status = message.startsWith("webhook_http_") || message.includes("allowlisted") || message.includes("unsafe_") ? "failed" : "unknown";
      await finishExternalEffect(client, effectKey, status, {}, undefined, message);
      throw webhookError;
    }
  }
  const internalType = actionType === "set_variable" ? String(config.actionType || "") : actionType;
  const { data, error } = await client.rpc("apply_automation_internal_effect", {
    p_organization_id: execution.organization_id,
    p_execution_id: execution.id,
    p_node_key: node.id,
    p_lease_token: execution.locked_by,
    p_effect_key: effectKey,
    p_effect_type: internalType,
    p_payload: config,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(`internal_effect_failed:${data?.status || "unknown"}`);
  const { data: refreshedLead, error: refreshError } = await client.from("leads").select("*")
    .eq("id", execution.lead_id).eq("organization_id", execution.organization_id).maybeSingle();
  if (refreshError) throw refreshError;
  if (!refreshedLead) throw new Error("lead_missing_after_internal_effect");
  context.lead = refreshedLead;
  return data;
}

async function updateStep(client: SupabaseClient, stepID: string, update: Record<string, any>): Promise<void> {
  const { error } = await client.from("automation_execution_steps").update(update).eq("id", stepID).eq("status", "running");
  if (error) throw error;
}

async function failExecution(client: SupabaseClient, execution: ClaimedExecution, error: unknown): Promise<void> {
  await client.from("automation_executions").update({
    status: "failed",
    completed_at: new Date().toISOString(),
    error_message: sanitizeError(error),
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
  }).eq("id", execution.id).eq("locked_by", execution.locked_by || "").in("status", ["running", "queued"]);
}

async function renewExecutionLease(client: SupabaseClient, execution: ClaimedExecution): Promise<boolean> {
  const { data, error } = await client.from("automation_executions").update({
    locked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", execution.id)
    .eq("organization_id", execution.organization_id)
    .eq("status", "running")
    .eq("locked_by", execution.locked_by || "")
    .is("cancellation_requested_at", null)
    .select("id");
  if (error) throw error;
  return data?.length === 1;
}

async function loadExecutionContext(client: SupabaseClient, execution: ClaimedExecution, graph: FlowGraph): Promise<Record<string, any>> {
  const { data: lead, error } = await client.from("leads").select("*")
    .eq("id", execution.lead_id).eq("organization_id", execution.organization_id).maybeSingle();
  if (error) throw error;
  if (!lead) throw new Error("lead_not_found_in_tenant");
  const { data: organization, error: organizationError } = await client.from("organizations")
    .select("id,name").eq("id", execution.organization_id).maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) throw new Error("organization_not_found");
  const triggerTimezone = graph.nodes.find((node) => node.type === "trigger")?.config?.timezone;
  let timezone = String(graph.settings?.timezone || triggerTimezone || Deno.env.get("AUTOMATION_DEFAULT_TIMEZONE") || "America/Sao_Paulo");
  const now = new Date();
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(now);
  } catch {
    timezone = "America/Sao_Paulo";
  }
  return {
    lead,
    organization,
    date: new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(now),
    now: now.toISOString(),
    timezone,
    execution: execution.execution_data || {},
  };
}

async function runExecution(client: SupabaseClient, execution: ClaimedExecution): Promise<void> {
  if (!(await moduleEnabled(client, execution.organization_id))) {
    await client.from("automation_executions").update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "module_disabled", locked_at: null, locked_by: null })
      .eq("id", execution.id).eq("status", "running").eq("locked_by", execution.locked_by || "");
    return;
  }
  const { data: version, error: versionError } = await client.from("automation_flow_versions")
    .select("id,graph,requires_review").eq("id", execution.flow_version_id)
    .eq("organization_id", execution.organization_id).eq("requires_review", false).maybeSingle();
  if (versionError) throw versionError;
  if (!version) throw new Error("published_flow_version_not_found");
  const graph = version.graph as FlowGraph;
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.connections)) throw new Error("invalid_published_graph");
  const context = await loadExecutionContext(client, execution, graph);

  for (let processed = 0; processed < MAX_NODES_PER_RUN; processed += 1) {
    if (!(await renewExecutionLease(client, execution))) return;
    if (!(await moduleEnabled(client, execution.organization_id))) {
      await client.from("automation_executions").update({
        status: "cancelled", completed_at: new Date().toISOString(), error_message: "module_disabled", locked_at: null, locked_by: null,
      }).eq("id", execution.id).eq("status", "running").eq("locked_by", execution.locked_by || "");
      return;
    }
    const { data: current, error: currentError } = await client.from("automation_executions")
      .select("status,cancellation_requested_at,current_node_key,execution_data,locked_by")
      .eq("id", execution.id).eq("organization_id", execution.organization_id)
      .eq("status", "running").eq("locked_by", execution.locked_by || "").maybeSingle();
    if (currentError) throw currentError;
    if (!current || current.cancellation_requested_at || current.status === "cancelled") return;
    execution.current_node_key = current.current_node_key;
    execution.execution_data = current.execution_data || execution.execution_data || {};
    context.execution = execution.execution_data;
    const node = graphNode(graph, execution.current_node_key);
    if (!node) throw new Error("current_node_missing_from_published_graph");

    const { data: step, error: stepError } = await client.from("automation_execution_steps").insert({
      execution_id: execution.id,
      organization_id: execution.organization_id,
      flow_version_id: execution.flow_version_id,
      node_key: node.id,
      node_type: node.type,
      action_type: node.action_type || null,
      status: "running",
      attempt: Math.max(1, Number(execution.attempt_count || 1)),
      input: { config: node.config || {} },
    }).select("id").single();
    if (stepError) {
      if (stepError.code === "23505") throw new Error("step_attempt_already_processed_fail_closed");
      throw stepError;
    }

    try {
      let branch: string | undefined;
      let output: Record<string, any> = {};
      if (node.type === "action") {
        output = await executeAction(client, execution, node, context);
      } else if (node.type === "condition") {
        branch = evaluateCondition(node.config || {}, context) ? "true" : "false";
        output = { branch };
      } else if (node.type === "delay") {
        const value = Number(node.config?.delay_value || 0);
        const multiplier = ({ seconds: 1, minutes: 60, hours: 3600, days: 86400 } as Record<string, number>)[String(node.config?.delay_type)] || 0;
        if (!Number.isInteger(value) || value < 1 || multiplier < 1 || value * multiplier > 30 * 86400) throw new Error("invalid_delay_config");
        const nextExecutionAt = new Date(Date.now() + value * multiplier * 1000).toISOString();
        const { data: waited, error: waitError } = await client.rpc("enter_automation_delay_wait", {
          p_organization_id: execution.organization_id,
          p_execution_id: execution.id,
          p_step_id: step.id,
          p_node_key: node.id,
          p_lease_token: execution.locked_by,
          p_next_execution_at: nextExecutionAt,
        });
        if (waitError) throw waitError;
        if (waited !== true) return;
        return;
      } else {
        throw new Error("trigger_node_cannot_be_executed");
      }

      const target = nextNode(graph, node.id, branch);
      await updateStep(client, step.id, { status: "succeeded", output: { ...output, next_node_key: target }, completed_at: new Date().toISOString() });
      if (!target) {
        const { data: completed, error: completeError } = await client.from("automation_executions").update({
          status: "completed", current_node_key: null, completed_at: new Date().toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
        }).eq("id", execution.id).eq("status", "running").eq("locked_by", execution.locked_by || "").select("id");
        if (completeError) throw completeError;
        if (completed?.length !== 1) return;
        return;
      }
      const { data: advanced, error: advanceError } = await client.from("automation_executions").update({
        current_node_key: target, locked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", execution.id).eq("status", "running").eq("locked_by", execution.locked_by || "").select("id");
      if (advanceError) throw advanceError;
      if (advanced?.length !== 1) return;
      execution.current_node_key = target;
    } catch (nodeError) {
      const { data: latest } = await client.from("automation_executions")
        .select("status,cancellation_requested_at").eq("id", execution.id).maybeSingle();
      if (latest?.status === "cancelled" || latest?.cancellation_requested_at) {
        await updateStep(client, step.id, { status: "cancelled", error_message: "cancelled", completed_at: new Date().toISOString() });
        return;
      }
      if (!(await moduleEnabled(client, execution.organization_id))) {
        await updateStep(client, step.id, { status: "cancelled", error_message: "module_disabled", completed_at: new Date().toISOString() });
        await client.from("automation_executions").update({
          status: "cancelled", completed_at: new Date().toISOString(), error_message: "module_disabled", locked_at: null, locked_by: null,
        }).eq("id", execution.id).eq("status", "running").eq("locked_by", execution.locked_by || "");
        return;
      }
      await updateStep(client, step.id, { status: "failed", error_message: sanitizeError(nodeError), completed_at: new Date().toISOString() });
      throw nodeError;
    }
  }
  const { data: checkpointed, error: checkpointError } = await client.from("automation_executions").update({
    status: "queued", locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
  }).eq("id", execution.id).eq("status", "running").eq("locked_by", execution.locked_by || "").select("id");
  if (checkpointError) throw checkpointError;
  if (checkpointed?.length !== 1) return;
}

export async function processExecutions(limit = 25): Promise<RuntimeResult> {
  const client = adminClient();
  const id = workerID("executor");
  const { data, error } = await client.rpc("claim_automation_executions", { p_worker_id: id, p_batch_size: Math.min(bounded(limit, 5), 5) });
  if (error) throw error;
  let completed = 0;
  let failed = 0;
  const claimed = data || [];
  await Promise.all(claimed.map(async (raw: any) => {
    const execution = { ...raw, locked_by: id } as ClaimedExecution;
    try {
      await runExecution(client, execution);
      completed += 1;
    } catch (executionError) {
      failed += 1;
      await failExecution(client, execution, executionError);
    }
  }));
  return { claimed: data?.length || 0, completed, failed };
}

export async function processSpecificExecution(executionID: string): Promise<RuntimeResult> {
  if (!UUID_RE.test(executionID)) throw new Error("invalid_execution_id");
  const client = adminClient();
  const id = workerID("executor-direct");
  const { data: current, error } = await client.from("automation_executions").select("*").eq("id", executionID).maybeSingle();
  if (error) throw error;
  if (!current) throw new Error("execution_not_found");
  if (current.status !== "queued") return { accepted: false, status: current.status };
  if (!(await moduleEnabled(client, current.organization_id))) {
    await client.from("automation_executions").update({ status: "cancelled", completed_at: new Date().toISOString(), error_message: "module_disabled" }).eq("id", executionID).eq("status", "queued");
    return { accepted: false, status: "cancelled" };
  }
  const { data: claimed, error: claimError } = await client.from("automation_executions").update({
    status: "running", attempt_count: Number(current.attempt_count || 0) + 1, locked_at: new Date().toISOString(), locked_by: id, error_message: null,
  }).eq("id", executionID).eq("status", "queued").is("cancellation_requested_at", null).select("*").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { accepted: false, status: "already_claimed" };
  const execution = { ...claimed, locked_by: id } as ClaimedExecution;
  try {
    await runExecution(client, execution);
    return { accepted: true, status: "processed" };
  } catch (executionError) {
    await failExecution(client, execution, executionError);
    throw executionError;
  }
}

export async function releaseDueDelays(limit = 25): Promise<RuntimeResult> {
  const client = adminClient();
  const { data, error } = await client.rpc("release_due_automation_delays", { p_batch_size: bounded(limit, 25) });
  if (error) throw error;
  return { released: data?.length || 0 };
}

export async function cancelDisabledRuntime(limit = 100): Promise<RuntimeResult> {
  const client = adminClient();
  const { data, error } = await client.rpc("cancel_disabled_automation_runtime", { p_batch_size: bounded(limit, 100, 500) });
  if (error) throw error;
  return data || {};
}

export async function runAutomationRuntime(options: Record<string, any> = {}): Promise<RuntimeResult> {
  const cancelled = await cancelDisabledRuntime(options.cancel_batch_size);
  const schedules = await enqueueDueSchedules(options.schedule_batch_size);
  const events = await processTriggerEvents(options.event_batch_size);
  const delays = await releaseDueDelays(options.delay_batch_size);
  const executions = await processExecutions(options.execution_batch_size);
  const inactivity = options.run_inactivity === true
    ? await enqueueDueInactivity(options.inactivity_batch_size)
    : { skipped: true };
  return { cancelled, schedules, inactivity, events, delays, executions };
}
