import { asMetadata } from './metadata';
import type { HistoryMetadata, LeadEntryEventRow, UnifiedHistoryEvent } from './types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasEntryIdentity = (metadata: HistoryMetadata) => Object.prototype.hasOwnProperty.call(metadata, 'entry_event_id');
const text = (value: unknown) => typeof value === 'string' && value.trim() && value.trim() === value ? value : null;
const reference = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : null;

// Date truncates PostgreSQL microseconds. Normalize the whole second and retain
// the complete fraction separately; equal text/minutes/milliseconds prove nothing.
function transactionTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, date, clock, fraction = '', offset] = match;
  const wall = new Date(`${date}T${clock}Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 19) !== `${date}T${clock}`) return null;
  const seconds = Date.parse(`${date}T${clock}${offset}`) / 1_000;
  return Number.isFinite(seconds) ? `${seconds}.${fraction.padEnd(6, '0')}` : null;
}

function legacyKey(timestamp: string, source: unknown, scope: unknown, pipeline: unknown,
  stage: unknown, property: unknown, status: unknown): string | null {
  const time = transactionTimestamp(timestamp);
  const sourceValue = text(source); const scopeValue = text(scope);
  const pipelineValue = reference(pipeline); const stageValue = reference(stage);
  // JSON history strips null properties recursively. Absence is the canonical
  // representation of a nullable property reference, never of pipeline/stage.
  const propertyValue = property == null ? null : reference(property);
  if (!time || !sourceValue || !scopeValue || !pipelineValue || !stageValue
    || (property != null && !propertyValue) || typeof status !== 'string' || !['open', 'lost', 'won'].includes(status)
    || (scopeValue !== 'unscoped' && !reference(scopeValue.startsWith('queue:') ? scopeValue.slice(6) : null))) return null;
  return JSON.stringify([time, sourceValue, scopeValue, pipelineValue, stageValue, propertyValue, status]);
}

function legacyEntryKey(entry: LeadEntryEventRow, leadId: string): string | null {
  const meta = asMetadata(entry.metadata);
  if (entry.entry_type !== 'reentry' || entry.provider !== 'manual' || entry.lead_id !== leadId
    || meta.origin !== 'vimob_api' || meta.state_preserved !== true || hasEntryIdentity(meta)) return null;
  const scope = text(meta.intake_scope_key);
  if (!scope || (scope === 'unscoped' ? meta.origin_round_robin_id != null : meta.origin_round_robin_id !== scope.slice(6))) return null;
  return legacyKey(entry.created_at, entry.source, scope, entry.pipeline_id, entry.stage_id,
    entry.property_id, asMetadata(meta.new_data).deal_status);
}

function legacyActivityKey(event: UnifiedHistoryEvent): string | null {
  const meta = asMetadata(event.metadata);
  if (event.type !== 'lead_reentry' || event.source !== 'activity' || event.isAutomation
    || meta.entry_type !== 'manual_reentry' || hasEntryIdentity(meta)
    || !text(meta.actor_id) || meta.actor_id !== event.actor?.id) return null;
  return legacyKey(event.timestamp, meta.source, meta.intake_scope_key, meta.pipeline_id,
    meta.stage_id, meta.property_id, meta.deal_status);
}

// Only presentation changes. Activities, timeline and attribution rows remain
// intact in raw history; a detailed activity represents its correlated entry.
export function consolidateReentryProjection(entries: readonly LeadEntryEventRow[],
  representations: readonly UnifiedHistoryEvent[], leadId: string, complete: boolean) {
  const representedIds = new Set<string>();
  const activityIds = new Set<string>();
  for (const event of representations) {
    if (event.type !== 'lead_reentry') continue;
    const entryId = reference(asMetadata(event.metadata).entry_event_id);
    if (!entryId) continue;
    representedIds.add(entryId);
    if (event.source === 'activity') activityIds.add(entryId);
  }
  const events = representations.filter(event => {
    if (event.type !== 'lead_reentry') return true;
    const entryId = reference(asMetadata(event.metadata).entry_event_id);
    // Prefer the detailed activity across sources, without choosing arbitrarily
    // between two distinct audit activities that claim the same durable entry.
    return !entryId || event.source !== 'timeline' || !activityIds.has(entryId);
  });
  const representedEntryIds = new Set(entries.filter(entry => entry.entry_type !== 'initial' && representedIds.has(entry.id)).map(entry => entry.id));
  if (!complete) return { events, representedEntryIds };

  // Older manual Go transactions used now() for both rows but had no event ID.
  // Require the complete producer contract and reciprocal uniqueness. A partial
  // page can hide another candidate, so it never uses this compatibility path.
  const entryGroups = new Map<string, { id: string; count: number }>();
  const activityGroups = new Map<string, number>();
  for (const entry of entries) {
    if (representedEntryIds.has(entry.id)) continue;
    const key = legacyEntryKey(entry, leadId);
    if (!key) continue;
    const group = entryGroups.get(key);
    entryGroups.set(key, { id: entry.id, count: (group?.count ?? 0) + 1 });
  }
  for (const event of events) {
    const key = legacyActivityKey(event);
    if (key) activityGroups.set(key, (activityGroups.get(key) ?? 0) + 1);
  }
  for (const [key, group] of entryGroups) {
    if (group.count === 1 && activityGroups.get(key) === 1) representedEntryIds.add(group.id);
  }
  return { events, representedEntryIds };
}
