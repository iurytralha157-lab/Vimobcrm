import {
  authenticateUser,
  enqueueSyncJob,
  ensureGoogleWatch,
  errorMessage,
  getConnectionById,
  getConnectionForUser,
  getUserProfile,
  handleOptions,
  jsonResponse,
  processSyncJob,
  pushScheduleEventToGoogle,
  renewDueWatches,
  runDueJobs,
  syncConnectionFromGoogle,
  supabase,
  deleteScheduleEventFromGoogle,
} from "../_shared/google-calendar.ts";

async function authenticateServiceOrUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronSecret = Deno.env.get("GOOGLE_CALENDAR_CRON_SECRET") || "";

  if (serviceKey && bearer === serviceKey) return { service: true, user: null, profile: null };
  if (cronSecret && bearer === cronSecret) return { service: true, user: null, profile: null };

  const user = await authenticateUser(req);
  const profile = await getUserProfile(user.id);
  return { service: false, user, profile };
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Metodo nao permitido." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "run_due_jobs";
    const auth = await authenticateServiceOrUser(req);

    if (action === "run_due_jobs") {
      if (!auth.service && !auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      return jsonResponse({ success: true, ...(await runDueJobs(Number(body.limit || 10))) });
    }

    if (action === "renew_watches") {
      if (!auth.service) return jsonResponse({ success: false, error: "Apenas backend pode renovar watches." }, 403);
      return jsonResponse({ success: true, ...(await renewDueWatches()) });
    }

    if (action === "sync_connection") {
      const connection = body.connection_id
        ? await getConnectionById(body.connection_id)
        : auth.profile
          ? await getConnectionForUser(auth.profile.id)
          : null;

      if (!connection) return jsonResponse({ success: false, error: "Conexao Google nao encontrada." }, 404);
      if (!auth.service && connection.user_id !== auth.profile?.id) {
        return jsonResponse({ success: false, error: "Forbidden" }, 403);
      }

      const result = await syncConnectionFromGoogle(connection, body.full === true);
      await ensureGoogleWatch(connection).catch((watchError) => console.error("watch renewal failed", watchError));
      return jsonResponse({ success: true, result });
    }

    if (action === "sync_event" || action === "push_upsert") {
      if (!auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      if (!body.event_id) return jsonResponse({ success: false, error: "event_id obrigatorio." }, 400);

      const result = await pushScheduleEventToGoogle(body.event_id, auth.profile.id);
      return jsonResponse({ success: true, result });
    }

    if (action === "push_delete") {
      if (!auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      if (!body.event_id) return jsonResponse({ success: false, error: "event_id obrigatorio." }, 400);

      const result = await deleteScheduleEventFromGoogle(body.event_id, auth.profile.id);
      return jsonResponse({ success: true, result });
    }

    if (action === "enqueue_event") {
      if (!auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      if (!body.event_id) return jsonResponse({ success: false, error: "event_id obrigatorio." }, 400);

      const { data: event, error } = await supabase
        .from("schedule_events")
        .select("id, organization_id")
        .eq("id", body.event_id)
        .maybeSingle();
      if (error) throw error;
      if (!event) return jsonResponse({ success: false, error: "Evento nao encontrado." }, 404);

      const job = await enqueueSyncJob({
        organizationId: event.organization_id,
        scheduleEventId: event.id,
        action: body.sync_action === "push_delete" ? "push_delete" : "push_upsert",
        createdBy: auth.profile.id,
      });
      const result = await processSyncJob(job);
      return jsonResponse({ success: true, job_id: job.id, result });
    }

    return jsonResponse({ success: false, error: "Acao invalida." }, 400);
  } catch (error) {
    console.error("google-calendar-sync error", error);
    const message = errorMessage(error);
    return jsonResponse({ success: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
