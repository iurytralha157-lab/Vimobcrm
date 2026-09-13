export const MAX_SCHEDULE_REMINDER_MINUTES = 120;
export const SCHEDULE_REMINDER_CATCH_UP_MINUTES = 10;
export const SCHEDULE_OUTCOME_PROMPT_CATCH_UP_MINUTES = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OUTCOME_EVENT_TYPES = new Set(["meeting", "visit"]);

type ScheduleReminderCandidate = {
  status?: unknown;
  start_time?: unknown;
  reminder_minutes?: unknown;
};

type ScheduleOutcomeCandidate = {
  status?: unknown;
  event_type?: unknown;
  end_time?: unknown;
};

export type ScheduleReminderDecision = {
  minutes: number;
  dueAt: string;
  when: string;
};

function timestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeScheduleReminderMinutes(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_SCHEDULE_REMINDER_MINUTES
  ) {
    return null;
  }

  return value;
}

export function getScheduleReminderDecision(
  event: ScheduleReminderCandidate,
  now = new Date(),
  catchUpMinutes = SCHEDULE_REMINDER_CATCH_UP_MINUTES,
): ScheduleReminderDecision | null {
  if (event.status !== "scheduled") return null;

  const reminderMinutes = normalizeScheduleReminderMinutes(
    event.reminder_minutes,
  );
  const startAt = timestamp(event.start_time);
  if (reminderMinutes === null || startAt === null) return null;

  const dueAt = startAt - reminderMinutes * 60_000;
  const nowAt = now.getTime();
  if (nowAt < dueAt || nowAt > dueAt + Math.max(0, catchUpMinutes) * 60_000) {
    return null;
  }

  const minutesUntilStart = Math.round((startAt - nowAt) / 60_000);
  const when =
    minutesUntilStart > 1
      ? `começa em ${minutesUntilStart} minutos`
      : minutesUntilStart === 1
        ? "começa em 1 minuto"
        : minutesUntilStart >= 0
          ? "começa agora"
          : `começou há ${Math.abs(minutesUntilStart)} ${
              Math.abs(minutesUntilStart) === 1 ? "minuto" : "minutos"
            }`;

  return {
    minutes: reminderMinutes,
    dueAt: new Date(dueAt).toISOString(),
    when,
  };
}

export function isScheduleOutcomePromptDue(
  event: ScheduleOutcomeCandidate,
  now = new Date(),
  minimumDelayMinutes = 5,
  maximumDelayMinutes = SCHEDULE_OUTCOME_PROMPT_CATCH_UP_MINUTES,
) {
  if (
    event.status !== "scheduled" ||
    typeof event.event_type !== "string" ||
    !OUTCOME_EVENT_TYPES.has(event.event_type)
  ) {
    return false;
  }

  const endAt = timestamp(event.end_time);
  if (endAt === null) return false;

  const elapsedMinutes = (now.getTime() - endAt) / 60_000;
  return (
    elapsedMinutes >= Math.max(0, minimumDelayMinutes) &&
    elapsedMinutes <= Math.max(minimumDelayMinutes, maximumDelayMinutes)
  );
}

export function scheduleNotificationRecipientIds(
  primaryUserId: unknown,
  assignees: unknown,
) {
  const recipients = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && UUID_RE.test(value.trim())) {
      recipients.add(value.trim().toLowerCase());
    }
  };

  add(primaryUserId);
  const entries = Array.isArray(assignees)
    ? assignees
    : assignees && typeof assignees === "object"
      ? [assignees]
      : [];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && "user_id" in entry) {
      add((entry as { user_id?: unknown }).user_id);
    }
  }

  return [...recipients];
}

export function scheduleEventTypeLabel(value: unknown) {
  switch (value) {
    case "call":
      return "Ligação";
    case "email":
      return "E-mail";
    case "meeting":
      return "Reunião";
    case "message":
      return "Mensagem";
    case "visit":
      return "Visita ao imóvel";
    default:
      return "Compromisso";
  }
}
