import { mergePreservingDefinedFields } from '@/lib/merge-preserving-defined';
import { compareServerRevisions } from '@/lib/compare-server-revisions';
import type { LeadDetailLead } from './types';

export function hydrateLeadDetail(snapshot: LeadDetailLead, incoming: LeadDetailLead): LeadDetailLead {
  return {
    ...mergePreservingDefinedFields(snapshot, incoming, [
      'initial_message', 'last_contact_at', 'next_follow_up_at', 'priority', 'status',
    ]),
    assignee: incoming.assignee !== undefined ? incoming.assignee : (
      incoming.assigned_user_id && incoming.assigned_user_id === snapshot.assigned_user_id
        ? snapshot.assignee : null
    ),
    interest_property: incoming.interest_property !== undefined ? incoming.interest_property : (
      incoming.interest_property_id && incoming.interest_property_id === snapshot.interest_property_id
        ? snapshot.interest_property : null
    ),
    property: incoming.property !== undefined ? incoming.property : (
      incoming.property_id && incoming.property_id === snapshot.property_id ? snapshot.property : null
    ),
    stage: incoming.stage !== undefined ? incoming.stage : (
      incoming.stage_id && incoming.stage_id === snapshot.stage_id ? snapshot.stage : null
    ),
    tags: incoming.tags !== undefined ? incoming.tags : snapshot.tags,
    tasks_count: incoming.tasks_count ?? snapshot.tasks_count,
    whatsapp_avatar_url: incoming.whatsapp_avatar_url !== undefined
      ? incoming.whatsapp_avatar_url : snapshot.whatsapp_avatar_url,
  };
}

/** Mutations must not replace a newer realtime/GET revision of the same lead. */
export function mergeLeadDetailMutation(snapshot: LeadDetailLead, incoming: LeadDetailLead): LeadDetailLead {
  if (snapshot.id !== incoming.id || (snapshot.organization_id && incoming.organization_id &&
    snapshot.organization_id !== incoming.organization_id)) return snapshot;
  if (compareServerRevisions(snapshot.updated_at, incoming.updated_at) === 1) return snapshot;
  return hydrateLeadDetail(snapshot, incoming);
}
