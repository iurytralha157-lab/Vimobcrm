import { buildGoogleEventDescription, buildGoogleEventSummary } from "./google-calendar-event.ts";
import { normalizeGoogleCalendarTimeZone, scheduleInstantToGoogleDate } from "./google-calendar-time.ts";
import { GoogleCalendarConflictError } from "./google-calendar-conflict.ts";
import { GoogleCalendarRetryableError, googleCalendarErrorStatus, googleCalendarRetryAfter } from "./google-calendar-delivery.ts";

export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export type TasksRecord = Record<string, unknown>;
export type TasksRequest = (path: string, init?: RequestInit) => Promise<Response>;

export function hasGoogleTasksScope(scope: unknown): boolean {
  return typeof scope === "string" && scope.split(/\s+/).includes(GOOGLE_TASKS_SCOPE);
}

export function assertGoogleTasksScope(scope: unknown) {
  if (!hasGoogleTasksScope(scope)) {
    throw new GoogleCalendarRetryableError("Autorize o Google Tasks para enviar tarefas, mensagens, e-mails e ligacoes.", 403);
  }
}

function uuid(value: unknown): string {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new Error("Identidade de sincronizacao Tasks invalida.");
  }
  return text;
}

// An opaque creation attempt is not an authorization token. It identifies
// only this export, without disclosing tenant/user IDs in Google's notes.
export function googleTaskMarker(attempt: unknown): string {
  return `Origem Vimob: ${uuid(attempt)}`;
}

export function buildGoogleTasksListTitle(name: unknown, attempt: unknown): string {
  const company = typeof name === "string" ? name.trim().slice(0, 45) : "";
  return `Vimob${company ? ` — ${company}` : ""} · ${uuid(attempt)}`;
}

export function taskMatchesAttempt(task: TasksRecord, attempt: unknown): boolean {
  return typeof task.notes === "string" && task.notes.split("\n").includes(googleTaskMarker(attempt));
}

export function buildGoogleTaskBody(event: TasksRecord, timeZone: string, attempt: unknown): TasksRecord {
  const zone = normalizeGoogleCalendarTimeZone(timeZone);
  const start = String(event.start_time || "");
  const date = scheduleInstantToGoogleDate(start, zone);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: zone, dateStyle: "short", timeStyle: "short", hourCycle: "h23",
  });
  const timing = event.is_all_day
    ? `Data no Vimob: ${date} (dia inteiro; ${zone}).`
    : `Horario no Vimob: ${formatter.format(new Date(start))} a ${formatter.format(new Date(String(event.end_time)))} (${zone}).`;
  const description = buildGoogleEventDescription(event);
  const notes = [description, timing, "Os horarios e lembretes desta atividade sao gerenciados no Vimob.", googleTaskMarker(attempt)]
    .filter(Boolean).join("\n\n");
  return {
    title: buildGoogleEventSummary(event).slice(0, 1024),
    notes,
    due: `${date}T00:00:00.000Z`,
    status: event.status === "completed" ? "completed" : "needsAction",
    // Null clears a previous completion when reopening a task.
    completed: event.status === "completed" ? event.completed_at || event.outcome_recorded_at || new Date().toISOString() : null,
  };
}

export function buildGoogleTasksApiUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n\\#]/.test(path)) {
    throw new Error("Caminho Google Tasks invalido.");
  }
  const base = "https://tasks.googleapis.com/tasks/v1";
  const url = new URL(`${base}${path}`);
  if (url.origin !== "https://tasks.googleapis.com" || !url.pathname.startsWith("/tasks/v1/")) {
    throw new Error("Destino Google Tasks invalido.");
  }
  return url.toString();
}

export async function tasksJson(request: TasksRequest, path: string, init?: RequestInit): Promise<TasksRecord> {
  const response = await request(path, init);
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // Provider error bodies may contain task content. Return only a fixed
    // message and the HTTP classification to the fenced job finisher.
    throw new GoogleCalendarRetryableError(`Falha na sincronizacao Google Tasks (${response.status}).`,
      googleCalendarErrorStatus(response.status, data), googleCalendarRetryAfter(response.headers.get("Retry-After")));
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new GoogleCalendarRetryableError("Resposta Google Tasks incompleta.", 502);
  }
  return data as TasksRecord;
}

export async function findTasksResource(
  request: TasksRequest, path: string, matches: (item: TasksRecord) => boolean,
): Promise<TasksRecord | null> {
  const found: TasksRecord[] = [];
  const seenPages = new Set<string>();
  const deadline = Date.now() + 60_000;
  let nextPage = "";
  for (let page = 0; page < 250; page++) {
    if (Date.now() >= deadline) throw new GoogleCalendarRetryableError("Tempo limite ao verificar Google Tasks.", 408);
    const separator = path.includes("?") ? "&" : "?";
    const response = await tasksJson(request, `${path}${separator}maxResults=100${nextPage ? `&pageToken=${encodeURIComponent(nextPage)}` : ""}`);
    if (response.items !== undefined && !Array.isArray(response.items)) {
      throw new GoogleCalendarConflictError("Resposta Tasks invalida; revise a sincronizacao.");
    }
    for (const value of Array.isArray(response.items) ? response.items : []) {
      if (value && typeof value === "object" && !Array.isArray(value) && matches(value as TasksRecord)) found.push(value as TasksRecord);
    }
    if (found.length > 1) throw new GoogleCalendarConflictError("Mais de uma copia Tasks encontrada. Revisao necessaria.");
    if (!response.nextPageToken) return found[0] || null;
    if (typeof response.nextPageToken !== "string" || seenPages.has(response.nextPageToken)) break;
    nextPage = response.nextPageToken;
    seenPages.add(nextPage);
  }
  throw new GoogleCalendarConflictError("Nao foi possivel concluir a verificacao Tasks. Revisao necessaria.");
}

export async function recoverGoogleTask(request: TasksRequest, listId: string, attempt: unknown) {
  return findTasksResource(request,
    `/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true&showDeleted=true`,
    task => taskMatchesAttempt(task, attempt));
}

export async function requireOwnedGoogleTask(request: TasksRequest, listId: string, taskId: string, attempt: unknown) {
  const response = await request(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`);
  if ([404, 410].includes(response.status)) return null;
  if (!response.ok) throw new GoogleCalendarRetryableError(`Falha ao consultar Google Tasks (${response.status}).`, response.status,
    googleCalendarRetryAfter(response.headers.get("Retry-After")));
  const task: unknown = await response.json();
  if (!task || typeof task !== "object" || Array.isArray(task) ||
    (task as TasksRecord).id !== taskId || !taskMatchesAttempt(task as TasksRecord, attempt)) {
    throw new GoogleCalendarConflictError("A tarefa Google nao corresponde a copia do Vimob. Revisao necessaria.");
  }
  return task as TasksRecord;
}
