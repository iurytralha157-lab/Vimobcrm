/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "npm:@supabase/supabase-js@2";

export type JsonRecord = Record<string, any>;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-goog-channel-id, x-goog-channel-token, x-goog-resource-id, x-goog-resource-state",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export function jsonResponse(body: JsonRecord, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
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
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomToken(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bytesToBase64Url(array);
}

export async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function toISO(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnlyToISO(value: string, end = false) {
  const date = new Date(`${value}T00:00:00.000-03:00`);
  if (end) date.setDate(date.getDate() - 1);
  return date.toISOString();
}

function yyyyMmDd(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function normalizeCalendarId(value: string | null | undefined) {
  return value?.trim() || "primary";
}

export function getGoogleOAuthConfig() {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: env("GOOGLE_CALENDAR_REDIRECT_URI"),
    webhookUrl: optionalEnv("GOOGLE_CALENDAR_WEBHOOK_URL"),
    postConnectRedirectUrl: optionalEnv("GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL"),
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

export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id, organization_id, email, name, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.organization_id) throw new Error("Usuario sem organizacao ativa.");
  return data as JsonRecord;
}

export async function canManageScheduleEvent(event: JsonRecord, userId: string) {
  if (event.user_id === userId) return true;

  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", event.organization_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return ["owner", "admin", "manager"].includes(String(data?.role || "").toLowerCase());
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
    return_url: params.returnUrl || null,
    expires_at: addSeconds(10 * 60),
  });

  if (error) throw error;
  return state;
}

export async function consumeOAuthState(rawState: string) {
  const stateHash = await sha256Hex(rawState);
  const { data, error } = await supabase
    .from("google_calendar_oauth_states")
    .select("*")
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Estado OAuth invalido ou expirado.");

  const { error: updateError } = await supabase
    .from("google_calendar_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_hash", stateHash);
  if (updateError) throw updateError;

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
  if (!response.ok) throw new Error(data.error_description || data.error || "Falha ao trocar codigo OAuth.");
  return data as JsonRecord;
}

export async function fetchGoogleUserInfo(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "Falha ao buscar conta Google.");
  return data as JsonRecord;
}

async function createVaultSecret(secret: string, name: string, description: string) {
  const { data, error } = await supabase.schema("vault").rpc("create_secret", {
    new_secret: secret,
    new_name: name,
    new_description: description,
  });
  if (error) throw error;
  return String(data);
}

async function updateVaultSecret(secretId: string, secret: string, name: string, description: string) {
  const { error } = await supabase.schema("vault").rpc("update_secret", {
    secret_id: secretId,
    new_secret: secret,
    new_name: name,
    new_description: description,
  });
  if (error) throw error;
  return secretId;
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

  if (params.existingSecretRef) {
    return updateVaultSecret(params.existingSecretRef, secret, name, description);
  }

  return createVaultSecret(secret, name, description);
}

export async function readTokenSecret(secretRef: string) {
  const { data, error } = await supabase
    .schema("vault")
    .from("decrypted_secrets")
    .select("decrypted_secret")
    .eq("id", secretRef)
    .maybeSingle();

  if (error) throw error;
  if (!data?.decrypted_secret) throw new Error("Token Google nao encontrado no Vault.");

  try {
    return JSON.parse(data.decrypted_secret) as JsonRecord;
  } catch {
    throw new Error("Token Google invalido no Vault.");
  }
}

export async function upsertConnectionFromOAuth(params: {
  state: JsonRecord;
  tokenResponse: JsonRecord;
  userInfo: JsonRecord;
}) {
  const expiresAt = params.tokenResponse.expires_in ? addSeconds(Number(params.tokenResponse.expires_in) - 60) : null;
  const accountEmail = params.userInfo.email || null;

  const { data: existing, error: existingError } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("organization_id", params.state.organization_id)
    .eq("user_id", params.state.user_id)
    .is("disconnected_at", null)
    .maybeSingle();

  if (existingError) throw existingError;

  const previousToken = existing?.token_secret_ref
    ? await readTokenSecret(existing.token_secret_ref).catch(() => null)
    : null;

  const tokenSecretRef = await saveTokenSecret({
    existingSecretRef: existing?.token_secret_ref,
    userId: params.state.user_id,
    accountEmail,
    token: {
      access_token: params.tokenResponse.access_token,
      refresh_token: params.tokenResponse.refresh_token || previousToken?.refresh_token || null,
      expires_at: expiresAt,
      scope: params.tokenResponse.scope,
      token_type: params.tokenResponse.token_type,
    },
  });

  const row = {
    organization_id: params.state.organization_id,
    user_id: params.state.user_id,
    account_email: accountEmail,
    account_picture_url: params.userInfo.picture || null,
    token_secret_ref: tokenSecretRef,
    scopes: String(params.tokenResponse.scope || "").split(/\s+/).filter(Boolean),
    expires_at: expiresAt,
    calendar_id: existing?.calendar_id || "primary",
    calendar_summary: existing?.calendar_summary || "Agenda principal",
    sync_enabled: true,
    sync_status: "connected",
    disconnected_at: null,
    connected_at: new Date().toISOString(),
    last_error: null,
  };

  const { data, error } = await supabase
    .from("google_calendar_tokens")
    .upsert(row, { onConflict: "organization_id,user_id,account_email" })
    .select("*")
    .single();

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

export async function getConnectionForUser(userId: string) {
  const { data, error } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("sync_enabled", true)
    .is("disconnected_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
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
    throw new Error("Google nao retornou refresh_token. Reconecte a conta com consentimento.");
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
  if (!response.ok) throw new Error(data.error_description || data.error || "Falha ao renovar token Google.");

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

export async function googleFetch(connection: JsonRecord, path: string, init: RequestInit = {}) {
  let refreshed = await refreshAccessToken(connection);
  let response = await fetch(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
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
    response = await fetch(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
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

async function googleJson(connection: JsonRecord, path: string, init: RequestInit = {}) {
  const response = await googleFetch(connection, path, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error?.message || data.error || `Google Calendar error ${response.status}`);
  return data as JsonRecord;
}

function scheduleEventToGoogle(event: JsonRecord) {
  const isAllDay = Boolean(event.is_all_day);
  const body: JsonRecord = {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    status: event.status === "cancelled" || event.status === "canceled" ? "cancelled" : "confirmed",
    visibility: event.visibility === "private" ? "private" : undefined,
    extendedProperties: {
      private: {
        vimob_event_id: event.id,
        vimob_organization_id: event.organization_id,
        vimob_user_id: event.user_id,
        vimob_event_type: event.event_type || "task",
      },
    },
  };

  if (isAllDay) {
    body.start = { date: yyyyMmDd(event.start_time) };
    body.end = { date: yyyyMmDd(event.end_time) };
  } else {
    body.start = { dateTime: event.start_time, timeZone: "America/Sao_Paulo" };
    body.end = { dateTime: event.end_time, timeZone: "America/Sao_Paulo" };
  }

  if (typeof event.reminder_minutes === "number") {
    body.reminders = {
      useDefault: false,
      overrides: [{ method: "popup", minutes: event.reminder_minutes }],
    };
  }

  return body;
}

function googleEventToSchedule(connection: JsonRecord, googleEvent: JsonRecord) {
  const privateProps = googleEvent.extendedProperties?.private || {};
  const isAllDay = Boolean(googleEvent.start?.date);
  const startTime = isAllDay
    ? dateOnlyToISO(googleEvent.start.date)
    : toISO(googleEvent.start?.dateTime || googleEvent.start?.date);
  const endTime = isAllDay
    ? dateOnlyToISO(googleEvent.end.date, true)
    : toISO(googleEvent.end?.dateTime || googleEvent.end?.date);

  return {
    organization_id: connection.organization_id,
    user_id: connection.user_id,
    title: googleEvent.summary || "Evento Google Calendar",
    description: googleEvent.description || null,
    event_type: privateProps.vimob_event_type || "meeting",
    start_time: startTime || new Date().toISOString(),
    end_time: endTime || startTime || new Date().toISOString(),
    is_all_day: isAllDay,
    location: googleEvent.location || null,
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

async function findEventLink(connection: JsonRecord, googleEvent: JsonRecord) {
  const privateEventId = googleEvent.extendedProperties?.private?.vimob_event_id;
  if (privateEventId) {
    const { data, error } = await supabase
      .from("google_calendar_event_links")
      .select("*")
      .eq("connection_id", connection.id)
      .eq("schedule_event_id", privateEventId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as JsonRecord;
  }

  const { data, error } = await supabase
    .from("google_calendar_event_links")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("google_calendar_id", normalizeCalendarId(connection.calendar_id))
    .eq("google_event_id", googleEvent.id)
    .maybeSingle();

  if (error) throw error;
  return data as JsonRecord | null;
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
    deleted_at: params.googleEvent.status === "cancelled" ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase
    .from("google_calendar_event_links")
    .upsert(row, { onConflict: "connection_id,google_calendar_id,google_event_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as JsonRecord;
}

export async function pushScheduleEventToGoogle(eventId: string, actorUserId?: string | null) {
  const { data: event, error: eventError } = await supabase
    .from("schedule_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!event) throw new Error("Evento da agenda nao encontrado.");

  if (actorUserId && !(await canManageScheduleEvent(event, actorUserId))) {
    throw new Error("Sem permissao para sincronizar este evento.");
  }

  const connection = await getConnectionForUser(event.user_id);
  if (!connection) {
    await supabase.from("schedule_events").update({ google_sync_status: "not_connected" }).eq("id", event.id);
    return { skipped: true, reason: "NO_CONNECTION" };
  }

  const calendarId = encodeURIComponent(normalizeCalendarId(connection.calendar_id));
  const { data: link } = await supabase
    .from("google_calendar_event_links")
    .select("*")
    .eq("connection_id", connection.id)
    .eq("schedule_event_id", event.id)
    .maybeSingle();

  const body = scheduleEventToGoogle(event);
  const googleEvent = link?.google_event_id
    ? await googleJson(connection, `/calendars/${calendarId}/events/${encodeURIComponent(link.google_event_id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
    : await googleJson(connection, `/calendars/${calendarId}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });

  await upsertEventLink({ connection, scheduleEventId: event.id, googleEvent, origin: "vimob" });

  await supabase
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

  return { synced: true, google_event_id: googleEvent.id };
}

export async function deleteScheduleEventFromGoogle(eventId: string, actorUserId?: string | null) {
  const { data: event } = await supabase.from("schedule_events").select("*").eq("id", eventId).maybeSingle();
  if (event && actorUserId && !(await canManageScheduleEvent(event, actorUserId))) {
    throw new Error("Sem permissao para remover este evento do Google.");
  }

  const { data: links, error } = await supabase
    .from("google_calendar_event_links")
    .select("*, google_calendar_tokens(*)")
    .eq("schedule_event_id", eventId)
    .is("deleted_at", null);

  if (error) throw error;
  let deleted = 0;

  for (const link of links || []) {
    const connection = link.google_calendar_tokens;
    if (!connection?.token_secret_ref) continue;
    const calendarId = encodeURIComponent(normalizeCalendarId(link.google_calendar_id));
    const eventPath = `/calendars/${calendarId}/events/${encodeURIComponent(link.google_event_id)}`;
    const response = await googleFetch(connection, eventPath, { method: "DELETE" });
    if (!response.ok && ![404, 410].includes(response.status)) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `Falha ao remover evento Google (${response.status}).`);
    }

    await supabase
      .from("google_calendar_event_links")
      .update({ deleted_at: new Date().toISOString(), last_origin: "vimob", last_synced_at: new Date().toISOString() })
      .eq("id", link.id);
    deleted += 1;
  }

  return { deleted };
}

async function upsertGoogleEventIntoSchedule(connection: JsonRecord, googleEvent: JsonRecord) {
  const link = await findEventLink(connection, googleEvent);

  if (googleEvent.status === "cancelled") {
    if (link?.schedule_event_id) {
      await supabase
        .from("schedule_events")
        .update({
          status: "cancelled",
          google_sync_status: "synced",
          google_last_synced_at: new Date().toISOString(),
        })
        .eq("id", link.schedule_event_id);
    }
    await upsertEventLink({ connection, scheduleEventId: link?.schedule_event_id || null, googleEvent, origin: "google" });
    return { cancelled: true };
  }

  const privateEventId = googleEvent.extendedProperties?.private?.vimob_event_id;
  const scheduleRow = googleEventToSchedule(connection, googleEvent);
  const targetEventId = link?.schedule_event_id || privateEventId || null;

  let scheduleEvent: JsonRecord | null = null;
  if (targetEventId) {
    const { data, error } = await supabase
      .from("schedule_events")
      .update(scheduleRow)
      .eq("id", targetEventId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    scheduleEvent = data as JsonRecord | null;
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

  await upsertEventLink({ connection, scheduleEventId: scheduleEvent.id, googleEvent, origin: "google" });
  return { schedule_event_id: scheduleEvent.id };
}

export async function syncConnectionFromGoogle(connectionInput: JsonRecord, fullSync = false) {
  let connection = connectionInput;
  const calendarId = encodeURIComponent(normalizeCalendarId(connection.calendar_id));
  let pageToken: string | null = null;
  let syncToken = fullSync ? null : connection.sync_token || null;
  let processed = 0;

  try {
    do {
      const url = new URL(`${GOOGLE_CALENDAR_BASE_URL}/calendars/${calendarId}/events`);
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      if (syncToken) url.searchParams.set("syncToken", syncToken);

      const response = await googleFetch(connection, url.pathname + url.search);

      if (response.status === 410 && syncToken) {
        syncToken = null;
        pageToken = null;
        continue;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || `Google Calendar sync error ${response.status}`);

      for (const googleEvent of data.items || []) {
        await upsertGoogleEventIntoSchedule(connection, googleEvent);
        processed += 1;
      }

      pageToken = data.nextPageToken || null;
      if (!pageToken && data.nextSyncToken) {
        connection = {
          ...connection,
          sync_token: data.nextSyncToken,
        };
        await supabase
          .from("google_calendar_tokens")
          .update({
            sync_token: data.nextSyncToken,
            sync_status: "connected",
            last_synced_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", connection.id);
      }
    } while (pageToken);

    return { processed };
  } catch (error) {
    await supabase
      .from("google_calendar_tokens")
      .update({ sync_status: "error", last_error: errorMessage(error) })
      .eq("id", connection.id);
    throw error;
  }
}

export async function ensureGoogleWatch(connection: JsonRecord) {
  const webhookUrl = getGoogleOAuthConfig().webhookUrl;
  if (!webhookUrl) return { skipped: true, reason: "NO_WEBHOOK_URL" };

  const calendarId = normalizeCalendarId(connection.calendar_id);
  const channelId = crypto.randomUUID();
  const channelToken = randomToken(32);
  const expirationMs = Date.now() + (6 * 24 * 60 * 60 * 1000);

  const googleChannel = await googleJson(connection, `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
    method: "POST",
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      token: channelToken,
      expiration: String(expirationMs),
    }),
  });

  await supabase.from("google_calendar_channels").insert({
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

  await supabase
    .from("google_calendar_tokens")
    .update({
      watch_expires_at: googleChannel.expiration
        ? new Date(Number(googleChannel.expiration)).toISOString()
        : new Date(expirationMs).toISOString(),
      last_watch_renewed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", connection.id);

  return { channel_id: channelId };
}

export async function enqueueSyncJob(params: {
  organizationId: string;
  connectionId?: string | null;
  scheduleEventId?: string | null;
  action: "push_upsert" | "push_delete" | "pull_incremental" | "full_sync" | "renew_watch";
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

  if (error) throw error;
  return data as JsonRecord;
}

export async function processSyncJob(job: JsonRecord) {
  if (job.action === "push_upsert" && job.schedule_event_id) {
    return pushScheduleEventToGoogle(job.schedule_event_id, job.created_by);
  }
  if (job.action === "push_delete" && job.schedule_event_id) {
    return deleteScheduleEventFromGoogle(job.schedule_event_id, job.created_by);
  }
  if ((job.action === "pull_incremental" || job.action === "full_sync") && job.connection_id) {
    return syncConnectionFromGoogle(await getConnectionById(job.connection_id), job.action === "full_sync");
  }
  if (job.action === "renew_watch" && job.connection_id) {
    return ensureGoogleWatch(await getConnectionById(job.connection_id));
  }
  return { skipped: true, reason: "UNSUPPORTED_JOB" };
}

export async function runDueJobs(limit = 10) {
  const { data: jobs, error } = await supabase
    .from("google_calendar_sync_jobs")
    .select("*")
    .in("status", ["queued", "failed"])
    .lte("next_run_at", new Date().toISOString())
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const results = [];

  for (const job of jobs || []) {
    await supabase
      .from("google_calendar_sync_jobs")
      .update({ status: "running", locked_at: new Date().toISOString(), locked_by: "google-calendar-sync" })
      .eq("id", job.id);

    try {
      const result = await processSyncJob(job);
      await supabase
        .from("google_calendar_sync_jobs")
        .update({ status: "succeeded", last_error: null })
        .eq("id", job.id);
      results.push({ id: job.id, ok: true, result });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      await supabase
        .from("google_calendar_sync_jobs")
        .update({
          status: attempts >= Number(job.max_attempts || 5) ? "dead" : "failed",
          attempts,
          last_error: errorMessage(error),
          next_run_at: addSeconds(Math.min(3600, 60 * attempts)),
        })
        .eq("id", job.id);
      results.push({ id: job.id, ok: false, error: errorMessage(error) });
    }
  }

  return { processed: results.length, results };
}

export async function renewDueWatches() {
  const renewalCutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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
      results.push({ connection_id: connection.id, error: errorMessage(error) });
    }
  }
  return { renewed: results.length, results };
}

export async function disconnectConnection(connection: JsonRecord) {
  const token = await readTokenSecret(connection.token_secret_ref).catch(() => null);

  if (token?.access_token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.access_token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => null);
  }

  const { data: channels } = await supabase
    .from("google_calendar_channels")
    .select("*")
    .eq("connection_id", connection.id)
    .is("stopped_at", null);

  for (const channel of channels || []) {
    await googleFetch(connection, "/channels/stop", {
      method: "POST",
      body: JSON.stringify({ id: channel.channel_id, resourceId: channel.resource_id }),
    }).catch(() => null);
    await supabase
      .from("google_calendar_channels")
      .update({ stopped_at: new Date().toISOString() })
      .eq("id", channel.id);
  }

  await supabase
    .from("google_calendar_tokens")
    .update({
      sync_enabled: false,
      sync_status: "disconnected",
      disconnected_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", connection.id);
}
