const UNATTRIBUTED_META_ENTITY_ID = "unattributed";

type MetaDashboardEntity = {
  id: string;
};

export function selectAttributedMetaEntities<T extends MetaDashboardEntity>(
  entities: readonly T[],
): T[] {
  return entities.filter((entity) => {
    const entityId = entity.id.trim().toLowerCase();
    return entityId !== "" && entityId !== UNATTRIBUTED_META_ENTITY_ID;
  });
}
