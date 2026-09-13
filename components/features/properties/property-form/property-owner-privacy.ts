export const PROPERTY_OWNER_MUTATION_FIELDS = [
  "owner_id",
  "owner_name",
  "owner_phone_residential",
  "owner_phone_commercial",
  "owner_cellphone",
  "owner_email",
  "owner_media_source",
  "owner_notify_email",
] as const;

export function shouldRequirePropertyOwnerDetails(
  isEditing: boolean | undefined,
  canEditOwnerDetails: boolean | undefined,
) {
  return !isEditing || canEditOwnerDetails !== false;
}

export function removePropertyOwnerMutationFields(input: object) {
  const mutableInput = input as Record<string, unknown>;
  for (const field of PROPERTY_OWNER_MUTATION_FIELDS) {
    delete mutableInput[field];
  }
}
