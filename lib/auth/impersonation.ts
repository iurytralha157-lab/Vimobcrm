export type ImpersonationSession = {
  orgId: string;
  orgName: string;
};

/** Browser storage is untrusted input: a damaged value must not stop the app. */
export function parseImpersonationSession(stored: string | null): ImpersonationSession | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;
    const { orgId, orgName } = parsed as Record<string, unknown>;
    return typeof orgId === 'string' && orgId && typeof orgName === 'string' ? { orgId, orgName } : null;
  } catch {
    return null;
  }
}
