import { compareServerRevisions } from '@/lib/compare-server-revisions';
import { mergeLeadOperationCapability } from '@/lib/lead-operation-capability';

type LeadReadShape = {
  id: string;
  organization_id?: string | null;
  updated_at?: string | null;
  can_operate?: boolean;
  can_progress?: boolean;
  assigned_user_id?: string | null;
  team_id?: string | null;
  stage_id?: string | null;
  property_id?: string | null;
  interest_property_id?: string | null;
  assignee?: unknown;
  stage?: unknown;
  property?: unknown;
  interest_property?: unknown;
  tags?: unknown;
};

/** Merge a canonical mutation response into the same lead's cached read. */
export function mergeLeadServerResponse<T extends LeadReadShape>(current: T | undefined, incoming: T): T {
  if (current && (current.id !== incoming.id || (current.organization_id && incoming.organization_id &&
    current.organization_id !== incoming.organization_id))) return current;
  if (current && compareServerRevisions(current.updated_at, incoming.updated_at) === 1) return current;
  const definedIncoming = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined)) as T;
  const merged = mergeLeadOperationCapability(current, definedIncoming);
  if (!current) return merged;

  for (const [relation, foreignKey] of [
    ['assignee', 'assigned_user_id'], ['stage', 'stage_id'],
    ['property', 'property_id'], ['interest_property', 'interest_property_id'],
  ] as const) {
    if (incoming[relation] !== undefined) continue;
    const nextKey = incoming[foreignKey] !== undefined ? incoming[foreignKey] : current[foreignKey];
    merged[relation] = nextKey && nextKey === current[foreignKey] ? current[relation] : undefined;
  }
  return merged;
}
