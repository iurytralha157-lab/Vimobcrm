import type { CSSProperties } from 'react';
import { format, type Locale } from 'date-fns';
import type { EventType, ScheduleEvent } from '@/hooks/use-schedule-events';
export { getErrorObjectMessage as getErrorMessage } from '@/lib/api/vimob-error';
import type {
  CadenceTaskType,
  LeadDetailLead,
  LeadDetailTag,
  RenderableLeadTag,
  SelectableLeadProperty,
} from './types';

export const OUTCOME_CADENCE_TASK_TYPES: CadenceTaskType[] = ['call', 'message', 'email'];

export const stageTooltipClassName =
  'max-w-[18rem] text-[11px] font-normal leading-snug tracking-normal';

export function getLeadPropertyFallback(
  lead: LeadDetailLead | null,
): SelectableLeadProperty | null {
  const property = lead?.interest_property || lead?.property || null;
  const propertyId = lead?.interest_property_id || lead?.property_id || property?.id || null;

  if (!propertyId) return null;

  return {
    id: propertyId,
    title: property?.title || null,
    code: property?.code || null,
    preco: typeof property?.preco === 'number' ? property.preco : null,
    commission_percentage:
      typeof lead?.commission_percentage === 'number' ? lead.commission_percentage : null,
  };
}

export function mergePropertyFallback(
  properties: SelectableLeadProperty[],
  fallback: SelectableLeadProperty | null,
) {
  if (!fallback || properties.some((property) => property.id === fallback.id)) return properties;
  return [fallback, ...properties];
}

export function getCadenceTaskType(type?: string | null): CadenceTaskType {
  return type === 'message' || type === 'email' || type === 'note' ? type : 'call';
}

export function hasTagId(
  tag: LeadDetailTag | null | undefined,
): tag is RenderableLeadTag {
  return typeof tag?.id === 'string' && tag.id.length > 0;
}

export function formatDateSafely(
  value: string | Date,
  pattern: string,
  locale: Locale,
  fallback: string,
) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : format(date, pattern, { locale });
}

export function getDealStatusTriggerClass(status?: string | null) {
  if (status === 'won') {
    return '!border-0 !bg-emerald-600 !text-white !shadow-none !ring-0 !ring-offset-0 transition-colors hover:!bg-emerald-700 data-[state=open]:!bg-emerald-700 focus:!ring-0 focus-visible:!ring-1 focus-visible:!ring-emerald-500/40 focus-visible:!ring-offset-0';
  }

  if (status === 'lost') {
    return '!border-0 !bg-red-600 !text-white !shadow-none !ring-0 !ring-offset-0 transition-colors hover:!bg-red-700 data-[state=open]:!bg-red-700 focus:!ring-0 focus-visible:!ring-1 focus-visible:!ring-red-500/40 focus-visible:!ring-offset-0';
  }

  return '!border-0 !bg-[var(--app-surface-soft)] !text-[var(--app-text-primary)] !shadow-none !ring-0 !ring-offset-0 transition-colors hover:!bg-[var(--app-surface-hover)] data-[state=open]:!bg-[var(--app-surface-hover)] focus:!ring-0 focus-visible:!ring-1 focus-visible:!ring-[var(--app-border-strong)] focus-visible:!ring-offset-0';
}

export function getScheduleEventType(value?: string | null): EventType {
  return value === 'email' ||
    value === 'meeting' ||
    value === 'task' ||
    value === 'message' ||
    value === 'visit'
    ? value
    : 'call';
}

export function getScheduleStatusLabel(status?: string | null, isLate = false) {
  if (status === 'completed') return 'Concluído';
  if (status === 'cancelled' || status === 'canceled') return 'Cancelado';
  if (status === 'no_show') return 'Não compareceu';
  if (isLate) return 'Atrasado';
  return 'Em aberto';
}

export function getScheduleStatusClass(status?: string | null, isLate = false) {
  if (status === 'completed') return 'bg-emerald-500/12 text-emerald-500';
  if (status === 'cancelled' || status === 'canceled') return 'bg-red-500/12 text-red-500';
  if (status === 'no_show') return 'bg-amber-500/12 text-amber-500';
  if (isLate) return 'bg-red-500/12 text-red-500';
  return 'bg-primary/12 text-primary';
}

export function getScheduleDateLabel(event: ScheduleEvent, locale: Locale) {
  const startDate = new Date(event.start_time);
  const endDate = new Date(event.end_time);
  if (Number.isNaN(startDate.getTime())) return 'Data inválida';

  const dateLabel = formatDateSafely(startDate, 'dd/MM', locale, 'Data inválida');
  const startTime = formatDateSafely(startDate, 'HH:mm', locale, '--:--');
  const endTime = formatDateSafely(endDate, 'HH:mm', locale, startTime);

  if (event.is_all_day) return `${dateLabel} - dia todo`;
  if (event.end_time && startTime !== endTime) return `${dateLabel} ${startTime}-${endTime}`;
  return `${dateLabel} ${startTime}`;
}

export function getStageStepperStyle(stageCount: number): CSSProperties {
  if (stageCount > 32) {
    return {
      '--lead-stage-step-size': '1.35rem',
      '--lead-stage-step-font-size': '0.625rem',
      '--lead-stage-step-gap': '0.25rem',
    } as CSSProperties;
  }

  if (stageCount > 20) {
    return {
      '--lead-stage-step-size': '1.55rem',
      '--lead-stage-step-font-size': '0.6875rem',
      '--lead-stage-step-gap': '0.25rem',
    } as CSSProperties;
  }

  return {
    '--lead-stage-step-size': '2rem',
    '--lead-stage-step-font-size': '0.75rem',
    '--lead-stage-step-gap': '0.375rem',
  } as CSSProperties;
}
