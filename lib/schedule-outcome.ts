export type ScheduleLifecycleState =
  "open" | "overdue" | "completed" | "no_show" | "rescheduled" | "cancelled";

const FINAL_SCHEDULE_STATUSES = new Set([
  "completed",
  "no_show",
  "cancelled",
  "canceled",
]);

export const DEFAULT_SCHEDULE_TIME_ZONE = "America/Sao_Paulo";

function getCivilDateKey(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function isAttendanceScheduleType(
  eventType: string | null | undefined,
): eventType is "meeting" | "visit" {
  return eventType === "meeting" || eventType === "visit";
}

export function isFinalScheduleStatus(status: string | null | undefined) {
  return FINAL_SCHEDULE_STATUSES.has(status || "");
}

export function shouldPreserveAttendanceHistory(
  eventType: string | null | undefined,
  status: string | null | undefined,
) {
  return isAttendanceScheduleType(eventType) && isFinalScheduleStatus(status);
}

export function getSimpleScheduleCompletionOutcome(
  eventType: string | null | undefined,
): "contacted" | "activity_completed" | null {
  if (eventType === "task") return "activity_completed";
  if (
    eventType === "call" ||
    eventType === "email" ||
    eventType === "message"
  ) {
    return "contacted";
  }
  return null;
}

export function scheduleStatusForOutcome(
  outcome: string,
): "completed" | "no_show" | "cancelled" {
  if (outcome === "no_show") return "no_show";
  if (outcome === "cancelled" || outcome === "rescheduled") {
    return "cancelled";
  }
  return "completed";
}

export function getScheduleOutcomeLabel(outcome: string | null | undefined) {
  if (!outcome) return "";
  const labels: Record<string, string> = {
    contacted: "Contato realizado",
    activity_completed: "Atividade concluída",
    qualified: "Lead qualificado",
    proposal: "Proposta apresentada",
    visit_completed: "Visita realizada",
    meeting_completed: "Reunião realizada",
    follow_up: "Requer acompanhamento",
    no_show: "No-show",
    rescheduled: "Remarcado",
    cancelled: "Cancelado",
    other: "Outro resultado",
  };
  return labels[outcome] || outcome;
}

export function getScheduleLifecycleState({
  status,
  outcome,
  startTime,
  endTime,
  isAllDay = false,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
  now = Date.now(),
}: {
  status?: string | null;
  outcome?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  timeZone?: string;
  now?: number;
}): ScheduleLifecycleState {
  if (outcome === "rescheduled") return "rescheduled";
  if (status === "no_show" || outcome === "no_show") return "no_show";
  if (
    status === "cancelled" ||
    status === "canceled" ||
    outcome === "cancelled"
  ) {
    return "cancelled";
  }
  if (status === "completed") return "completed";

  const endTimestamp = endTime ? Date.parse(endTime) : Number.NaN;
  const startTimestamp = startTime ? Date.parse(startTime) : Number.NaN;
  const dueTimestamp = Number.isFinite(endTimestamp)
    ? endTimestamp
    : startTimestamp;
  if (isAllDay && Number.isFinite(dueTimestamp)) {
    try {
      return getCivilDateKey(dueTimestamp, timeZone) <
        getCivilDateKey(now, timeZone)
        ? "overdue"
        : "open";
    } catch {
      return getCivilDateKey(dueTimestamp, DEFAULT_SCHEDULE_TIME_ZONE) <
        getCivilDateKey(now, DEFAULT_SCHEDULE_TIME_ZONE)
        ? "overdue"
        : "open";
    }
  }
  if (Number.isFinite(dueTimestamp) && dueTimestamp < now) {
    return "overdue";
  }
  return "open";
}

export function getScheduleLifecycleLabel(state: ScheduleLifecycleState) {
  const labels: Record<ScheduleLifecycleState, string> = {
    open: "Em aberto",
    overdue: "Em atraso",
    completed: "Concluído",
    no_show: "No-show",
    rescheduled: "Remarcado",
    cancelled: "Cancelado",
  };
  return labels[state];
}
