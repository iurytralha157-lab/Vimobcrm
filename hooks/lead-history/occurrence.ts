import { asMetadata, metadataString } from './metadata';
import type { HistoryMetadata } from './types';

type Occurrence = {
  id?: string;
  type: string;
  timestamp?: string | null;
  actorId?: string | null;
  content?: string | null;
  metadata?: HistoryMetadata | null;
};

const canonicalType = (type: string) => type === 'stage_change' ? 'stage_changed'
  : type === 'assignee_changed' ? 'lead_assigned' : type;

export function historyTimesMatch(left?: string | null, right?: string | null) {
  const a = new Date(left || '').getTime();
  const b = new Date(right || '').getTime();
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 5_000;
}

/** Suppress a second representation of one occurrence, never a whole type. */
export function sameHistoryOccurrence(left: Occurrence, right: Occurrence): boolean {
  const type = canonicalType(left.type);
  if (type !== canonicalType(right.type)) return false;
  const a = asMetadata(left.metadata);
  const b = asMetadata(right.metadata);
  for (const key of ['distribution_event_id', 'entry_event_id', 'message_id', 'operation_id', 'request_id']) {
    const av = metadataString(a[key]);
    const bv = metadataString(b[key]);
    if (av && bv) return av === bv;
  }
  if (metadataString(a.activity_id) === right.id || metadataString(b.activity_id) === left.id
    || metadataString(a.timeline_event_id) === right.id || metadataString(b.timeline_event_id) === left.id) return true;
  if (!historyTimesMatch(left.timestamp, right.timestamp)) return false;
  if (left.actorId && right.actorId && left.actorId !== right.actorId) return false;

  const text = (meta: HistoryMetadata, keys: string[]) => keys.map(key => metadataString(meta[key])).find(Boolean) || null;
  const equalDimension = (ids: string[], names: string[] = []) => {
    const ai = text(a, ids); const bi = text(b, ids);
    if (ai && bi) return ai === bi;
    const an = text(a, names); const bn = text(b, names);
    return Boolean(an && bn && an === bn);
  };
  if (type === 'stage_changed') return equalDimension(['from_stage_id', 'old_stage_id'], ['from_stage', 'old_stage_name'])
    && equalDimension(['to_stage_id', 'new_stage_id'], ['to_stage', 'new_stage_name']);
  if (type === 'lead_assigned') return equalDimension(['to_user_id', 'assigned_user_id'])
    && (!text(a, ['from_user_id']) || !text(b, ['from_user_id']) || equalDimension(['from_user_id']));
  if (type === 'tag_added' || type === 'tag_removed') return equalDimension(['tag_id'], ['tag_name']);
  if (type.startsWith('whatsapp_message')) return false; // Requires the message identity above.
  if (type === 'call_initiated') return equalDimension(['phone']);
  if (type === 'lead_created' || type === 'first_response') return true;
  return Boolean(left.content?.trim() && left.content === right.content);
}
