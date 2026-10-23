import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';

// Presentation palette retained from the lead history; event data stays unchanged.
function metadataText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value === true || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  return null;
}

export function getOutcomeVariant(event: UnifiedHistoryEvent): 'success' | 'warning' | 'error' | 'default' {
  const outcome = metadataText(event.metadata?.outcome);
  if (!outcome) return 'default';
  if (['answered', 'replied', 'scheduled', 'done'].includes(outcome)) return 'success';
  if (['invalid_number', 'no_whatsapp', 'bounced'].includes(outcome)) return 'error';
  if (['not_answered', 'busy', 'seen_no_reply', 'not_seen', 'not_replied'].includes(outcome)) return 'warning';
  return 'default';
}

export function getEventTone(event: UnifiedHistoryEvent, plainHistory: boolean) {
  const text = `${event.type} ${event.label} ${event.content || ''}`.toLowerCase();
  const toStatus = (metadataText(event.metadata?.to_status) || metadataText(event.metadata?.new_status) || '').toLowerCase();
  const neutralTone = plainHistory
    ? 'bg-zinc-700 !text-white'
    : 'bg-[var(--app-surface-soft)] !text-[var(--app-text-secondary)]';

  if (event.type === 'lead_created' || text.includes('foi criado')) {
    return 'bg-green-600 !text-white';
  }

  if (event.type === 'first_response') {
    return 'bg-amber-400 !text-amber-950';
  }

  if (event.type === 'assignee_changed' && metadataText(event.metadata?.reason) === 'manual_transfer') {
    return 'bg-violet-600 !text-white';
  }

  if (event.type === 'task_completed') {
    return neutralTone;
  }

  if (event.type === 'meta_form_answer') {
    return 'bg-blue-600 !text-white';
  }

  if (event.type === 'webhook_form_answer') {
    return 'bg-primary !text-primary-foreground';
  }

  if (event.type === 'property_selected' || event.type === 'property_linked') {
    return plainHistory ? 'bg-orange-700 !text-white' : 'bg-primary/10 !text-primary';
  }

  if (
    event.type === 'agenda_created' ||
    event.type === 'agenda_rescheduled' ||
    event.type === 'visit_scheduled' ||
    event.type === 'visit_confirmed' ||
    event.type === 'meeting_scheduled' ||
    event.type === 'meeting_held'
  ) {
    return plainHistory ? 'bg-blue-600 !text-white' : 'bg-blue-500/10 !text-blue-600 dark:!text-blue-300';
  }

  if (event.type === 'proposal_sent') {
    return plainHistory ? 'bg-amber-700 !text-white' : 'bg-amber-500/10 !text-amber-700 dark:!text-amber-300';
  }

  if (toStatus === 'won') {
    return 'bg-emerald-600 !text-white';
  }

  if (toStatus === 'lost') {
    return 'bg-red-600 !text-white';
  }

  if (toStatus === 'open') {
    return plainHistory ? 'bg-amber-700 !text-white' : 'bg-amber-500/10 !text-amber-700 dark:!text-amber-300';
  }

  if (text.includes('ganho') || text.includes('venda conclu')) {
    return 'bg-emerald-600 !text-white';
  }

  if (text.includes('perdido') || text.includes('perda')) {
    return 'bg-red-600 !text-white';
  }

  if (text.includes('reaberto')) {
    return plainHistory ? 'bg-amber-700 !text-white' : 'bg-amber-500/10 !text-amber-700 dark:!text-amber-300';
  }

  const outcomeVariant = getOutcomeVariant(event);
  if (outcomeVariant === 'success') return 'bg-emerald-600 !text-white';
  if (outcomeVariant === 'warning') return 'bg-amber-600 !text-white';
  if (outcomeVariant === 'error') return 'bg-red-600 !text-white';

  if (event.type === 'stage_changed' || event.type === 'stage_change') {
    return neutralTone;
  }

  if (event.type.includes('tag')) {
    return plainHistory ? 'bg-violet-600 !text-white' : 'bg-primary/12 !text-primary';
  }

  return neutralTone;
}
