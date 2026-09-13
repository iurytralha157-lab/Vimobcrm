export const PROPERTY_WORKSPACE_CONFLICT_CODE = "property_workspace_conflict";

export const PROPERTY_WORKSPACE_CONFLICT_MESSAGE =
  "Este imóvel foi alterado por outra pessoa. Buscamos a versão mais recente; revise os dados antes de tentar novamente.";

export function isPropertyWorkspaceConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;

  const details = error as { code?: unknown; status?: unknown };
  return (
    details.status === 409 &&
    details.code === PROPERTY_WORKSPACE_CONFLICT_CODE
  );
}

export function propertyConflictQueryKeys(
  organizationId: string | undefined,
  propertyId: string,
) {
  return [
    ["properties"],
    ["properties-infinite"],
    ["property", organizationId, propertyId],
    ["property-history", organizationId, propertyId],
    ["property-workspace", organizationId],
  ] as const;
}
