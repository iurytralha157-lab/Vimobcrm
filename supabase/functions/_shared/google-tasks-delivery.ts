import { GoogleCalendarConflictError, conditionalGoogleWriteHeaders } from "./google-calendar-conflict.ts";
import { GoogleCalendarLeaseLostError, GoogleCalendarRetryableError, GoogleCalendarVersionChangedError } from "./google-calendar-delivery.ts";
import { buildGoogleTaskBody, buildGoogleTasksListTitle, findTasksResource, recoverGoogleTask,
  requireOwnedGoogleTask, tasksJson, type TasksRecord, type TasksRequest } from "./google-tasks-api.ts";

export type GoogleTasksDeliveryContext = {
  job: TasksRecord;
  connection: TasksRecord;
  event: TasksRecord;
  timeZone: string;
};

export type GoogleTasksDeliveryDependencies = {
  rpc: (name: string, args: TasksRecord) => Promise<unknown>;
  request: TasksRequest;
  assertSnapshot: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
};

function record(value: unknown): TasksRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Estado de sincronizacao Tasks invalido.");
  return value as TasksRecord;
}

function jobArgs(job: TasksRecord) {
  return { p_job_id: job.id, p_worker: job.locked_by };
}

async function requireResult(deps: GoogleTasksDeliveryDependencies, name: string, args: TasksRecord) {
  if (await deps.rpc(name, args) !== true) throw new GoogleCalendarLeaseLostError();
}

async function ensureList(context: GoogleTasksDeliveryContext, deps: GoogleTasksDeliveryDependencies): Promise<string> {
  if (typeof context.connection.tasks_list_id === "string" && context.connection.tasks_list_id) return context.connection.tasks_list_id;
  const state = record(await deps.rpc("google_tasks_begin_list_creation", jobArgs(context.job)));
  const existing = state.list_id || state.tasks_list_id;
  if (typeof existing === "string" && existing) return existing;
  const title = buildGoogleTasksListTitle(state.organization_name, state.creation_attempt);
  let list: TasksRecord | null;
  if (state.can_create === true) {
    // Only the durable reserved -> started transition authorizes this POST.
    list = await tasksJson(deps.request, "/users/@me/lists", { method: "POST", body: JSON.stringify({ title }) });
  } else {
    list = await findTasksResource(deps.request, "/users/@me/lists", item => item.title === title);
    if (!list) throw new GoogleCalendarConflictError("Criacao da lista Tasks sem resultado confirmado. Revisao necessaria.");
  }
  if (typeof list.id !== "string" || !list.id) throw new GoogleCalendarRetryableError("Google Tasks nao confirmou a lista criada.", 502);
  await requireResult(deps, "google_tasks_commit_list", { ...jobArgs(context.job), p_list_id: list.id });
  context.connection.tasks_list_id = list.id;
  return list.id;
}

async function markReview(context: GoogleTasksDeliveryContext, deps: GoogleTasksDeliveryDependencies, link: TasksRecord, message: string): Promise<never> {
  await requireResult(deps, "google_tasks_finalize_link", { ...jobArgs(context.job), p_link_id: link.id, p_error: message });
  throw new GoogleCalendarConflictError(message);
}

export async function deleteGoogleTaskLink(
  job: TasksRecord, link: TasksRecord, deps: GoogleTasksDeliveryDependencies,
) {
  if (link.deleted_at || link.creation_state === "deleted") return;
  const listId = String(link.tasklist_id || "");
  if (!listId) throw new GoogleCalendarConflictError("Vinculo Tasks sem lista verificada.");
  let task: TasksRecord | null;
  if (link.task_id) {
    task = await requireOwnedGoogleTask(deps.request, listId, String(link.task_id), link.creation_attempt);
  } else if (link.creation_state === "reserved") {
    task = null; // A POST was never started: no remote side effect to remove.
  } else {
    task = await recoverGoogleTask(deps.request, listId, link.creation_attempt);
    if (!task) {
      await requireResult(deps, "google_tasks_finalize_link", { ...jobArgs(job), p_link_id: link.id,
        p_error: "Criacao Tasks sem resultado confirmado; remocao exige revisao." });
      throw new GoogleCalendarConflictError("Criacao Tasks sem resultado confirmado; remocao exige revisao.");
    }
  }
  if (task && !task.deleted) {
    const response = await deps.request(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(String(task.id))}`, {
      method: "DELETE", headers: conditionalGoogleWriteHeaders(task.etag),
    });
    if (!response.ok && ![404, 410].includes(response.status)) {
      throw new GoogleCalendarRetryableError(`Falha ao remover a copia Tasks (${response.status}).`, response.status);
    }
  }
  await requireResult(deps, "google_tasks_finalize_link", { ...jobArgs(job), p_link_id: link.id, p_error: null });
}

export async function pushGoogleTask(context: GoogleTasksDeliveryContext, deps: GoogleTasksDeliveryDependencies) {
  const listId = await ensureList(context, deps);
  const link = record(await deps.rpc("google_tasks_reserve_link", {
    ...jobArgs(context.job), p_expected_updated_at: context.event.updated_at,
  }));
  if (link.creation_state === "review") {
    throw new GoogleCalendarConflictError("A copia Tasks exige revisao antes de continuar.");
  }
  if (["cancelled", "canceled"].includes(String(context.event.status))) {
    await deleteGoogleTaskLink(context.job, link, deps);
    await requireResult(deps, "google_schedule_commit_sync", { ...jobArgs(context.job),
      p_expected_updated_at: context.event.updated_at, p_target: "tasks", p_remote_id: null });
    return { target: "tasks", deleted: true };
  }
  const body = buildGoogleTaskBody(context.event, context.timeZone, link.creation_attempt);
  let task: TasksRecord | null = null;
  if (link.task_id) {
    task = await requireOwnedGoogleTask(deps.request, listId, String(link.task_id), link.creation_attempt);
    if (!task || task.deleted) return markReview(context, deps, link, "A tarefa vinculada foi removida no Google. Revisao necessaria.");
  } else {
    const started = record(await deps.rpc("google_tasks_mark_create_started", { ...jobArgs(context.job), p_link_id: link.id }));
    if (started.can_create === true) {
      await deps.assertSnapshot();
      try {
        task = await tasksJson(deps.request, `/lists/${encodeURIComponent(listId)}/tasks`, { method: "POST", body: JSON.stringify(body) });
      } catch (error) {
        // A definitive 4xx (except a timeout) did not create a task. Unknown
        // network/5xx outcomes keep started and must be reconciled, never POSTed twice.
        if (error instanceof GoogleCalendarRetryableError && error.status >= 400 && error.status < 500 && error.status !== 408) {
          await requireResult(deps, "google_tasks_reset_create", { ...jobArgs(context.job), p_link_id: link.id });
        }
        throw error;
      }
    } else {
      task = await recoverGoogleTask(deps.request, listId, link.creation_attempt);
      if (!task || task.deleted) return markReview(context, deps, link, "Criacao Tasks sem resultado confirmado. Revisao necessaria.");
    }
    if (typeof task.id !== "string" || !task.id) throw new GoogleCalendarRetryableError("Google Tasks nao confirmou a tarefa criada.", 502);
    await requireResult(deps, "google_tasks_commit_link", { ...jobArgs(context.job), p_link_id: link.id,
      p_task_id: task.id, p_etag: task.etag || null, p_remote_status: task.status || null });
  }
  // Apply the latest complete payload after either recovery or a prior edit;
  // the marker remains stable even if the user changes the activity title.
  await deps.assertSnapshot();
  task = await tasksJson(deps.request, `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(String(task.id))}`, {
    method: "PATCH", headers: conditionalGoogleWriteHeaders(task.etag), body: JSON.stringify(body),
  });
  await requireResult(deps, "google_tasks_commit_link", { ...jobArgs(context.job), p_link_id: link.id,
    p_task_id: task.id, p_etag: task.etag || null, p_remote_status: task.status || null });
  await deps.beforeCommit?.();
  if (await deps.rpc("google_schedule_commit_sync", { ...jobArgs(context.job),
    p_expected_updated_at: context.event.updated_at, p_target: "tasks", p_remote_id: task.id }) !== true) {
    throw new GoogleCalendarVersionChangedError();
  }
  return { target: "tasks", task_id: task.id };
}
