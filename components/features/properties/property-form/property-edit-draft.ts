import { z } from 'zod';
import { initialFormData, type PropertyFormData } from '@/components/features/properties/property-form/property-form-model';
import { rebasePropertyFormMedia } from '@/components/features/properties/property-form/property-form-hydration';
import { withoutEphemeralPropertyMedia } from '@/lib/property-media-draft';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PropertyEditDraftScope = {
  actorId: string;
  organizationId: string;
  propertyId: string;
  accessSignature: string;
};
const formShape = Object.fromEntries(Object.entries(initialFormData).map(([key, value]) => [
  key, typeof value === 'boolean' ? z.boolean() : Array.isArray(value) ? z.array(z.string()) : z.string(),
]));
const formSchema = z.object(formShape).strict();
const editDraftSchema = z.object({
  actorId: z.string().min(1), organizationId: z.string().min(1), propertyId: z.string().min(1),
  accessSignature: z.string().min(1), expectedUpdatedAt: z.string().min(1),
  formData: z.custom<PropertyFormData>(value => formSchema.safeParse(value).success),
});
const capturedCapabilitiesSchema = z.object({ canManage: z.boolean(), canEditOwnerDetails: z.boolean() });

export function getPropertyEditDraftStorage(): DraftStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export function hasPropertyEditDraft(storage: DraftStorage | null, key: string | null) {
  try { return Boolean(storage && key && storage.getItem(key)); } catch { return false; }
}

export function propertyEditDraftKey(organizationId?: string | null, actorId?: string | null, propertyId?: string | null) {
  return organizationId && actorId && propertyId
    ? `property-edit-draft:${organizationId}:${actorId}:${propertyId}`
    : null;
}

/** Changes outside property authorization must not discard an otherwise permitted edit. */
export function propertyEditDraftAccessSignature(input: {
  permissions?: readonly string[] | null;
  moduleEnabled: boolean;
  canEdit: boolean;
  canManage: boolean;
  canAssign: boolean;
  canEditOwnerDetails: boolean;
  editPolicy?: string | null;
  ownerContactVisibility?: string | null;
}) {
  return JSON.stringify({
    ...input,
    permissions: [...(input.permissions ?? [])].filter(permission => permission === '*' || permission.startsWith('property_')).sort(),
  });
}

export function clearPropertyEditDraft(storage: DraftStorage | null, key: string | null) {
  if (!storage || !key) return;
  try { storage.removeItem(key); } catch { /* Storage must not prevent an explicit save/discard. */ }
}

export function savePropertyEditDraft(storage: DraftStorage | null, key: string, scope: PropertyEditDraftScope, expectedUpdatedAt: string, formData: PropertyFormData) {
  if (!storage || key !== propertyEditDraftKey(scope.organizationId, scope.actorId, scope.propertyId)) return false;
  try {
    const record = editDraftSchema.parse({ ...scope, expectedUpdatedAt, formData: withoutEphemeralPropertyMedia(formData) });
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch { return false; }
}

/** Called only after a fresh scoped property read has resolved authorization. */
export function recoverPropertyEditDraft(
  storage: DraftStorage | null,
  key: string,
  scope: PropertyEditDraftScope,
  server: { canEdit: boolean; canManage: boolean; canEditOwnerDetails: boolean; updatedAt: string; formData: PropertyFormData },
) {
  if (!storage || key !== propertyEditDraftKey(scope.organizationId, scope.actorId, scope.propertyId)) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = editDraftSchema.parse(JSON.parse(raw));
    const captured = capturedCapabilitiesSchema.parse(JSON.parse(record.accessSignature));
    if (!server.canEdit || record.actorId !== scope.actorId || record.organizationId !== scope.organizationId
      || record.propertyId !== scope.propertyId || record.accessSignature !== scope.accessSignature
      || (captured.canManage && !server.canManage) || (captured.canEditOwnerDetails && !server.canEditOwnerDetails)) {
      clearPropertyEditDraft(storage, key);
      return null;
    }
    return {
      formData: rebasePropertyFormMedia(record.formData, server.formData),
      expectedUpdatedAt: record.expectedUpdatedAt,
      hasConflict: record.expectedUpdatedAt !== server.updatedAt,
    };
  } catch {
    clearPropertyEditDraft(storage, key);
    return null;
  }
}
