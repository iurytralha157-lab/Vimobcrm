/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildGoogleEventAttendees,
  buildGoogleEventDescription,
  buildGoogleReminderSettings,
  buildGoogleEventSummary,
  buildVimobGoogleExtendedProperties,
  buildVimobGoogleEventId,
  identityBelongsToOrganization,
  isFinalVimobScheduleStatus,
  readVimobGoogleEventIdentity,
  stripVimobLinkedDescription,
} from "./google-calendar-event.ts";
import {
  resolveGoogleScheduleCapability,
  type GoogleScheduleCapability,
} from "./google-calendar-access.ts";
import {
  googleAllDayRangeToScheduleRange,
  nextGoogleCivilDate,
  normalizeGoogleCalendarTimeZone,
  scheduleInstantToGoogleDate,
} from "./google-calendar-time.ts";

export type JsonRecord = Record<string, any>;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-goog-channel-id, x-goog-channel-token, x-goog-resource-id, x-goog-resource-state, x-vimob-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_PATH_PREFIX = "/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
];
const GOOGLE_EVENT_TYPES = new Set([
  "call",
  "email",
  "meeting",
  "task",
  "message",
  "visit",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export function jsonResponse(
  body: JsonRecord,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

export function redirectResponse(url: string) {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });
}

export function handleOptions(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function env(name: string, fallback = "") {
  const value = Deno.env.get(name) || fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function optionalEnv(name: string, fallback = "") {
  return Deno.env.get(name) || fallback;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function randomToken(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bytesToBase64Url(array);
}

export async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function toISO(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function limitedText(
  value: unknown,
  maxLength: number,
  fallback: string | null = null,
) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeCalendarId(value: string | null | undefined) {
  return value?.trim() || "primary";
}

export function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }

  return difference === 0;
}

export function normalizeGoogleAccountEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function selectReusableGoogleCalendarConnection(
  connections: JsonRecord[],
  accountEmail: string,
) {
  const normalizedAccountEmail = normalizeGoogleAccountEmail(accountEmail);
  const activeConnection = connections.find(
    (connection) => !connection.disconnected_at,
  );

  if (
    activeConnection &&
    normalizeGoogleAccountEmail(activeConnection.account_email) !==
      normalizedAccountEmail
  ) {
    throw new Error(
      "Desconecte a conta Google atual antes de conectar outra conta.",
    );
  }

  if (activeConnection) return activeConnection;

  return (
    connections.find(
      (connection) => connection.account_email === accountEmail,
    ) ||
    connections.find(
      (connection) =>
        normalizeGoogleAccountEmail(connection.account_email) ===
        normalizedAccountEmail,
    ) ||
    null
  );
}

function validatedGoogleWebhookUrl(value: string) {
  let webhookUrl: URL;
  try {
    webhookUrl = new URL(value);
  } catch {
    throw new Error("GOOGLE_CALENDAR_WEBHOOK_URL invalida.");
  }

  if (
    webhookUrl.protocol !== "https:" ||
    webhookUrl.username ||
    webhookUrl.password ||
    webhookUrl.hash
  ) {
    throw new Error(
      "GOOGLE_CALENDAR_WEBHOOK_URL deve ser HTTPS e nao pode conter credenciais ou fragmento.",
    );
  }

  return webhookUrl.toString();
}

function safeReturnUrl(value: unknown) {
  const fallback = getGoogleOAuthConfig().postConnectRedirectUrl;
  if (!value) return fallback || null;

  try {
    const candidate = new URL(String(value));
    if (!fallback) return null;

    const allowed = new URL(fallback);
    return candidate.origin === allowed.origin
      ? candidate.toString()
      : fallback;
  } catch {
    return fallback || null;
  }
}

export function getGoogleOAuthConfig() {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: env("GOOGLE_CALENDAR_REDIRECT_URI"),
    webhookUrl: optionalEnv("GOOGLE_CALENDAR_WEBHOOK_URL"),
    postConnectRedirectUrl: optionalEnv(
      "GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL",
    ),
  };
}

export async function authenticateUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer || bearer === authHeader) throw new Error("Unauthorized");

  const { data, error } = await supabase.auth.getUser(bearer);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user;
}

export async function authenticateCron(req: Request) {
  const cronSecret = req.headers.get("x-vimob-cron-secret") || "";
  if (!cronSecret) return false;

  const { data, error } = await supabase.rpc(
    "google_calendar_verify_cron_secret",
    {
      p_secret: cronSecret,
    },
  );
  if (error) throw error;
  return data === true;
}

export async function getUserProfile(
  userId: string,
  requestedOrganizationId?: string | null,
) {
  const { data, error } = await supabase
    .from("users")
    .select("id, organization_id, email, name, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Usuario sem perfil.");
  if (data.is_active === false) throw new Error("Usuario inativo.");

  const organizationId = requestedOrganizationId || data.organization_id;
  if (!organizationId) throw new Error("Usuario sem organizacao ativa.");

  // `users.organization_id` is only a compatibility pointer. An active
  // organization_members row is the canonical tenant capability for ordinary
  // users, including when they request their legacy primary organization.
  if (data.role !== "super_admin" || organizationId !== data.organization_id) {
    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership) throw new Error("Sem acesso a organizacao informada.");
  }

  return { ...data, organization_id: organizationId } as JsonRecord;
}

export class GoogleScheduleCapabilityError extends Error {
  code: string;
  status: number;

  constructor(
    capability: Exclude<GoogleScheduleCapability, { allowed: true }>,
  ) {
    super(capability.reason);
    this.name = "GoogleScheduleCapabilityError";
    this.code = capability.reason;
    this.status = capability.status;
  }
}

export async function getGoogleScheduleCapability(
  userId: string,
  organizationId: string,
): Promise<GoogleScheduleCapability> {
  const [
    { data: user, error: userError },
    { data: organization, error: organizationError },
    { data: membership, error: membershipError },
    { data: agendaModule, error: moduleError },
    { data: permissionOverride, error: overrideError },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id, role, is_active")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select(
        "id, is_active, subscription_status, subscription_type, trial_ends_at, billing_grace_until",
      )
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("role, is_active, deleted_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("organization_modules")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_enabled", true)
      .ilike("module_name", "agenda")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_permission_overrides")
      .select("allowed")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("permission_key", "schedule_manage")
      .maybeSingle(),
  ]);

  for (const error of [
    userError,
    organizationError,
    membershipError,
    moduleError,
    overrideError,
  ]) {
    if (error) throw error;
  }

  const isSuperAdmin = user?.is_active === true && user?.role === "super_admin";
  return resolveGoogleScheduleCapability({
    organizationActive:
      organization?.is_active !== false && Boolean(organization?.id),
    moduleEnabled: Boolean(agendaModule),
    billing: organization || {},
    isSuperAdmin,
    activeMembership: Boolean(membership) && user?.is_active === true,
    membershipRole: membership?.role,
    permissionOverride: permissionOverride?.allowed ?? null,
    // This mirrors permissions.DefaultSet: every active ordinary member gets
    // schedule_manage unless an explicit user override revokes it.
    defaultScheduleManage: true,
  });
}

export async function assertGoogleScheduleCapability(
  userId: string,
  organizationId: string,
) {
  const capability = await getGoogleScheduleCapability(userId, organizationId);
  if (!capability.allowed) throw new GoogleScheduleCapabilityError(capability);
  return capability;
}

export async function canManageScheduleEvent(
  event: JsonRecord,
  userId: string,
) {
  const [
    { data: assignee, error: assigneeError },
    { data: membership, error: membershipError },
    { data: user, error: userError },
    capability,
  ] = await Promise.all([
    supabase
      .from("schedule_event_assignees")
      .select("event_id")
      .eq("organization_id", event.organization_id)
      .eq("event_id", event.id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", event.organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("users")
      .select("role, is_active")
      .eq("id", userId)
      .maybeSingle(),
    getGoogleScheduleCapability(userId, event.organization_id),
  ]);

  if (assigneeError) throw assigneeError;
  if (membershipError) throw membershipError;
  if (userError) throw userError;
  if (!capability.allowed) return false;
  if (user?.role === "super_admin" && user?.is_active !== false) return true;
  if (!membership) return false;
  if (["owner", "admin"].includes(String(membership.role || "").toLowerCase()))
    return true;
  if (event.user_id === userId) return true;
  if (assignee) return true;
  return false;
}

export async function createOAuthState(params: {
  userId: string;
  organizationId: string;
  returnUrl?: string | null;
}) {
  const state = randomToken(32);
  const stateHash = await sha256Hex(state);

  const { error } = await supabase.from("google_calendar_oauth_states").insert({
    state_hash: stateHash,
    organization_id: params.organizationId,
    user_id: params.userId,
    return_url: safeReturnUrl(params.returnUrl),
    expires_at: addSeconds(10 * 60),
  });

  if (error) throw error;
  return state;
}

export async function consumeOAuthState(rawState: string) {
  const stateHash = await sha256Hex(rawState);
  const { data, error } = await supabase
    .from("google_calendar_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Estado OAuth invalido ou expirado.");

  return data as JsonRecord;
}

export function buildGoogleAuthUrl(state: string) {
  const config = getGoogleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeOAuthCode(code: string) {
  const config = getGoogleOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error_description || data.error || "Falha ao trocar codigo OAuth.",
    );
  return data as JsonRecord;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error_description || data.error || "Falha ao buscar conta Google.",
    );
  return data as JsonRecord;
}

export async function saveTokenSecret(params: {
  existingSecretRef?: string | null;
  userId: string;
  accountEmail?: string | null;
  token: JsonRecord;
}) {
  const name = `google-calendar-${params.userId}-${params.accountEmail || "account"}`;
  const description = "Vimob CRM Google Calendar OAuth token";
  const secret = JSON.stringify(params.token);

  const { data, error } = await supabase.rpc(
    "google_calendar_save_token_secret",
    {
      p_existing_secret_ref: params.existingSecretRef || null,
      p_secret: secret,
      p_name: name,
      p_description: description,
    },
  );
  if (error) throw error;
  return String(data);
}

export async function readTokenSecret(secretRef: string) {
  const { data, error } = await supabase.rpc(
    "google_calendar_get_token_secret",
    {
      p_secret_ref: secretRef,
    },
  );

  if (error) throw error;
  if (!data) throw new Error("Token Google nao encontrado no Vault.");

  try {
    return JSON.parse(String(data)) as JsonRecord;
  } catch {
    throw new Error("Token Google invalido no Vault.");
  }
}

export async function upsertConnectionFromOAuth(params: {
  state: JsonRecord;
  tokenResponse: JsonRecord;
  userInfo: JsonRecord;
}) {
  const expiresAt = params.tokenResponse.expires_in
    ? addSeconds(Number(params.tokenResponse.expires_in) - 60)
    : null;
  const accountEmail = normalizeGoogleAccountEmail(params.userInfo.email);
  if (!accountEmail)
    throw new Error("A conta Google nao retornou um e-mail valido.");

  const { data: existingConnections, error: existingError } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("organization_id", params.state.organization_id)
    .eq("user_id", params.state.user_id)
    .order("updated_at", { ascending: false });

  if (existingError) throw existingError;
  const existing = selectReusableGoogleCalendarConnection(
    (existingConnections || []) as JsonRecord[],
    accountEmail,
  );

  const previousToken = existing?.token_secret_ref
    ? await readTokenSecret(existing.token_secret_ref).catch(() => null)
    : null;

  const tokenSecretRef = await saveTokenSecret({
    existingSecretRef: existing?.token_secret_ref,
    userId: params.state.user_id,
    accountEmail,
    token: {
      access_token: params.tokenResponse.access_token,
      refresh_token:
        params.tokenResponse.refresh_token ||
        previousToken?.refresh_token ||
        null,
      expires_at: expiresAt,
      scope: params.tokenResponse.scope,
      token_type: params.tokenResponse.token_type,
    },
  });

  const row = {
    organization_id: params.state.organization_id,
    user_id: params.state.user_id,
    account_email: existing?.account_email || accountEmail,
    account_picture_url: params.userInfo.picture || null,
    token_secret_ref: tokenSecretRef,
    scopes: String(params.tokenResponse.scope || "")
      .split(/\s+/)
      .filter(Boolean),
    expires_at: expiresAt,
    calendar_id: existing?.calendar_id || "primary",
    calendar_summary: existing?.calendar_summary || "Agenda principal",
    sync_enabled: true,
    sync_status: "connected",
    disconnected_at: null,
    connected_at: new Date().toISOString(),
    last_error: null,
  };

  const query = existing
    ? supabase.from("google_calendar_tokens").update(row).eq("id", existing.id)
    : supabase.from("google_calendar_tokens").insert(row);
  const { data, error } = await query.select("*").single();

  if (error) throw error;
  return data as JsonRecord;
}

export async function getConnectionById(connectionId: string) {
  const { data, error } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("id", connectionId)
    .is("disconnected_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Conexao Google Calendar nao encontrada.");
  return data as JsonRecord;
}

export async function getConnectionForUser(
  userId: string,
  organizationId: string,
  options: { requireSyncEnabled?: boolean } = {},
) {
  const query = supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .is("disconnected_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (options.requireSyncEnabled !== false) {
    query.eq("sync_enabled", true);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as JsonRecord | null;
}

export async function refreshAccessToken(connection: JsonRecord) {
  const token = await readTokenSecret(connection.token_secret_ref);
  const expiresAt = token.expires_at ? new Date(token.expires_at).getTime() : 0;

  if (token.access_token && expiresAt > Date.now() + 90_000) {
    return { connection, token };
  }

  if (!token.refresh_token) {
    throw new Error(
      "Google nao retornou refresh_token. Reconecte a conta com consentimento.",
    );
  }

  const config = getGoogleOAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error_description || data.error || "Falha ao renovar token Google.",
    );

  const nextToken = {
    ...token,
    access_token: data.access_token,
    expires_at: addSeconds(Number(data.expires_in || 3600) - 60),
    scope: data.scope || token.scope,
    token_type: data.token_type || token.token_type,
  };

  await saveTokenSecret({
    existingSecretRef: connection.token_secret_ref,
    userId: connection.user_id,
    accountEmail: connection.account_email,
    token: nextToken,
  });

  const { data: updated, error } = await supabase
    .from("google_calendar_tokens")
    .update({ expires_at: nextToken.expires_at, last_error: null })
    .eq("id", connection.id)
    .select("*")
    .single();

  if (error) throw error;
  return { connection: updated as JsonRecord, token: nextToken };
}

export function buildGoogleCalendarApiUrl(path: string) {
  let relativePath = path;

  if (relativePath === GOOGLE_CALENDAR_PATH_PREFIX) {
    relativePath = "";
  } else if (
    relativePath.startsWith(`${GOOGLE_CALENDAR_PATH_PREFIX}/`) ||
    relativePath.startsWith(`${GOOGLE_CALENDAR_PATH_PREFIX}?`)
  ) {
    relativePath = relativePath.slice(GOOGLE_CALENDAR_PATH_PREFIX.length);
  }

  if (
    relativePath &&
    !relativePath.startsWith("/") &&
    !relativePath.startsWith("?")
  ) {
    relativePath = `/${relativePath}`;
  }

  return `${GOOGLE_CALENDAR_BASE_URL}${relativePath}`;
}

export async function googleFetch(
  connection: JsonRecord,
  path: string,
  init: RequestInit = {},
) {
  const requestUrl = buildGoogleCalendarApiUrl(path);
  let refreshed = await refreshAccessToken(connection);
  let response = await fetch(requestUrl, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
      Authorization: `Bearer ${refreshed.token.access_token}`,
    },
  });

  if (response.status === 401) {
    const token = await readTokenSecret(refreshed.connection.token_secret_ref);
    token.expires_at = new Date(0).toISOString();
    await saveTokenSecret({
      existingSecretRef: refreshed.connection.token_secret_ref,
      userId: refreshed.connection.user_id,
      accountEmail: refreshed.connection.account_email,
      token,
    });
    refreshed = await refreshAccessToken(refreshed.connection);
    response = await fetch(requestUrl, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
        Authorization: `Bearer ${refreshed.token.access_token}`,
      },
    });
  }

  return response;
}

class GoogleCalendarHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleCalendarHttpError";
    this.status = status;
  }
}

async function googleJson(
  connection: JsonRecord,
  path: string,
  init: RequestInit = {},
) {
  const response = await googleFetch(connection, path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new GoogleCalendarHttpError(
      data.error?.message ||
        data.error ||
        `Google Calendar error ${response.status}`,
      response.status,
    );
  }
  return data as JsonRecord;
}

async function getLinkedLead(event: JsonRecord) {
  if (!event.lead_id) return null;

  const { data, error } = await supabase
    .from("leads")
    .select("id, name")
    .eq("organization_id", event.organization_id)
    .eq("id", event.lead_id)
    .maybeSingle();
  if (error) throw error;
  return data as JsonRecord | null;
}

async function getConnectedAssigneeEmails(event: JsonRecord) {
  const { data: assignees, error: assigneesError } = await supabase
    .from("schedule_event_assignees")
    .select("user_id")
    .eq("organization_id", event.organization_id)
    .eq("event_id", event.id);
  if (assigneesError) throw assigneesError;

  const assigneeIds = Array.from(
    new Set(
      (assignees || [])
        .map((assignee) => assignee.user_id)
        .filter((userId) => userId && userId !== event.user_id),
    ),
  );
  if (assigneeIds.length === 0) return [];

  const { data: connections, error: connectionsError } = await supabase
    .from("google_calendar_tokens")
    .select("user_id, account_email")
    .eq("organization_id", event.organization_id)
    .eq("sync_enabled", true)
    .is("disconnected_at", null)
    .in("user_id", assigneeIds);
  if (connectionsError) throw connectionsError;

  return (connections || []).map((connection) => connection.account_email);
}

async function getOutboundEventContext(event: JsonRecord) {
  const [lead, attendeeEmails] = await Promise.all([
    getLinkedLead(event),
    getConnectedAssigneeEmails(event),
  ]);

  // A schedule assignee is not necessarily allowed to view the linked
  // property under the canonical own/team/all property scope. Google sends the
  // same event body to every connected attendee, so omit generated property
  // title/code until every effective recipient can be proven authorized.
  return {
    event: { ...event, lead, property: null },
    attendeeEmails,
  };
}

async function getOrganizationTimeZone(organizationId: string) {
  const { data, error } = await supabase
    .from("organization_attention_settings")
    .select("timezone")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;

  return normalizeGoogleCalendarTimeZone(data?.timezone);
}

function scheduleEventToGoogle(
  event: JsonRecord,
  attendeeEmails: unknown[],
  organizationTimeZone: string,
  organizerEmail?: unknown,
) {
  const timeZone = normalizeGoogleCalendarTimeZone(organizationTimeZone);
  const isAllDay = Boolean(event.is_all_day);
  const body: JsonRecord = {
    summary: buildGoogleEventSummary(event),
    description: buildGoogleEventDescription(event),
    location: event.location || undefined,
    status:
      event.status === "cancelled" || event.status === "canceled"
        ? "cancelled"
        : "confirmed",
    visibility: event.visibility === "private" ? "private" : "default",
    attendees: buildGoogleEventAttendees(attendeeEmails, [organizerEmail]),
    extendedProperties: buildVimobGoogleExtendedProperties(event),
  };

  if (isAllDay) {
    body.start = {
      date: scheduleInstantToGoogleDate(event.start_time, timeZone),
    };
    // Google treats all-day event ends as exclusive; Vimob stores the final
    // included day.
    body.end = {
      date: nextGoogleCivilDate(
        scheduleInstantToGoogleDate(event.end_time, timeZone),
      ),
    };
  } else {
    body.start = { dateTime: event.start_time, timeZone };
    body.end = { dateTime: event.end_time, timeZone };
  }

  const reminderSettings = buildGoogleReminderSettings(event.reminder_minutes);
  if (reminderSettings) body.reminders = reminderSettings;

  return body;
}

function googleEventToSchedule(
  connection: JsonRecord,
  googleEvent: JsonRecord,
  organizationTimeZone: string,
) {
  const parsedIdentity = readVimobGoogleEventIdentity(googleEvent);
  const identity = identityBelongsToOrganization(
    parsedIdentity,
    connection.organization_id,
  )
    ? parsedIdentity
    : null;
  const isAllDay = Boolean(googleEvent.start?.date);
  const allDayRange = isAllDay
    ? googleAllDayRangeToScheduleRange(
        String(googleEvent.start.date),
        String(
          googleEvent.end?.date ||
            nextGoogleCivilDate(String(googleEvent.start.date)),
        ),
        organizationTimeZone,
      )
    : null;
  const startTime =
    allDayRange?.startTime ||
    toISO(googleEvent.start?.dateTime || googleEvent.start?.date);
  const endTime =
    allDayRange?.endTime ||
    toISO(googleEvent.end?.dateTime || googleEvent.end?.date);

  return {
    organization_id: connection.organization_id,
    user_id: connection.user_id,
    title: limitedText(googleEvent.summary, 180, "Evento Google Agenda"),
    description: limitedText(
      identity
        ? stripVimobLinkedDescription(googleEvent.description)
        : googleEvent.description,
      2000,
    ),
    event_type: GOOGLE_EVENT_TYPES.has(identity?.eventType || "")
      ? identity?.eventType
      : "meeting",
    start_time: startTime || new Date().toISOString(),
    end_time: endTime || startTime || new Date().toISOString(),
    is_all_day: isAllDay,
    location: limitedText(googleEvent.location, 500),
    status: googleEvent.status === "cancelled" ? "cancelled" : "scheduled",
    visibility: googleEvent.visibility === "private" ? "private" : "default",
    reminder_minutes: null,
    google_event_id: googleEvent.id,
    google_calendar_connection_id: connection.id,
    google_calendar_id: normalizeCalendarId(connection.calendar_id),
    google_sync_status: "synced",
    google_last_synced_at: new Date().toISOString(),
    google_sync_error: null,
  };
}

function googleScheduleSyncMetadata(
  connection: JsonRecord,
  googleEvent: JsonRecord,
) {
  return {
    google_event_id: googleEvent.id,
    google_calendar_connection_id: connection.id,
    google_calendar_id: normalizeCalendarId(connection.calendar_id),
    google_sync_status: "synced",
    google_last_synced_at: new Date().toISOString(),
    google_sync_error: null,
  };
}

async function findOwnedScheduleEvent(
  connection: JsonRecord,
  scheduleEventId: unknown,
) {
  if (!scheduleEventId) return null;

  const { data, error } = await supabase
    .from("schedule_events")
    .select("*")
    .eq("id", scheduleEventId)
    .eq("organization_id", connection.organization_id)
    .eq("user_id", connection.user_id)
    .maybeSingle();
  if (error) throw error;
  return data as JsonRecord | null;
}

async function findScheduleEventForConnection(
  connection: JsonRecord,
  scheduleEventId: unknown,
  expectedOwnerUserId?: string | null,
) {
  if (!scheduleEventId) return null;

  const { data: event, error: eventError } = await supabase
    .from("schedule_events")
    .select("*")
    .eq("id", scheduleEventId)
    .eq("organization_id", connection.organization_id)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!event) return null;
  if (expectedOwnerUserId && event.user_id !== expectedOwnerUserId) return null;
  if (event.user_id === connection.user_id) {
    return { event: event as JsonRecord, authority: "owner" as const };
  }

  const { data: assignee, error: assigneeError } = await supabase
    .from("schedule_event_assignees")
    .select("event_id")
    .eq("organization_id", connection.organization_id)
    .eq("event_id", event.id)
    .eq("user_id", connection.user_id)
    .maybeSingle();
  if (assigneeError) throw assigneeError;
  if (!assignee) return null;
  return { event: event as JsonRecord, authority: "assignee" as const };
}

async function preserveFinalScheduleLifecycle(
  connection: JsonRecord,
  currentEvent: JsonRecord,
  googleEvent: JsonRecord,
) {
  const { data, error } = await supabase
    .from("schedule_events")
    .update(googleScheduleSyncMetadata(connection, googleEvent))
    .eq("id", currentEvent.id)
    .eq("organization_id", connection.organization_id)
    .eq("user_id", connection.user_id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data || currentEvent) as JsonRecord;
}

async function applyGoogleCancellationToSchedule(
  connection: JsonRecord,
  scheduleEventId: unknown,
  googleEvent: JsonRecord,
) {
  const access = await findScheduleEventForConnection(
    connection,
    scheduleEventId,
  );
  if (!access) return null;
  // An attendee deleting or declining their Google copy must never cancel the
  // organizer's canonical Vimob appointment.
  if (access.authority !== "owner") return access.event;

  const currentEvent = access.event;
  if (isFinalVimobScheduleStatus(currentEvent.status)) {
    return preserveFinalScheduleLifecycle(
      connection,
      currentEvent,
      googleEvent,
    );
  }

  const { data, error } = await supabase
    .from("schedule_events")
    .update({
      status: "cancelled",
      outcome: "cancelled",
      ...googleScheduleSyncMetadata(connection, googleEvent),
    })
    .eq("id", currentEvent.id)
    .eq("organization_id", connection.organization_id)
    .eq("user_id", connection.user_id)
    .eq("status", "scheduled")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (data) return data as JsonRecord;

  // A Vimob outcome may have won the race after the initial read. Never
  // reopen or overwrite it with the provider's lifecycle.
  const latestEvent = await findOwnedScheduleEvent(connection, currentEvent.id);
  if (latestEvent && isFinalVimobScheduleStatus(latestEvent.status)) {
    return preserveFinalScheduleLifecycle(connection, latestEvent, googleEvent);
  }
  return latestEvent;
}

async function findEventLink(connection: JsonRecord, googleEvent: JsonRecord) {
  const { data: exactLink, error: exactLinkError } = await supabase
    .from("google_calendar_event_links")
    .select("*")
    .eq("organization_id", connection.organization_id)
    .eq("connection_id", connection.id)
    .eq("google_calendar_id", normalizeCalendarId(connection.calendar_id))
    .eq("google_event_id", googleEvent.id)
    .maybeSingle();
  if (exactLinkError) throw exactLinkError;
  if (exactLink) return exactLink as JsonRecord;

  const identity = readVimobGoogleEventIdentity(googleEvent);
  if (identityBelongsToOrganization(identity, connection.organization_id)) {
    const access = await findScheduleEventForConnection(
      connection,
      identity!.eventId,
      identity!.ownerUserId,
    );
    if (access) {
      return {
        organization_id: connection.organization_id,
        connection_id: connection.id,
        schedule_event_id: access.event.id,
        resolved_by: identity!.source,
      };
    }
  }

  const googleIcalUid = limitedText(googleEvent.iCalUID, 1024);
  if (!googleIcalUid) return null;

  const { data: matchingLinks, error: matchingLinksError } = await supabase
    .from("google_calendar_event_links")
    .select("schedule_event_id")
    .eq("organization_id", connection.organization_id)
    .eq("google_ical_uid", googleIcalUid)
    .not("schedule_event_id", "is", null)
    .limit(10);
  if (matchingLinksError) throw matchingLinksError;

  const candidateEventIds = Array.from(
    new Set(
      (matchingLinks || [])
        .map((link) => link.schedule_event_id)
        .filter(Boolean),
    ),
  );
  if (candidateEventIds.length > 1) {
    throw new Error("Identidade Google Agenda ambigua para esta organizacao.");
  }
  if (candidateEventIds.length === 1) {
    const access = await findScheduleEventForConnection(
      connection,
      candidateEventIds[0],
    );
    if (access) {
      return {
        organization_id: connection.organization_id,
        connection_id: connection.id,
        schedule_event_id: access.event.id,
        resolved_by: "ical_uid",
      };
    }
  }

  return null;
}

async function upsertEventLink(params: {
  connection: JsonRecord;
  scheduleEventId: string | null;
  googleEvent: JsonRecord;
  origin: "vimob" | "google" | "sync";
  lastError?: string | null;
}) {
  const row = {
    organization_id: params.connection.organization_id,
    connection_id: params.connection.id,
    schedule_event_id: params.scheduleEventId,
    google_calendar_id: normalizeCalendarId(params.connection.calendar_id),
    google_event_id: params.googleEvent.id,
    google_etag: params.googleEvent.etag || null,
    google_ical_uid: params.googleEvent.iCalUID || null,
    google_html_link: params.googleEvent.htmlLink || null,
    google_status: params.googleEvent.status || null,
    google_updated_at: toISO(params.googleEvent.updated),
    last_origin: params.origin,
    last_synced_at: new Date().toISOString(),
    last_error: params.lastError || null,
    deleted_at:
      params.googleEvent.status === "cancelled"
        ? new Date().toISOString()
        : null,
  };

  if (params.scheduleEventId) {
    const { data: existingScheduleLink, error: existingScheduleLinkError } =
      await supabase
        .from("google_calendar_event_links")
        .select("id")
        .eq("organization_id", params.connection.organization_id)
        .eq("connection_id", params.connection.id)
        .eq("schedule_event_id", params.scheduleEventId)
        .maybeSingle();
    if (existingScheduleLinkError) throw existingScheduleLinkError;
    if (existingScheduleLink) {
      const { data, error } = await supabase
        .from("google_calendar_event_links")
        .update(row)
        .eq("id", existingScheduleLink.id)
        .eq("organization_id", params.connection.organization_id)
        .select("*")
        .single();
      if (error) throw error;
      return data as JsonRecord;
    }
  }

  const { data, error } = await supabase
    .from("google_calendar_event_links")
    .upsert(row, {
      onConflict: "connection_id,google_calendar_id,google_event_id",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as JsonRecord;
}

type GoogleSyncExecutionContext = {
  trustedJobOrganizationId?: string | null;
};

export async function pushScheduleEventToGoogle(
  eventId: string,
  actorUserId?: string | null,
  execution: GoogleSyncExecutionContext = {},
) {
  const { data: event, error: eventError } = await supabase
    .from("schedule_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!event) throw new Error("Evento da agenda nao encontrado.");

  const trustedJobOrganizationId = String(
    execution.trustedJobOrganizationId || "",
  ).trim();
  if (trustedJobOrganizationId) {
    if (event.organization_id !== trustedJobOrganizationId) {
      throw new Error("Job Google Agenda fora da organizacao do evento.");
    }
    if (!actorUserId) {
      throw new Error("Job Google Agenda sem autor autorizado.");
    }
    // The Go API already enforced event/team scope before inserting this
    // service-only job. Revalidate the actor's current tenant capability, but
    // do not incorrectly reduce team-leader scope to direct participation.
    await assertGoogleScheduleCapability(actorUserId, trustedJobOrganizationId);
  } else if (!actorUserId) {
    await assertGoogleScheduleCapability(event.user_id, event.organization_id);
  } else if (!(await canManageScheduleEvent(event, actorUserId))) {
    throw new Error("Sem permissao para sincronizar este evento.");
  }

  // Pausing automatic sync stops Google -> Vimob watches/pulls. Explicit edits
  // made by the user in Vimob still need to reach Google so the two calendars
  // do not silently diverge while the connection remains valid.
  const connection = await getConnectionForUser(
    event.user_id,
    event.organization_id,
    {
      requireSyncEnabled: false,
    },
  );
  if (!connection) {
    const { error: statusError } = await supabase
      .from("schedule_events")
      .update({ google_sync_status: "not_connected" })
      .eq("id", event.id);
    if (statusError) throw statusError;
    return { skipped: true, reason: "NO_CONNECTION" };
  }

  const calendarId = encodeURIComponent(
    normalizeCalendarId(connection.calendar_id),
  );
  const { data: link, error: linkError } = await supabase
    .from("google_calendar_event_links")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("schedule_event_id", event.id)
    .maybeSingle();
  if (linkError) throw linkError;

  const [outboundContext, organizationTimeZone] = await Promise.all([
    getOutboundEventContext(event),
    getOrganizationTimeZone(event.organization_id),
  ]);
  const body = scheduleEventToGoogle(
    outboundContext.event,
    outboundContext.attendeeEmails,
    organizationTimeZone,
    connection.account_email,
  );
  const deterministicEventId = buildVimobGoogleEventId(event.id);
  const createOrRecoverGoogleEvent = async () => {
    try {
      return await googleJson(
        connection,
        `/calendars/${calendarId}/events?sendUpdates=all`,
        {
          method: "POST",
          body: JSON.stringify({ ...body, id: deterministicEventId }),
        },
      );
    } catch (error) {
      if (!(error instanceof GoogleCalendarHttpError) || error.status !== 409)
        throw error;
      return googleJson(
        connection,
        `/calendars/${calendarId}/events/${encodeURIComponent(deterministicEventId)}?sendUpdates=all`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
    }
  };

  let googleEvent: JsonRecord;
  if (link?.google_event_id && !link.deleted_at) {
    try {
      googleEvent = await googleJson(
        connection,
        `/calendars/${calendarId}/events/${encodeURIComponent(link.google_event_id)}?sendUpdates=all`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
    } catch (error) {
      if (
        !(error instanceof GoogleCalendarHttpError) ||
        ![404, 410].includes(error.status)
      )
        throw error;
      googleEvent = await createOrRecoverGoogleEvent();
    }
  } else {
    googleEvent = await createOrRecoverGoogleEvent();
  }

  await upsertEventLink({
    connection,
    scheduleEventId: event.id,
    googleEvent,
    origin: "vimob",
  });

  const { error: eventUpdateError } = await supabase
    .from("schedule_events")
    .update({
      google_event_id: googleEvent.id,
      google_calendar_connection_id: connection.id,
      google_calendar_id: normalizeCalendarId(connection.calendar_id),
      google_sync_status: "synced",
      google_last_synced_at: new Date().toISOString(),
      google_sync_error: null,
    })
    .eq("id", event.id);
  if (eventUpdateError) throw eventUpdateError;

  return { synced: true, google_event_id: googleEvent.id };
}

export async function deleteScheduleEventFromGoogle(
  eventId: string,
  actorUserId?: string | null,
  durableLinkIds: string[] = [],
  execution: GoogleSyncExecutionContext = {},
) {
  const { data: event, error: eventError } = await supabase
    .from("schedule_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) throw eventError;
  const trustedJobOrganizationId = String(
    execution.trustedJobOrganizationId || "",
  ).trim();
  if (
    trustedJobOrganizationId &&
    event &&
    event.organization_id !== trustedJobOrganizationId
  ) {
    throw new Error("Job Google Agenda fora da organizacao do evento.");
  }
  const organizationId =
    trustedJobOrganizationId || event?.organization_id || null;
  if (!organizationId) {
    throw new Error("Evento da agenda nao encontrado.");
  }
  if (actorUserId) {
    await assertGoogleScheduleCapability(actorUserId, organizationId);
    if (
      event &&
      !trustedJobOrganizationId &&
      !(await canManageScheduleEvent(event, actorUserId))
    ) {
      throw new Error("Sem permissao para remover este evento do Google.");
    }
    if (!event && durableLinkIds.length === 0) {
      throw new Error("Evento da agenda nao encontrado.");
    }
  } else {
    throw new Error("Autor da remocao Google Agenda nao informado.");
  }

  let linksQuery = supabase
    .from("google_calendar_event_links")
    .select("*, google_calendar_tokens(*)")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  linksQuery =
    durableLinkIds.length > 0
      ? linksQuery.in("id", durableLinkIds)
      : linksQuery.eq("schedule_event_id", eventId);
  const { data: links, error } = await linksQuery;

  if (error) throw error;
  let deleted = 0;

  for (const link of links || []) {
    const connection = link.google_calendar_tokens;
    if (connection?.organization_id !== organizationId) {
      throw new Error("Vinculo Google Agenda fora da organizacao autorizada.");
    }
    if (!connection?.token_secret_ref) continue;
    const calendarId = encodeURIComponent(
      normalizeCalendarId(link.google_calendar_id),
    );
    const eventPath = `/calendars/${calendarId}/events/${encodeURIComponent(link.google_event_id)}`;
    const response = await googleFetch(connection, eventPath, {
      method: "DELETE",
    });
    if (!response.ok && ![404, 410].includes(response.status)) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data.error?.message ||
          `Falha ao remover evento Google (${response.status}).`,
      );
    }

    const { error: linkUpdateError } = await supabase
      .from("google_calendar_event_links")
      .update({
        deleted_at: new Date().toISOString(),
        last_origin: "vimob",
        last_synced_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", link.id)
      .eq("organization_id", organizationId);
    if (linkUpdateError) throw linkUpdateError;
    deleted += 1;
  }

  return { deleted };
}

async function upsertGoogleEventIntoSchedule(
  connection: JsonRecord,
  googleEvent: JsonRecord,
  organizationTimeZone: string,
) {
  const link = await findEventLink(connection, googleEvent);
  const identity = readVimobGoogleEventIdentity(googleEvent);
  const trustedIdentity = identityBelongsToOrganization(
    identity,
    connection.organization_id,
  )
    ? identity
    : null;

  if (googleEvent.status === "cancelled") {
    if (link?.schedule_event_id) {
      const cancelledEvent = await applyGoogleCancellationToSchedule(
        connection,
        link.schedule_event_id,
        googleEvent,
      );
      if (!cancelledEvent) {
        throw new Error("Vinculo Google Agenda fora do escopo desta conexao.");
      }
    }
    await upsertEventLink({
      connection,
      scheduleEventId: link?.schedule_event_id || null,
      googleEvent,
      origin: "google",
    });
    return { cancelled: true };
  }

  const scheduleRow = googleEventToSchedule(
    connection,
    googleEvent,
    organizationTimeZone,
  );
  const targetEventId =
    link?.schedule_event_id || trustedIdentity?.eventId || null;

  let scheduleEvent: JsonRecord | null = null;
  if (targetEventId) {
    const access = await findScheduleEventForConnection(
      connection,
      targetEventId,
      ["shared", "private"].includes(String(link?.resolved_by || "")) &&
        trustedIdentity?.eventId === targetEventId
        ? trustedIdentity.ownerUserId
        : null,
    );
    if (!access && link?.schedule_event_id) {
      throw new Error("Vinculo Google Agenda fora do escopo desta conexao.");
    }

    // Attendee copies share the canonical Vimob identity, but only the
    // organizer's Google connection may mutate the canonical event. The copy
    // still receives its own durable per-connection link below.
    if (access?.authority === "assignee") {
      scheduleEvent = access.event;
    } else if (access && isFinalVimobScheduleStatus(access.event.status)) {
      const currentEvent = access.event;
      scheduleEvent = await preserveFinalScheduleLifecycle(
        connection,
        currentEvent,
        googleEvent,
      );
    } else if (access) {
      const { data, error } = await supabase
        .from("schedule_events")
        .update(scheduleRow)
        .eq("id", targetEventId)
        .eq("organization_id", connection.organization_id)
        .eq("user_id", connection.user_id)
        .eq("status", "scheduled")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      scheduleEvent = data as JsonRecord | null;

      if (!scheduleEvent) {
        const latestEvent = await findOwnedScheduleEvent(
          connection,
          targetEventId,
        );
        if (latestEvent && isFinalVimobScheduleStatus(latestEvent.status)) {
          scheduleEvent = await preserveFinalScheduleLifecycle(
            connection,
            latestEvent,
            googleEvent,
          );
        } else {
          scheduleEvent = latestEvent;
        }
      }
    }
  }

  if (!scheduleEvent) {
    const { data, error } = await supabase
      .from("schedule_events")
      .insert(scheduleRow)
      .select("*")
      .single();
    if (error) throw error;
    scheduleEvent = data as JsonRecord;
  }

  await upsertEventLink({
    connection,
    scheduleEventId: scheduleEvent.id,
    googleEvent,
    origin: "google",
  });
  return { schedule_event_id: scheduleEvent.id };
}

async function reconcileMissingGoogleEvents(
  connection: JsonRecord,
  seenGoogleEventIds: Set<string>,
) {
  const { data: activeLinks, error } = await supabase
    .from("google_calendar_event_links")
    .select("id, schedule_event_id, google_event_id")
    .eq("connection_id", connection.id)
    .is("deleted_at", null);
  if (error) throw error;

  const missingLinks = (activeLinks || []).filter(
    (link) => !seenGoogleEventIds.has(String(link.google_event_id || "")),
  );
  if (missingLinks.length === 0) return 0;

  const reconciledAt = new Date().toISOString();
  for (const link of missingLinks) {
    if (link.schedule_event_id) {
      await applyGoogleCancellationToSchedule(
        connection,
        link.schedule_event_id,
        {
          id: link.google_event_id,
          status: "cancelled",
        },
      );
    }

    const { error: linkError } = await supabase
      .from("google_calendar_event_links")
      .update({
        google_status: "cancelled",
        deleted_at: reconciledAt,
        last_origin: "google",
        last_synced_at: reconciledAt,
        last_error: null,
      })
      .eq("id", link.id)
      .eq("organization_id", connection.organization_id);
    if (linkError) throw linkError;
  }

  return missingLinks.length;
}

export async function syncConnectionFromGoogle(
  connectionInput: JsonRecord,
  fullSync = false,
) {
  let connection = connectionInput;
  await assertGoogleScheduleCapability(
    connection.user_id,
    connection.organization_id,
  );
  const organizationTimeZone = await getOrganizationTimeZone(
    connection.organization_id,
  );
  const calendarId = encodeURIComponent(
    normalizeCalendarId(connection.calendar_id),
  );
  let pageToken: string | null = null;
  let syncToken = fullSync ? null : connection.sync_token || null;
  let nextSyncToken: string | null = null;
  let performedFullSync = fullSync || !syncToken;
  let processed = 0;
  const seenGoogleEventIds = new Set<string>();

  try {
    const { error: startError } = await supabase
      .from("google_calendar_tokens")
      .update({ sync_status: "syncing", last_error: null })
      .eq("id", connection.id);
    if (startError) throw startError;

    while (true) {
      const url = new URL(
        `${GOOGLE_CALENDAR_BASE_URL}/calendars/${calendarId}/events`,
      );
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      if (syncToken) url.searchParams.set("syncToken", syncToken);

      const response = await googleFetch(connection, url.pathname + url.search);

      if (response.status === 410 && syncToken) {
        syncToken = null;
        pageToken = null;
        performedFullSync = true;
        processed = 0;
        seenGoogleEventIds.clear();
        continue;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.error?.message ||
            `Google Calendar sync error ${response.status}`,
        );

      for (const googleEvent of data.items || []) {
        if (googleEvent.id) seenGoogleEventIds.add(String(googleEvent.id));
        await upsertGoogleEventIntoSchedule(
          connection,
          googleEvent,
          organizationTimeZone,
        );
        processed += 1;
      }

      pageToken = data.nextPageToken || null;
      if (!pageToken && !data.nextSyncToken) {
        throw new Error(
          "Google Calendar nao retornou nextSyncToken ao concluir a sincronizacao.",
        );
      }
      if (!pageToken && data.nextSyncToken) {
        nextSyncToken = String(data.nextSyncToken);
        connection = {
          ...connection,
          sync_token: nextSyncToken,
        };
      }
      if (!pageToken) break;
    }

    const reconciled = performedFullSync
      ? await reconcileMissingGoogleEvents(connection, seenGoogleEventIds)
      : 0;

    const { error: completionError } = await supabase
      .from("google_calendar_tokens")
      .update({
        sync_token: nextSyncToken,
        sync_status: "connected",
        last_synced_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", connection.id);
    if (completionError) throw completionError;

    return { processed, reconciled };
  } catch (error) {
    await supabase
      .from("google_calendar_tokens")
      .update({ sync_status: "error", last_error: errorMessage(error) })
      .eq("id", connection.id);
    throw error;
  }
}

export async function ensureGoogleWatch(connection: JsonRecord) {
  if (connection.sync_enabled === false || connection.disconnected_at) {
    return { skipped: true, reason: "SYNC_DISABLED" };
  }
  const capability = await getGoogleScheduleCapability(
    connection.user_id,
    connection.organization_id,
  );
  if (!capability.allowed) {
    return { skipped: true, reason: capability.reason };
  }

  const configuredWebhookUrl = getGoogleOAuthConfig().webhookUrl;
  if (!configuredWebhookUrl) return { skipped: true, reason: "NO_WEBHOOK_URL" };
  const webhookUrl = validatedGoogleWebhookUrl(configuredWebhookUrl);

  const calendarId = normalizeCalendarId(connection.calendar_id);
  const reusableAfter = new Date(
    Date.now() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: activeChannels, error: activeChannelsError } = await supabase
    .from("google_calendar_channels")
    .select("*")
    .eq("connection_id", connection.id)
    .is("stopped_at", null)
    .order("expires_at", { ascending: false });
  if (activeChannelsError) throw activeChannelsError;

  const reusableChannel = (activeChannels || []).find(
    (channel) => channel.expires_at > reusableAfter,
  );
  if (reusableChannel) {
    const { error: connectionError } = await supabase
      .from("google_calendar_tokens")
      .update({
        watch_expires_at: reusableChannel.expires_at,
        last_watch_renewed_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
    if (connectionError) throw connectionError;
    return { channel_id: reusableChannel.channel_id, reused: true };
  }

  const channelId = crypto.randomUUID();
  const channelToken = randomToken(32);
  const expirationMs = Date.now() + 6 * 24 * 60 * 60 * 1000;

  const googleChannel = await googleJson(
    connection,
    `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: channelToken,
        expiration: String(expirationMs),
      }),
    },
  );

  const { error: channelInsertError } = await supabase
    .from("google_calendar_channels")
    .insert({
      organization_id: connection.organization_id,
      connection_id: connection.id,
      channel_id: channelId,
      resource_id: googleChannel.resourceId || null,
      resource_uri: googleChannel.resourceUri || null,
      calendar_id: calendarId,
      token_hash: await sha256Hex(channelToken),
      expires_at: googleChannel.expiration
        ? new Date(Number(googleChannel.expiration)).toISOString()
        : new Date(expirationMs).toISOString(),
    });
  if (channelInsertError) {
    await googleFetch(connection, "/channels/stop", {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        resourceId: googleChannel.resourceId,
      }),
    }).catch(() => null);
    throw channelInsertError;
  }

  const { error: connectionUpdateError } = await supabase
    .from("google_calendar_tokens")
    .update({
      watch_expires_at: googleChannel.expiration
        ? new Date(Number(googleChannel.expiration)).toISOString()
        : new Date(expirationMs).toISOString(),
      last_watch_renewed_at: new Date().toISOString(),
    })
    .eq("id", connection.id);
  if (connectionUpdateError) throw connectionUpdateError;

  for (const oldChannel of activeChannels || []) {
    await googleFetch(connection, "/channels/stop", {
      method: "POST",
      body: JSON.stringify({
        id: oldChannel.channel_id,
        resourceId: oldChannel.resource_id,
      }),
    }).catch(() => null);
    const { error: stopError } = await supabase
      .from("google_calendar_channels")
      .update({ stopped_at: new Date().toISOString() })
      .eq("id", oldChannel.id);
    if (stopError) throw stopError;
  }

  return { channel_id: channelId };
}

export async function stopGoogleWatches(connection: JsonRecord) {
  const { data: channels, error: channelsError } = await supabase
    .from("google_calendar_channels")
    .select("*")
    .eq("connection_id", connection.id)
    .is("stopped_at", null);
  if (channelsError) throw channelsError;

  const warnings: string[] = [];
  for (const channel of channels || []) {
    if (channel.resource_id) {
      try {
        const response = await googleFetch(connection, "/channels/stop", {
          method: "POST",
          body: JSON.stringify({
            id: channel.channel_id,
            resourceId: channel.resource_id,
          }),
        });
        if (!response.ok && ![404, 410].includes(response.status)) {
          warnings.push(
            `Google recusou a parada do canal ${channel.channel_id} (${response.status}).`,
          );
        }
      } catch (error) {
        warnings.push(errorMessage(error));
      }
    }

    const { error: stopError } = await supabase
      .from("google_calendar_channels")
      .update({ stopped_at: new Date().toISOString() })
      .eq("id", channel.id);
    if (stopError) throw stopError;
  }

  const { error: connectionError } = await supabase
    .from("google_calendar_tokens")
    .update({ watch_expires_at: null })
    .eq("id", connection.id);
  if (connectionError) throw connectionError;

  return { stopped: (channels || []).length, warnings };
}

export async function enqueueSyncJob(params: {
  organizationId: string;
  connectionId?: string | null;
  scheduleEventId?: string | null;
  action:
    | "push_upsert"
    | "push_delete"
    | "pull_incremental"
    | "full_sync"
    | "renew_watch";
  payload?: JsonRecord;
  createdBy?: string | null;
}) {
  const { data, error } = await supabase
    .from("google_calendar_sync_jobs")
    .insert({
      organization_id: params.organizationId,
      connection_id: params.connectionId || null,
      schedule_event_id: params.scheduleEventId || null,
      action: params.action,
      payload: params.payload || {},
      created_by: params.createdBy || null,
    })
    .select("*")
    .single();

  if (
    error?.code === "23505" &&
    params.action === "pull_incremental" &&
    params.connectionId
  ) {
    const { data: existing, error: existingError } = await supabase
      .from("google_calendar_sync_jobs")
      .select("*")
      .eq("connection_id", params.connectionId)
      .eq("action", "pull_incremental")
      .in("status", ["queued", "running", "failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing as JsonRecord;
  }
  if (error) throw error;
  return data as JsonRecord;
}

export async function processSyncJob(job: JsonRecord) {
  if (job.action === "push_upsert" && job.schedule_event_id) {
    if (!job.organization_id || !job.created_by) {
      throw new Error("Job Google Agenda sem tenant ou autor autorizado.");
    }
    return pushScheduleEventToGoogle(job.schedule_event_id, job.created_by, {
      trustedJobOrganizationId: job.organization_id,
    });
  }
  if (
    job.action === "push_delete" &&
    (job.schedule_event_id || job.payload?.event_id)
  ) {
    if (!job.organization_id || !job.created_by) {
      throw new Error("Job Google Agenda sem tenant ou autor autorizado.");
    }
    const durableLinkIds = Array.isArray(job.payload?.link_ids)
      ? job.payload.link_ids.filter(
          (value: unknown): value is string => typeof value === "string",
        )
      : [];
    return deleteScheduleEventFromGoogle(
      String(job.schedule_event_id || job.payload.event_id),
      job.created_by,
      durableLinkIds,
      { trustedJobOrganizationId: job.organization_id },
    );
  }
  if (
    (job.action === "pull_incremental" || job.action === "full_sync") &&
    job.connection_id
  ) {
    const connection = await getConnectionById(job.connection_id);
    if (job.action === "pull_incremental" && connection.sync_enabled !== true) {
      return { skipped: true, reason: "SYNC_DISABLED" };
    }
    return syncConnectionFromGoogle(connection, job.action === "full_sync");
  }
  if (job.action === "renew_watch" && job.connection_id) {
    return ensureGoogleWatch(await getConnectionById(job.connection_id));
  }
  return { skipped: true, reason: "UNSUPPORTED_JOB" };
}

export async function executeSyncJob(job: JsonRecord) {
  try {
    const result = await processSyncJob(job);
    const { error } = await supabase
      .from("google_calendar_sync_jobs")
      .update({
        status: "succeeded",
        locked_at: null,
        locked_by: null,
        last_error: null,
      })
      .eq("id", job.id);
    if (error) throw error;
    return { id: job.id, ok: true, result };
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1;
    const message = errorMessage(error);
    if (job.action === "push_upsert" && job.schedule_event_id) {
      const { error: eventUpdateError } = await supabase
        .from("schedule_events")
        .update({ google_sync_status: "error", google_sync_error: message })
        .eq("id", job.schedule_event_id);
      if (eventUpdateError) {
        console.error(
          "failed to persist Google Calendar event sync error",
          eventUpdateError,
        );
      }
    }
    if (job.action === "push_delete" && Array.isArray(job.payload?.link_ids)) {
      const durableLinkIds = job.payload.link_ids.filter(
        (value: unknown): value is string => typeof value === "string",
      );
      if (durableLinkIds.length > 0) {
        const { error: linkUpdateError } = await supabase
          .from("google_calendar_event_links")
          .update({ last_error: message })
          .in("id", durableLinkIds)
          .is("deleted_at", null);
        if (linkUpdateError) {
          console.error(
            "failed to persist Google Calendar delete error",
            linkUpdateError,
          );
        }
      }
    }
    const { error: updateError } = await supabase
      .from("google_calendar_sync_jobs")
      .update({
        status: attempts >= Number(job.max_attempts || 5) ? "dead" : "failed",
        attempts,
        locked_at: null,
        locked_by: null,
        last_error: message,
        next_run_at: addSeconds(Math.min(3600, 60 * attempts)),
      })
      .eq("id", job.id);
    if (updateError) throw updateError;
    return { id: job.id, ok: false, error: message };
  }
}

export async function runDueJobs(limit = 10) {
  const { data: jobs, error } = await supabase.rpc(
    "google_calendar_claim_sync_jobs",
    {
      p_limit: Math.max(1, Math.min(Number(limit) || 10, 100)),
      p_worker: `google-calendar-sync-${crypto.randomUUID()}`,
    },
  );

  if (error) throw error;
  const results = [];

  for (const job of jobs || []) {
    results.push(await executeSyncJob(job));
  }

  return { processed: results.length, results };
}

export async function enqueueDuePulls(limit = 20, staleAfterMinutes = 6 * 60) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const boundedStaleMinutes = Math.max(
    30,
    Math.min(Number(staleAfterMinutes) || 360, 24 * 60),
  );
  const staleBefore = new Date(
    Date.now() - boundedStaleMinutes * 60 * 1000,
  ).toISOString();
  const { data: connections, error } = await supabase
    .from("google_calendar_tokens")
    .select("id, organization_id, user_id")
    .eq("sync_enabled", true)
    .eq("sync_status", "connected")
    .is("disconnected_at", null)
    .or(`last_synced_at.is.null,last_synced_at.lt.${staleBefore}`)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(boundedLimit);
  if (error) throw error;

  const jobs = [];
  const skipped = [];
  for (const connection of connections || []) {
    const capability = await getGoogleScheduleCapability(
      connection.user_id,
      connection.organization_id,
    );
    if (!capability.allowed) {
      skipped.push({ connection_id: connection.id, reason: capability.reason });
      continue;
    }
    jobs.push(
      await enqueueSyncJob({
        organizationId: connection.organization_id,
        connectionId: connection.id,
        action: "pull_incremental",
        payload: { reason: "safety_reconciliation" },
      }),
    );
  }

  return { queued: jobs.length, job_ids: jobs.map((job) => job.id), skipped };
}

export async function renewDueWatches() {
  const renewalCutoff = new Date(
    Date.now() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: connections, error } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("sync_enabled", true)
    .is("disconnected_at", null)
    .or(`watch_expires_at.is.null,watch_expires_at.lt.${renewalCutoff}`);

  if (error) throw error;
  const results = [];
  for (const connection of connections || []) {
    try {
      results.push(await ensureGoogleWatch(connection));
    } catch (error) {
      await supabase
        .from("google_calendar_tokens")
        .update({ sync_status: "error", last_error: errorMessage(error) })
        .eq("id", connection.id);
      results.push({
        connection_id: connection.id,
        error: errorMessage(error),
      });
    }
  }
  return { renewed: results.length, results };
}

export async function disconnectConnection(connection: JsonRecord) {
  await stopGoogleWatches(connection);

  const token = await readTokenSecret(connection.token_secret_ref).catch(
    () => null,
  );

  const revocationToken = token?.refresh_token || token?.access_token;
  if (revocationToken) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: revocationToken }),
    }).catch(() => null);
  }

  const { error } = await supabase.rpc(
    "google_calendar_disconnect_connection",
    {
      p_connection_id: connection.id,
    },
  );
  if (error) throw error;
}
