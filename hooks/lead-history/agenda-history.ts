import { DEFAULT_SCHEDULE_TIME_ZONE } from '@/lib/schedule-outcome';
import { formatScheduleZonedTime, getScheduleCivilDateKey } from '@/lib/schedule-time-zone';
import type { HistoryMetadata } from './types';
import { asMetadata } from './metadata';

const agendaLabels: Record<string, string> = {
  agenda_created: 'Atividade agendada',
  agenda_rescheduled: 'Atividade remarcada',
  agenda_completed: 'Atividade concluída',
  agenda_no_show: 'Cliente não compareceu',
  agenda_cancelled: 'Atividade cancelada',
  agenda_commented: 'Comentário em atividade',
  agenda_updated: 'Atividade atualizada',
  visit_scheduled: 'Visita agendada',
  visit_made: 'Visita realizada',
  visit_confirmed: 'Visita realizada',
  meeting_scheduled: 'Reunião agendada',
  meeting_made: 'Reunião realizada',
  meeting_held: 'Reunião realizada',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function field(metadata: HistoryMetadata, key: string) {
  return Object.hasOwn(metadata, key) ? text(metadata[key]) : null;
}

export function isAgendaHistoryType(type: string) {
  return Object.hasOwn(agendaLabels, type);
}

function producerAppointmentTitle(type: string, value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  const label = agendaLabels[type];
  // Old producers used these exact action prefixes without accents. An action
  // heading or arbitrary description/comment is never an appointment title.
  const prefixes = [label, label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  for (const prefix of prefixes) {
    if (candidate.startsWith(`${prefix}: `)) return text(candidate.slice(prefix.length + 2));
  }
  return null;
}

function validAppointmentInstant(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = month === 2 ? leap ? 29 : 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  // Date.parse alone silently turns 31 February into a different civil date.
  return day <= lastDay && Number.isFinite(Date.parse(value));
}

function appointmentTime(metadata: HistoryMetadata, timeZone?: string) {
  const zone = field(metadata, 'time_zone') || timeZone || DEFAULT_SCHEDULE_TIME_ZONE;
  const value = ['starts_at', 'start_at', 'start_time', 'scheduled_at'].map(key => field(metadata, key)).find(Boolean);
  if (!value || !validAppointmentInstant(value)) return null;
  const date = getScheduleCivilDateKey(value, zone);
  if (!date) return null;
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year} às ${formatScheduleZonedTime(value, zone)}`;
}

/** Present only the authorized appointment snapshot, never a comment body. */
export function getAgendaHistoryPresentation(type: string, metadata: HistoryMetadata, options: {
  description?: unknown; content?: unknown; timeZone?: string;
} = {}): { label: string; content?: string } | null {
  if (!isAgendaHistoryType(type)) return null;
  const source = asMetadata(metadata);
  const title = field(source, 'event_title')
    || producerAppointmentTitle(type, options.description)
    || producerAppointmentTitle(type, options.content)
    || field(source, 'title');
  const content = [title, appointmentTime(source, options.timeZone)].filter(Boolean).join('\n');
  return { label: agendaLabels[type], content: content || undefined };
}
