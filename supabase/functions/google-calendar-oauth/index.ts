import {
  authenticateUser,
  buildGoogleAuthUrl,
  consumeOAuthState,
  createOAuthState,
  disconnectConnection,
  ensureGoogleWatch,
  errorMessage,
  exchangeOAuthCode,
  fetchGoogleUserInfo,
  getConnectionById,
  getConnectionForUser,
  getGoogleOAuthConfig,
  getUserProfile,
  handleOptions,
  htmlResponse,
  jsonResponse,
  redirectResponse,
  supabase,
  syncConnectionFromGoogle,
  upsertConnectionFromOAuth,
} from "../_shared/google-calendar.ts";

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

      const tokenResponse = await exchangeOAuthCode(code);
      const userInfo = await fetchGoogleUserInfo(tokenResponse.access_token);
      const connection = await upsertConnectionFromOAuth({ state: oauthState, tokenResponse, userInfo });

      await syncConnectionFromGoogle(connection, true).catch(async (syncError) => {
        console.error("google initial sync failed", syncError);
      });

      await ensureGoogleWatch(connection).catch(async (watchError) => {
        console.error("google watch creation failed", watchError);
      });

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
    const profile = await getUserProfile(user.id);

    if (action === "get_auth_url") {
      const state = await createOAuthState({
        userId: profile.id,
        organizationId: profile.organization_id,
        returnUrl: body.return_url || body.returnUrl || null,
      });

      return jsonResponse({ success: true, auth_url: buildGoogleAuthUrl(state) });
    }

    if (action === "status") {
      const connection = await getConnectionForUser(profile.id);
      return jsonResponse({
        success: true,
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
        } : null,
      });
    }

    if (action === "disconnect") {
      const connection = body.connection_id ? await getConnectionById(body.connection_id) : await getConnectionForUser(profile.id);
      if (!connection || connection.user_id !== profile.id) {
        return jsonResponse({ success: false, error: "Conexao Google nao encontrada." }, 404);
      }

      await disconnectConnection(connection);
      return jsonResponse({ success: true });
    }

    if (action === "set_sync_enabled") {
      const connection = body.connection_id ? await getConnectionById(body.connection_id) : await getConnectionForUser(profile.id);
      if (!connection || connection.user_id !== profile.id) {
        return jsonResponse({ success: false, error: "Conexao Google nao encontrada." }, 404);
      }

      const enabled = body.sync_enabled !== false;
      const { error } = await supabase
        .from("google_calendar_tokens")
        .update({
          sync_enabled: enabled,
          sync_status: enabled ? "connected" : "idle",
          last_error: null,
        })
        .eq("id", connection.id);
      if (error) throw error;

      if (enabled) {
        await ensureGoogleWatch(connection).catch((watchError) => console.error("watch renewal failed", watchError));
      }

      return jsonResponse({ success: true, sync_enabled: enabled });
    }

    if (action === "sync_now") {
      const connection = body.connection_id ? await getConnectionById(body.connection_id) : await getConnectionForUser(profile.id);
      if (!connection || connection.user_id !== profile.id) {
        return jsonResponse({ success: false, error: "Conexao Google nao encontrada." }, 404);
      }

      const result = await syncConnectionFromGoogle(connection, body.full === true);
      await ensureGoogleWatch(connection).catch((watchError) => console.error("watch renewal failed", watchError));
      return jsonResponse({ success: true, result });
    }

    return jsonResponse({ success: false, error: "Acao invalida." }, 400);
  } catch (error) {
    console.error("google-calendar-oauth error", error);
    const message = errorMessage(error);
    return jsonResponse({ success: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
