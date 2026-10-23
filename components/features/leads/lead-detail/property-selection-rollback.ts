import { compareServerRevisions } from '@/lib/compare-server-revisions';
import type { LeadDetailLead } from './types';

type PropertyDraftFields = { property_id: string; valor_interesse: string; commission_percentage: string };
const draftFields = ['property_id', 'valor_interesse', 'commission_percentage'] as const;
const leadFields = ['property_id', 'interest_property_id', 'property_code', 'property', 'interest_property',
  'valor_interesse', 'commission_percentage'] as const;

/** Replace only fields still owned by this pending property selection. */
export function replaceOwnedPropertyDraft<T extends PropertyDraftFields>(current: T, owned: PropertyDraftFields, next: PropertyDraftFields): T {
  const result = { ...current };
  for (const field of draftFields) if (current[field] === owned[field]) Object.assign(result, { [field]: next[field] });
  return result;
}

export function rollbackLeadPropertySelection(current: LeadDetailLead, previous: LeadDetailLead, owned: Partial<LeadDetailLead>): LeadDetailLead {
  if (current.id !== previous.id || current.organization_id !== previous.organization_id ||
    compareServerRevisions(current.updated_at, previous.updated_at) === 1) return current;
  const result = { ...current };
  for (const field of leadFields) {
    if (current[field] === owned[field]) Object.assign(result, { [field]: previous[field] });
  }
  return result;
}
