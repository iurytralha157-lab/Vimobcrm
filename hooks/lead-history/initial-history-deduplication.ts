import { compareServerRevisions } from '@/lib/compare-server-revisions';
import { asMetadata } from './metadata';
import type { ActivityEventRow, HistoryMetadata, LeadHistoryRaw, TimelineEventRow } from './types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => typeof value === 'string' && value.trim() && value.trim() === value ? value : null;
const reference = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : null;
const exact = (left?: string | null, right?: string | null) => compareServerRevisions(left, right) === 0;
const source = (value: unknown) => {
  const normalized = text(value)?.toLowerCase();
  return normalized === 'meta_ads' ? 'meta' : normalized;
};
const identityKeys = ['distribution_event_id', 'entry_event_id', 'leadgen_id', 'operation_id', 'request_id',
  'lead_id', 'organization_id', 'form_id', 'page_id', 'integration_id', 'source_session_id', 'source_webhook_id'];

function compatibleMetadata(...records: HistoryMetadata[]) {
  return identityKeys.every(key => {
    const values = records.filter(record => Object.hasOwn(record, key)).map(record => text(record[key]));
    return values.every(Boolean) && new Set(values).size <= 1;
  });
}

function sameReference(record: HistoryMetadata, keys: string[]) {
  const values = keys.filter(key => Object.hasOwn(record, key)).map(key => reference(record[key]));
  return values.length > 0 && values.every(Boolean) && new Set(values).size === 1 ? values[0] : null;
}

function explicitCreationIdentity(activity: ActivityEventRow, timeline: TimelineEventRow) {
  const a = asMetadata(activity.metadata), b = asMetadata(timeline.metadata);
  if (!compatibleMetadata(a, b) || (source(a.source) && source(b.source) && source(a.source) !== source(b.source))
    || (activity.user_id && (timeline.actor_user_id || timeline.user_id)
      && activity.user_id !== (timeline.actor_user_id || timeline.user_id))) return false;
  if ((Object.hasOwn(a, 'timeline_event_id') && a.timeline_event_id !== timeline.id)
    || (Object.hasOwn(b, 'activity_id') && b.activity_id !== activity.id)) return false;
  return a.timeline_event_id === timeline.id || b.activity_id === activity.id
    || ['distribution_event_id', 'entry_event_id', 'operation_id', 'request_id', 'leadgen_id']
      .some(key => text(a[key]) && a[key] === b[key]);
}

/** Presentation-only correlation of the immutable initial transaction. Provider
 * event_at remains the display timestamp; created_at proves the persisted pair.
 * A missing/ambiguous bridge keeps every independent record visible. */
export function initialHistoryRepresentations(raw: LeadHistoryRaw, leadId: string) {
  const creationActivityIds = new Set<string>();
  const initialAssignmentLogIds = new Set<string>();
  const representedAssignmentLogIds = new Set<string>();
  const result = { creationActivityIds, initialAssignmentLogIds, representedAssignmentLogIds };
  for (const activity of raw.activityEvents || []) {
    if (activity.type === 'lead_created' && (raw.timelineEvents || []).some(timeline =>
      timeline.event_type === 'lead_created' && explicitCreationIdentity(activity, timeline))) creationActivityIds.add(activity.id);
  }
  const lead = raw.lead;
  if (!lead || lead.id !== leadId || !exact(lead.created_at, lead.created_at)) return result;
  const createdAt = lead.created_at;

  const entries = (raw.entryEvents || []).filter(entry => entry.entry_type === 'initial'
    && entry.lead_id === leadId && exact(entry.created_at, createdAt));
  const activities = (raw.activityEvents || []).filter(event => event.type === 'lead_created' && exact(event.created_at, createdAt));
  const timelines = (raw.timelineEvents || []).filter(event => event.event_type === 'lead_created' && exact(event.created_at, createdAt));
  if (entries.length === 1 && activities.length === 1 && timelines.length === 1) {
    const [entry] = entries, [activity] = activities, [timeline] = timelines;
    const entryMeta = asMetadata(entry.metadata), activityMeta = asMetadata(activity.metadata), timelineMeta = asMetadata(timeline.metadata);
    const expectedSource = source(entry.source);
    const timelineActor = timeline.actor_user_id || timeline.user_id;
    const explicitReferencesMatch = (!Object.hasOwn(activityMeta, 'timeline_event_id') || activityMeta.timeline_event_id === timeline.id)
      && (!Object.hasOwn(timelineMeta, 'activity_id') || timelineMeta.activity_id === activity.id)
      && [activityMeta, timelineMeta, entryMeta].every(meta => !Object.hasOwn(meta, 'entry_event_id') || meta.entry_event_id === entry.id)
      && [activityMeta, timelineMeta].every(meta => !Object.hasOwn(meta, 'entry_type') || meta.entry_type === 'initial');
    if (expectedSource && source(lead.source) === expectedSource && source(activityMeta.source) === expectedSource
      && source(timelineMeta.source) === expectedSource && compatibleMetadata(entryMeta, activityMeta, timelineMeta)
      && explicitReferencesMatch && !(activity.user_id && timelineActor && activity.user_id !== timelineActor)) {
      creationActivityIds.add(activity.id);
    }
  }

  if (!lead.assigned_user_id || !exact(lead.assigned_at, createdAt)) return result;
  const candidates = (raw.assignmentLogs || []).filter(log => log.reason === 'canonical_round_robin'
    && !log.old_user_id && log.new_user_id === lead.assigned_user_id);
  for (const log of candidates) initialAssignmentLogIds.add(log.id);
  const assignments = candidates.filter(log => exact(log.created_at, createdAt));
  if (assignments.length !== 1) return result;
  const timelineAssignments = (raw.timelineEvents || []).filter(event => event.event_type === 'lead_assigned'
    && exact(event.created_at, createdAt));
  const distributions = (raw.distributionLogs || []).filter(log => log.reason === 'canonical_round_robin'
    && log.assigned_user_id === lead.assigned_user_id && exact(log.created_at, createdAt));
  if (timelineAssignments.length !== 1 || distributions.length !== 1) return result;
  const [timeline] = timelineAssignments, [distribution] = distributions, [assignment] = assignments;
  const timelineMeta = asMetadata(timeline.metadata), distributionMeta = asMetadata(distribution.metadata);
  const distributionEventId = reference(timelineMeta.distribution_event_id);
  const queueId = sameReference(timelineMeta, ['queue_id', 'distribution_queue_id']);
  const targetId = sameReference(timelineMeta, ['assigned_user_id', 'to_user_id']);
  const initialMetadata = [timelineMeta, distributionMeta].every(meta =>
    (!Object.hasOwn(meta, 'is_initial_distribution') || meta.is_initial_distribution === true)
    && !text(meta.previous_user_id) && !text(meta.from_user_id));
  if (distributionEventId && distributionEventId === reference(distributionMeta.distribution_event_id)
    && queueId && queueId === distribution.round_robin_id && targetId === lead.assigned_user_id
    && (!assignment.round_robin_id || assignment.round_robin_id === queueId)
    && initialMetadata && compatibleMetadata(timelineMeta, distributionMeta)) representedAssignmentLogIds.add(assignment.id);
  return result;
}
