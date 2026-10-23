import {
  getScheduleLifecycleLabel,
  getScheduleLifecycleState,
  type ScheduleLifecycleState,
} from "@/lib/schedule-outcome";

export type ScheduleDisplayLifecycle = ScheduleLifecycleState | "busy";

type ScheduleDisplayEvent = {
  is_masked?: boolean;
  title?: string | null;
  event_type?: string | null;
  status?: string | null;
  outcome?: string | null;
  start_time: string;
  end_time: string;
  is_all_day?: boolean | null;
};

export function getScheduleDisplayLifecycle(
  event: ScheduleDisplayEvent,
  timeZone: string,
  now: number,
): ScheduleDisplayLifecycle {
  if (event.is_masked) return "busy";
  return getScheduleLifecycleState({
    status: event.status,
    outcome: event.outcome,
    startTime: event.start_time,
    endTime: event.end_time,
    isAllDay: event.is_all_day ?? false,
    timeZone,
    now,
  });
}

export function getScheduleDisplayLifecycleLabel(state: ScheduleDisplayLifecycle) {
  return state === "busy" ? "Horário ocupado" : getScheduleLifecycleLabel(state);
}

const eventTypeTitles: Record<string, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

export function getScheduleDisplayTitle(event: Pick<ScheduleDisplayEvent, "is_masked" | "title" | "event_type">) {
  if (event.is_masked) return "Horário ocupado";
  const storedTitle = event.title?.trim();
  if (storedTitle) return storedTitle;
  const typeTitle = event.event_type ? eventTypeTitles[event.event_type] : undefined;
  return typeof typeTitle === "string" ? typeTitle : "Compromisso";
}

export function matchesScheduleEventType(
  event: Pick<ScheduleDisplayEvent, "is_masked" | "event_type">,
  selectedType: string | null,
) {
  return !selectedType || Boolean(event.is_masked) || event.event_type === selectedType;
}
