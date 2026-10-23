/** A client lifecycle guard; server authorization still validates every request. */
export function contactImportScopeKey(organizationId?: string | null, userId?: string | null, sessionId?: string | null) {
  return organizationId && userId && sessionId ? JSON.stringify([organizationId, userId, sessionId]) : null;
}

export function createLeadImportScope() {
  let generation = 0;
  let key: string | null = null;
  let active = false;
  return {
    activate(nextKey: string | null) {
      generation += 1;
      const visit = generation;
      key = nextKey;
      active = true;
      return () => { if (generation === visit) active = false; };
    },
    capture(expectedKey = key) {
      const visit = generation;
      const startingKey = expectedKey;
      return () => active && startingKey !== null && key === startingKey && generation === visit;
    },
  };
}
