import {
  authenticateUser,
  buildGoogleAuthUrl,
  consumeOAuthState,
  createOAuthState,
  disconnectConnection,
  errorMessage,
  exchangeOAuthCode,
  fetchGoogleUserInfo,
  getConnectionById,
  getConnectionForUser,
  getGoogleScheduleCapability,
  getGoogleOAuthConfig,
  getUserProfile,
  GoogleCalendarDisconnectPendingError,
  handleOptions,
  htmlResponse,
  jsonResponse,
  redirectResponse,
  upsertConnectionFromOAuth,
} from "../_shared/google-calendar.ts";
import {
  resolveGoogleCalendarConnectGate,
  type GoogleCalendarConnectGate,
} from "../_shared/google-calendar-pilot.ts";

function connectGate(userId: string): GoogleCalendarConnectGate {
  return resolveGoogleCalendarConnectGate(
    userId,
    Deno.env.get("GOOGLE_CALENDAR_CONNECT_MODE"),
    Deno.env.get("GOOGLE_CALENDAR_PILOT_USER_IDS"),
  );
}

function connectGateMessage(gate: Exclude<GoogleCalendarConnectGate, { allowed: true }>) {
  return gate.restriction === "GOOGLE_CALENDAR_PILOT_ONLY"
    ? "A conexao com o Google Agenda esta limitada aos usuarios do teste piloto."
    : "Novas conexoes com o Google Agenda estao desativadas temporariamente.";
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function callbackError(message: string, returnUrl?: string | null) {
  if (returnUrl) {
    const url = new URL(returnUrl);
    url.searchParams.set("google_calendar_error", message);
    return redirectResponse(url.toString());
  }

  return htmlResponse(
    `<html><body><h1>Google Calendar</h1><p>${escapeHtml(message)}</p></body></html>`,
    400,
  );
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  try {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname.endsWith("/callback")) {
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!state) return callbackError("Estado OAuth ausente.");

      const oauthState = await consumeOAuthState(state);

      if (error) {
        return callbackError(`Google recusou a conexao: ${error}`, oauthState.return_url);
      }

      if (!code) return callbackError("Codigo OAuth ausente.", oauthState.return_url);

      // Membership and Agenda permissions can change while Google shows the
      // consent screen. Do not persist a token for a revoked tenant context.
      try {
        await getUserProfile(oauthState.user_id, oauthState.organization_id);
        const capability = await getGoogleScheduleCapability(
          oauthState.user_id,
          oauthState.organization_id,
        );
        if (!capability.allowed) {
          return callbackError("Acesso a Agenda revogado. Inicie a conexao novamente.", oauthState.return_url);
        }
        const gate = connectGate(oauthState.user_id);
        if (!gate.allowed) {
          return callbackError(connectGateMessage(gate), oauthState.return_url);
        }
      } catch {
        return callbackError("Acesso a Agenda revogado. Inicie a conexao novamente.", oauthState.return_url);
      }

      const tokenResponse = await exchangeOAuthCode(code);
      const userInfo = await fetchGoogleUserInfo(tokenResponse.access_token);
      // Connecting Google only enables Vimob -> Google writes. Never read or
      // subscribe to the user's existing Google events during OAuth callback.
      await upsertConnectionFromOAuth({ state: oauthState, tokenResponse, userInfo });

      const destination = oauthState.return_url || getGoogleOAuthConfig().postConnectRedirectUrl;
      if (destination) {
        const redirectUrl = new URL(destination);
        redirectUrl.searchParams.set("google_calendar_connected", "1");
        return redirectResponse(redirectUrl.toString());
      }

      return htmlResponse("<html><body><h1>Google Calendar conectado</h1><p>Voce ja pode voltar para o Vimob.</p></body></html>");
    }

    if (req.method !== "POST") {
      return jsonResponse({ success: false, error: "Metodo nao permitido." }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "get_auth_url";
    const user = await authenticateUser(req);
    const profile = await getUserProfile(user.id, body.organization_id || body.organizationId || null);

    if (action === "get_auth_url") {
      const capability = await getGoogleScheduleCapability(profile.id, profile.organization_id);
      if (!capability.allowed) {
        return jsonResponse({ success: false, error: capability.reason, code: capability.reason }, capability.status);
      }
      const gate = connectGate(profile.id);
      if (!gate.allowed) {
        return jsonResponse({ success: false, error: connectGateMessage(gate), code: gate.restriction }, 403);
      }
      const state = await createOAuthState({
        userId: profile.id,
        organizationId: profile.organization_id,
        returnUrl: body.return_url || body.returnUrl || null,
      });

      return jsonResponse({ success: true, auth_url: buildGoogleAuthUrl(state) });
    }

    if (action === "status") {
      const capability = await getGoogleScheduleCapability(profile.id, profile.organization_id);
      const gate = connectGate(profile.id);
      const connection = await getConnectionForUser(profile.id, profile.organization_id, { requireSyncEnabled: false });
      return jsonResponse({
        success: true,
        can_connect: capability.allowed && gate.allowed,
        can_use_schedule: capability.allowed,
        connect_restriction: !capability.allowed
          ? "SCHEDULE_ACCESS_REQUIRED"
          : gate.restriction,
        connection: connection ? {
          id: connection.id,
          organization_id: connection.organization_id,
          user_id: connection.user_id,
          account_email: connection.account_email,
          account_picture_url: connection.account_picture_url,
          calendar_id: connection.calendar_id,
          calendar_summary: connection.calendar_summary,
          sync_enabled: connection.sync_enabled,
          sync_status: connection.sync_status,
          connected_at: connection.connected_at,
          last_synced_at: connection.last_synced_at,
          watch_expires_at: connection.watch_expires_at,
          last_error: connection.last_error,
          disconnected_at: connection.disconnected_at,
          created_at: connection.created_at,
          updated_at: connection.updated_at,
        } : null,
      });
    }

    if (action === "disconnect") {
      const connection = body.connection_id
        ? await getConnectionById(body.connection_id)
        : await getConnectionForUser(profile.id, profile.organization_id, { requireSyncEnabled: false });
      if (
        !connection
        || connection.user_id !== profile.id
        || connection.organization_id !== profile.organization_id
      ) {
        return jsonResponse({ success: false, error: "Conexao Google nao encontrada." }, 404);
      }

      await disconnectConnection(connection);
      return jsonResponse({ success: true });
    }

    if (action === "set_sync_enabled") {
      return jsonResponse({
        success: false,
        error: "O envio ao Google funciona enquanto a conta estiver conectada. Desconecte a conta para interromper novos envios.",
        code: "ONE_WAY_SYNC_CONTROL_UNSUPPORTED",
      }, 410);
    }

    if (action === "sync_now") {
      return jsonResponse({
        success: false,
        error: "Importacao de eventos do Google para o Vimob nao disponivel.",
        code: "INBOUND_SYNC_DISABLED",
      }, 410);
    }

    return jsonResponse({ success: false, error: "Acao invalida." }, 400);
  } catch (error) {
    console.error("google-calendar-oauth error", error);
    const message = errorMessage(error);
    if (error instanceof GoogleCalendarDisconnectPendingError) {
      return jsonResponse({ success: false, error: message, code: "GOOGLE_CALENDAR_SYNC_PENDING" }, 409);
    }
    return jsonResponse({ success: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
