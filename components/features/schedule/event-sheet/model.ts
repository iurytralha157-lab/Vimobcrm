import { differenceInMinutes, format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatBRLCurrencyWithDefaultDecimals } from "../../../../lib/utils/formatting";
import {
  getLocalScheduleCivilDateKey,
  getNextScheduleCivilDate,
  scheduleCivilDateTimeToDate,
} from "../../../../lib/schedule-time-zone";

export const recurrenceOptions = [
  { value: "none", label: "Não se repete" },
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "yearly", label: "Anual" },
] as const;

export type RecurrenceRule = (typeof recurrenceOptions)[number]["value"];

export const recurrenceLimitLabels: Partial<Record<RecurrenceRule, string>> = {
  daily: "Próximos 90 dias",
  weekly: "Próximas 52 semanas",
  monthly: "Próximos 24 meses",
  yearly: "Próximos 5 anos",
};

export const reminderOptions = [
  { value: "none", minutes: null, label: "Sem lembrete" },
  { value: "0", minutes: 0, label: "Na hora" },
  { value: "5", minutes: 5, label: "5 min antes" },
  { value: "10", minutes: 10, label: "10 min antes" },
  { value: "15", minutes: 15, label: "15 min antes" },
  { value: "30", minutes: 30, label: "30 min antes" },
  { value: "60", minutes: 60, label: "1 hora antes" },
  { value: "90", minutes: 90, label: "1h30 antes" },
  { value: "120", minutes: 120, label: "2 horas antes" },
] as const;

export function getReminderSelectValue(minutes: number | null | undefined) {
  return typeof minutes === "number" ? String(minutes) : "none";
}

export function parseReminderSelectValue(value: string) {
  if (value === "none") return null;
  const option = reminderOptions.find((item) => item.value === value);
  return option?.minutes ?? null;
}

export function getReminderLabel(minutes: number | null | undefined) {
  const value = getReminderSelectValue(minutes);
  return (
    reminderOptions.find((option) => option.value === value)?.label ||
    `${minutes} min antes`
  );
}

export const visibilityOptions = [
  {
    value: "default",
    label: "Padrão",
    description: "Quem não participa vê somente que o horário está ocupado.",
  },
  {
    value: "public",
    label: "Público",
    description: "Quem tem acesso à agenda vê os detalhes permitidos.",
  },
  {
    value: "private",
    label: "Privado",
    description: "Somente responsáveis e administradores veem o evento.",
  },
] as const;

export const timeOptions = Array.from({ length: 24 * 4 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

export interface AssigneeCandidate {
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface DisplayAssignee extends AssigneeCandidate {
  primary: boolean;
}

interface BuildDisplayAssigneesInput {
  users: readonly AssigneeCandidate[];
  loadedAssignees: readonly AssigneeCandidate[];
  draftAssigneeIds: readonly string[];
  primaryUserId: string;
  eventUser?: AssigneeCandidate | null;
  isMasked: boolean;
}

export function isRecurrenceRule(
  value: string | null | undefined,
): value is RecurrenceRule {
  return recurrenceOptions.some((option) => option.value === value);
}

export function formatPropertyPrice(value: number | null, tipo: string | null) {
  if (!value) return "Preço não informado";
  if (tipo === "Aluguel") {
    return `${formatBRLCurrencyWithDefaultDecimals(value)}/mês`;
  }
  return formatBRLCurrencyWithDefaultDecimals(value);
}

export function getNextFutureQuarterHour(now: Date) {
  const next = new Date(now);
  const nextQuarter = Math.floor(next.getMinutes() / 15) * 15 + 15;
  next.setMinutes(nextQuarter, 0, 0);
  return next;
}

export function getInitialStartDate({
  defaultDate,
  now,
  fallback,
}: {
  defaultDate?: Date;
  now: Date;
  fallback: Date;
}) {
  if (!defaultDate) return fallback;

  const selected = new Date(defaultDate);
  if (Number.isNaN(selected.getTime())) return fallback;
  const hasExplicitTime =
    selected.getHours() !== 0 ||
    selected.getMinutes() !== 0 ||
    selected.getSeconds() !== 0;

  if (isSameDay(selected, now) && (!hasExplicitTime || selected <= now)) {
    return fallback;
  }

  return selected;
}

export function formatScheduleTimestamp(value: string | null | undefined) {
  if (!value) return "Data indisponível";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : format(date, "dd/MM HH:mm", { locale: ptBR });
}

export function getDefaultDurationMinutes(
  eventType: string | null | undefined,
) {
  return eventType === "visit" || eventType === "meeting" ? 60 : 30;
}

export function getStoredDurationMinutes({
  start,
  end,
  eventType,
}: {
  start: Date;
  end: Date | null;
  eventType: string | null | undefined;
}) {
  const fallback = getDefaultDurationMinutes(eventType);
  if (!end || Number.isNaN(end.getTime())) return fallback;
  const duration = differenceInMinutes(end, start);
  return duration > 0 ? duration : fallback;
}

export function getClockRangeDurationMinutes({
  date,
  startTime,
  endTime,
  timeZone,
  preferredStartTime,
}: {
  date: Date;
  startTime: string;
  endTime: string;
  timeZone?: string;
  preferredStartTime?: Date | string | number | null;
}) {
  if (timeZone) {
    const civilDate = getLocalScheduleCivilDateKey(date);
    const endCivilDate =
      endTime <= startTime ? getNextScheduleCivilDate(civilDate) : civilDate;
    if (!endCivilDate) return null;

    const start = scheduleCivilDateTimeToDate(civilDate, startTime, timeZone, {
      preferredInstant: preferredStartTime,
    });
    const end = start
      ? scheduleCivilDateTimeToDate(endCivilDate, endTime, timeZone, {
          preferredInstant: endCivilDate === civilDate ? start : undefined,
        })
      : null;
    if (!start || !end) return null;

    const duration = differenceInMinutes(end, start);
    return duration > 0 ? duration : null;
  }

  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) {
    return null;
  }

  const start = new Date(date);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(date);
  end.setHours(endHour, endMinute, 0, 0);
  const duration = differenceInMinutes(end, start);
  return duration > 0 ? duration : duration + 24 * 60;
}

export function buildDisplayAssignees({
  users,
  loadedAssignees,
  draftAssigneeIds,
  primaryUserId,
  eventUser,
  isMasked,
}: BuildDisplayAssigneesInput): DisplayAssignee[] {
  if (isMasked) return [];

  const list: DisplayAssignee[] = [];
  const primary =
    users.find((user) => user.id === primaryUserId) ||
    (eventUser?.id === primaryUserId ? eventUser : null);
  if (primary) list.push({ ...primary, primary: true });

  draftAssigneeIds.forEach((id) => {
    const user =
      loadedAssignees.find((assignee) => assignee.id === id) ||
      users.find((candidate) => candidate.id === id);
    if (
      user &&
      user.id !== primaryUserId &&
      !list.some((item) => item.id === user.id)
    ) {
      list.push({ ...user, primary: false });
    }
  });

  return list;
}

export function getAvailableAssignees(
  users: readonly AssigneeCandidate[],
  primaryUserId: string,
  draftAssigneeIds: readonly string[],
) {
  return users.filter(
    (user) => user.id !== primaryUserId && !draftAssigneeIds.includes(user.id),
  );
}

export function applyTeamSelection({
  memberIds,
  primaryUserId,
  draftAssigneeIds,
}: {
  memberIds: readonly string[];
  primaryUserId: string;
  draftAssigneeIds: readonly string[];
}) {
  const pendingIds = memberIds.filter(
    (id) => id !== primaryUserId && !draftAssigneeIds.includes(id),
  );

  return {
    primaryUserId: primaryUserId || memberIds[0] || "",
    draftAssigneeIds:
      pendingIds.length > 0
        ? Array.from(new Set([...draftAssigneeIds, ...pendingIds]))
        : [...draftAssigneeIds],
  };
}
