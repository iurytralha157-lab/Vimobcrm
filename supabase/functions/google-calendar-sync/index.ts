import {
  authenticateCron,
  authenticateUser,
  canManageScheduleEvent,
  enqueueSyncJob,
  ensureGoogleWatch,
  errorMessage,
  getConnectionById,
  getConnectionForUser,
  getUserProfile,
  handleOptions,
  jsonResponse,
  pushScheduleEventToGoogle,
  renewDueWatches,
  runDueJobs,
  syncConnectionFromGoogle,
  supabase,
  deleteScheduleEventFromGoogle,
  enqueueDuePulls,
  executeSyncJob,
  getGoogleScheduleCapability,
  GoogleScheduleCapabilityError,
} from "../_shared/google-calendar.ts";

async function authenticateServiceOrUser(req: Request, organizationId?: string | null) {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (serviceKey && bearer === serviceKey) return { service: true, user: null, profile: null };
  if (await authenticateCron(req)) return { service: true, user: null, profile: null };

  const user = await authenticateUser(req);
  const profile = await getUserProfile(user.id, organizationId);
  return { service: false, user, profile };
}

async function requireUserScheduleManage(profile: Record<string, unknown> | null) {
  if (!profile?.id || !profile.organization_id) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const capability = await getGoogleScheduleCapability(
    String(profile.id),
    String(profile.organization_id),
  );
  if (capability.allowed) return null;
  return jsonResponse({
    success: false,
    error: capability.reason,
    code: capability.reason,
  }, capability.status);
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
    const auth = await authenticateServiceOrUser(req, body.organization_id || body.organizationId || null);

    if (action === "run_due_jobs") {
      if (!auth.service) return jsonResponse({ success: false, error: "Apenas backend pode processar a fila." }, 403);
      return jsonResponse({ success: true, ...(await runDueJobs(Number(body.limit || 10))) });
    }

    if (action === "renew_watches") {
      if (!auth.service) return jsonResponse({ success: false, error: "Apenas backend pode renovar watches." }, 403);
      return jsonResponse({ success: true, ...(await renewDueWatches()) });
    }

    if (action === "enqueue_due_pulls") {
      if (!auth.service) return jsonResponse({ success: false, error: "Apenas backend pode agendar reconciliacao." }, 403);
      return jsonResponse({
        success: true,
        ...(await enqueueDuePulls(Number(body.limit || 20), Number(body.stale_after_minutes || 360))),
      });
    }

    if (action === "sync_connection") {
      if (!auth.service) {
        const denied = await requireUserScheduleManage(auth.profile);
        if (denied) return denied;
      }
      const connection = body.connection_id
        ? await getConnectionById(body.connection_id)
        : auth.profile
          ? await getConnectionForUser(auth.profile.id, auth.profile.organization_id)
          : null;

      if (!connection) return jsonResponse({ success: false, error: "Conexao Google nao encontrada." }, 404);
      if (
        !auth.service
        && (
          connection.user_id !== auth.profile?.id
          || connection.organization_id !== auth.profile?.organization_id
        )
      ) {
        return jsonResponse({ success: false, error: "Forbidden" }, 403);
      }

      const result = await syncConnectionFromGoogle(connection, body.full === true);
      await ensureGoogleWatch(connection).catch((watchError) => console.error("watch renewal failed", watchError));
      return jsonResponse({ success: true, result });
    }

    if (action === "sync_event" || action === "push_upsert") {
      if (!auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      const denied = await requireUserScheduleManage(auth.profile);
      if (denied) return denied;
      if (!body.event_id) return jsonResponse({ success: false, error: "event_id obrigatorio." }, 400);

      const { data: event, error: eventError } = await supabase
        .from("schedule_events")
        .select("organization_id")
        .eq("id", body.event_id)
        .maybeSingle();
      if (eventError) throw eventError;
      if (!event || event.organization_id !== auth.profile.organization_id) {
        return jsonResponse({ success: false, error: "Evento nao encontrado." }, 404);
      }

      const result = await pushScheduleEventToGoogle(body.event_id, auth.profile.id);
      return jsonResponse({ success: true, result });
    }

    if (action === "push_delete") {
      if (!auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      const denied = await requireUserScheduleManage(auth.profile);
      if (denied) return denied;
      if (!body.event_id) return jsonResponse({ success: false, error: "event_id obrigatorio." }, 400);

      const { data: event, error: eventError } = await supabase
        .from("schedule_events")
        .select("organization_id")
        .eq("id", body.event_id)
        .maybeSingle();
      if (eventError) throw eventError;
      if (!event || event.organization_id !== auth.profile.organization_id) {
        return jsonResponse({ success: false, error: "Evento nao encontrado." }, 404);
      }

      const result = await deleteScheduleEventFromGoogle(body.event_id, auth.profile.id);
      return jsonResponse({ success: true, result });
    }

    if (action === "enqueue_event") {
      if (!auth.profile) return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      const denied = await requireUserScheduleManage(auth.profile);
      if (denied) return denied;
      if (!body.event_id) return jsonResponse({ success: false, error: "event_id obrigatorio." }, 400);

      const { data: event, error } = await supabase
        .from("schedule_events")
        .select("id, organization_id, user_id")
        .eq("id", body.event_id)
        .maybeSingle();
      if (error) throw error;
      if (!event || event.organization_id !== auth.profile.organization_id) {
        return jsonResponse({ success: false, error: "Evento nao encontrado." }, 404);
      }

      const syncAction = body.sync_action === "push_delete" ? "push_delete" : "push_upsert";
      if (!(await canManageScheduleEvent(event, auth.profile.id))) {
        return jsonResponse({ success: false, error: "Forbidden" }, 403);
      }

      let payload: Record<string, unknown> = {};
      if (syncAction === "push_delete") {
        const { data: links, error: linksError } = await supabase
          .from("google_calendar_event_links")
          .select("id")
          .eq("schedule_event_id", event.id)
          .eq("organization_id", event.organization_id)
          .is("deleted_at", null);
        if (linksError) throw linksError;
        payload = {
          event_id: event.id,
          link_ids: (links || []).map((link) => link.id),
        };
      }

      const { error: pendingError } = await supabase
        .from("schedule_events")
        .update({ google_sync_status: "pending", google_sync_error: null })
        .eq("id", event.id);
      if (pendingError) throw pendingError;

      const job = await enqueueSyncJob({
        organizationId: event.organization_id,
        scheduleEventId: event.id,
        action: syncAction,
        payload,
        createdBy: auth.profile.id,
      })
        .catch(async (enqueueError) => {
          const { error: statusError } = await supabase
            .from("schedule_events")
            .update({
              google_sync_status: "error",
              google_sync_error: errorMessage(enqueueError).slice(0, 2_000),
            })
            .eq("id", event.id);
          if (statusError) console.error("failed to persist Google Calendar enqueue error", statusError);
          throw enqueueError;
        });
      const { data: claimedJob, error: claimError } = await supabase
        .from("google_calendar_sync_jobs")
        .update({
          status: "running",
          locked_at: new Date().toISOString(),
          locked_by: `google-calendar-user-${crypto.randomUUID()}`,
        })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimedJob) {
        return jsonResponse({ success: true, job_id: job.id, queued: true }, 202);
      }

      const outcome = await executeSyncJob(claimedJob);
      return jsonResponse({
        success: true,
        job_id: job.id,
        queued: !outcome.ok,
        result: outcome.ok ? outcome.result : null,
        immediate_error: outcome.ok ? null : outcome.error,
      }, outcome.ok ? 200 : 202);
    }

    return jsonResponse({ success: false, error: "Acao invalida." }, 400);
  } catch (error) {
    console.error("google-calendar-sync error", error);
    if (error instanceof GoogleScheduleCapabilityError) {
      return jsonResponse({ success: false, error: error.code, code: error.code }, error.status);
    }
    const message = errorMessage(error);
    return jsonResponse({ success: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
