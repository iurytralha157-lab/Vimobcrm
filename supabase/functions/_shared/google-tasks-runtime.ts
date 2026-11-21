import { GoogleCalendarConnectionChangedError, GoogleCalendarLeaseLostError,
  GoogleCalendarRetryableError, GoogleCalendarVersionChangedError } from "./google-calendar-delivery.ts";
import { deleteGoogleTaskLink, pushGoogleTask, type GoogleTasksDeliveryDependencies } from "./google-tasks-delivery.ts";
import { type TasksRecord, type TasksRequest } from "./google-tasks-api.ts";

export type GoogleScheduleRuntimeDependencies = {
  rpc: GoogleTasksDeliveryDependencies["rpc"];
  getEvent: (id: string, organizationId: string) => Promise<TasksRecord | null>;
  getConnection: (ownerId: string, organizationId: string, id?: string) => Promise<TasksRecord | null>;
  getTaskLinks: (eventId: string, organizationId: string, connectionId: string, ids?: string[]) => Promise<TasksRecord[]>;
  assertOwner: (ownerId: string, organizationId: string) => Promise<void>;
  assertSnapshot: (event: TasksRecord) => Promise<void>;
  getTimeZone: (organizationId: string) => Promise<string>;
  getExportContext: (event: TasksRecord) => Promise<TasksRecord>;
  request: (connection: TasksRecord) => TasksRequest;
  calendarUpsert: (job: TasksRecord) => Promise<TasksRecord>;
  calendarDelete: (job: TasksRecord) => Promise<unknown>;
  requeueCurrent: (job: TasksRecord, event: TasksRecord) => Promise<void>;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function desiredGoogleTarget(type: unknown, routingV2: boolean): "tasks" | "calendar" {
  if (!["task", "message", "email", "call", "meeting", "visit"].includes(String(type))) {
    throw new Error("Tipo de atividade desconhecido na sincronizacao Google.");
  }
  return routingV2 && ["task", "message", "email", "call"].includes(String(type)) ? "tasks" : "calendar";
}

// The database binds the durable job to tenant, connection and credential
// revision. This coordinator keeps both remote resources within that fence.
export async function processGoogleScheduleV2(job: TasksRecord, deps: GoogleScheduleRuntimeDependencies): Promise<TasksRecord> {
  const payload = job.payload && typeof job.payload === "object" ? job.payload as TasksRecord : {};
  const organizationId = String(job.organization_id || "");
  const ownerId = String(payload.owner_user_id || "");
  const eventId = String(job.schedule_event_id || payload.event_id || "");
  if (!organizationId || !ownerId || !eventId) throw new Error("Job Google sem contexto autorizado.");
  const connection = await deps.getConnection(ownerId, organizationId, String(job.connection_id || payload.connection_id || "") || undefined);
  if (!connection || connection.organization_id !== organizationId || connection.user_id !== ownerId) {
    throw new GoogleCalendarRetryableError("Conexao Google indisponivel para concluir a sincronizacao.", 401);
  }
  if (connection.disconnecting_at) throw new GoogleCalendarConnectionChangedError();
  connection.vimob_job = { id: job.id, worker: job.locked_by };
  const request = deps.request(connection);
  const event = await deps.getEvent(eventId, organizationId);
  const delivery: GoogleTasksDeliveryDependencies = {
    rpc: deps.rpc, request,
    assertSnapshot: async () => {
      if (!event) throw new GoogleCalendarVersionChangedError();
      await deps.assertSnapshot(event);
    },
  };
  const cleanupTasks = async () => {
    if (job.action === "push_upsert" && event) await deps.assertSnapshot(event);
    const links = await deps.getTaskLinks(eventId, organizationId, String(connection.id),
      job.action === "push_delete" ? strings(payload.task_link_ids) : undefined);
    for (const link of links) await deleteGoogleTaskLink(job, link, delivery);
  };
  if (job.action === "push_delete") {
    await cleanupTasks();
    // Legacy Calendar copies may coexist during a controlled conversion.
    await deps.calendarDelete(job);
    return { deleted: true };
  }
  if (job.action !== "push_upsert") throw new Error("Acao Google nao suportada.");
  if (!event || event.user_id !== ownerId) return { skipped: true, reason: "STALE_EVENT_OWNER" };
  await deps.assertOwner(ownerId, organizationId);
  const target = desiredGoogleTarget(event.event_type, connection.routing_v2 === true);
  if (payload.target !== target) {
    // An OAuth upgrade can change routing without a CRM mutation to produce
    // another job. Preserve the intent before acknowledging the old target.
    await deps.requeueCurrent(job, event);
    return { skipped: true, reason: "TARGET_CHANGED_REQUEUED" };
  }
  if (target === "tasks") {
    if (connection.tasks_authorized !== true) {
      throw new GoogleCalendarRetryableError("Autorize o Google Tasks para enviar esta atividade.", 403);
    }
    if (["cancelled", "canceled"].includes(String(event.status))) {
      await cleanupTasks();
      await deps.calendarDelete(job);
      if (await deps.rpc("google_schedule_commit_sync", { p_job_id: job.id, p_worker: job.locked_by,
        p_expected_updated_at: event.updated_at, p_target: "tasks", p_remote_id: null }) !== true) throw new GoogleCalendarVersionChangedError();
      return { target: "tasks", deleted: true };
    }
    const exported = await deps.getExportContext(event);
    return pushGoogleTask({ job, connection, event: exported, timeZone: await deps.getTimeZone(organizationId) }, {
      ...delivery, beforeCommit: async () => { await deps.assertSnapshot(event); await deps.calendarDelete(job); },
    });
  }
  const result = await deps.calendarUpsert(job);
  if (result.deferred || result.skipped) return result;
  await cleanupTasks();
  if (await deps.rpc("google_schedule_commit_sync", { p_job_id: job.id, p_worker: job.locked_by,
    p_expected_updated_at: event.updated_at, p_target: "calendar", p_remote_id: result.google_event_id }) !== true) {
    throw new GoogleCalendarVersionChangedError();
  }
  return { ...result, target: "calendar" };
}

export async function tasksRuntimeRpc(
  call: (name: string, args: TasksRecord) => Promise<{ data: unknown; error: { code?: string } | null }>,
  name: string, args: TasksRecord,
) {
  const { data, error } = await call(name, args);
  if (error?.code === "40001") throw new GoogleCalendarVersionChangedError();
  if (error) throw new Error("Nao foi possivel registrar a sincronizacao Google Tasks.");
  if (data === null) throw new GoogleCalendarLeaseLostError();
  return data;
}
