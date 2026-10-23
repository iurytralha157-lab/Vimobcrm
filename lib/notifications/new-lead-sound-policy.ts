import type { Notification } from '@/lib/api/notifications';

export interface NewLeadSoundScope {
  organizationId: string;
  userId: string;
}

// The existing reconciliation polls every minute. Keep that fallback eligible,
// while excluding an old backlog after a long disconnect.
const MAX_NOTIFICATION_AGE_MS = 90_000;
const CLOCK_SKEW_MS = 5_000;

export function createNewLeadSoundGate(scope: NewLeadSoundScope, subscribedAt: number) {
  let initialized = false;
  const seen = new Map<string, number>();

  return (latestPage: readonly Notification[], now: number): Notification[] => {
    for (const [id, observedAt] of seen) {
      if (now - observedAt > MAX_NOTIFICATION_AGE_MS * 2) seen.delete(id);
    }
    const candidates: Notification[] = [];
    for (const notification of latestPage) {
      const known = seen.has(notification.id);
      seen.set(notification.id, now);
      if (!initialized || known) continue;
      const createdAt = Date.parse(notification.created_at);
      if (notification.user_id !== scope.userId || notification.organization_id !== scope.organizationId
        || notification.is_read || notification.metadata?.event_key !== 'new_lead_received'
        || !notification.lead_id || !Number.isFinite(createdAt)
        || createdAt < subscribedAt - CLOCK_SKEW_MS
        || createdAt < now - MAX_NOTIFICATION_AGE_MS || createdAt > now + CLOCK_SKEW_MS) continue;
      candidates.push(notification);
    }
    initialized = true;
    return candidates;
  };
}
