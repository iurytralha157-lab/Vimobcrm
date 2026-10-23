import type { QueryClient } from '@tanstack/react-query';

type AccessVisit = { active: boolean };
const visits = new WeakMap<QueryClient, AccessVisit>();

/** Cache ownership follows the provider's access, not a popup's lifetime. */
export function activateQueryClientAccess(client: QueryClient) {
  const visit = { active: true };
  visits.set(client, visit);
  return () => { visit.active = false; };
}

export function captureQueryClientAccess(client: QueryClient): () => boolean {
  const visit = visits.get(client);
  // Standalone clients retain their existing contract. Once a provider has
  // owned one, an expired visit must never become an unregistered client again.
  return visit
    ? () => visit.active && visits.get(client) === visit
    : () => !visits.has(client);
}
