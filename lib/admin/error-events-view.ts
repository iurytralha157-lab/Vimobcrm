export type GroupableErrorEvent = {
  id: string;
  fingerprint: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ErrorEventGroup<
  TEvent extends GroupableErrorEvent = GroupableErrorEvent,
> = {
  fingerprint: string;
  count: number;
  unresolvedCount: number;
  latest: TEvent;
  latestUnresolved?: TEvent;
};

function eventTimestamp(event: GroupableErrorEvent) {
  const timestamp = new Date(event.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function groupErrorEvents<TEvent extends GroupableErrorEvent>(events: readonly TEvent[]) {
  const groups = new Map<string, ErrorEventGroup<TEvent>>();

  for (const event of events) {
    const group = groups.get(event.fingerprint);
    const isUnresolved = !event.resolvedAt;

    if (!group) {
      groups.set(event.fingerprint, {
        fingerprint: event.fingerprint,
        count: 1,
        unresolvedCount: isUnresolved ? 1 : 0,
        latest: event,
        latestUnresolved: isUnresolved ? event : undefined,
      });
      continue;
    }

    group.count += 1;
    if (isUnresolved) {
      group.unresolvedCount += 1;
      if (
        !group.latestUnresolved ||
        eventTimestamp(event) > eventTimestamp(group.latestUnresolved)
      ) {
        group.latestUnresolved = event;
      }
    }
    if (eventTimestamp(event) > eventTimestamp(group.latest)) {
      group.latest = event;
    }
  }

  return Array.from(groups.values()).sort(
    (left, right) => eventTimestamp(right.latest) - eventTimestamp(left.latest),
  );
}

export function getSafeErrorEventUrl(value?: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function getErrorEventsPageCount(total: number, pageSize: number) {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampErrorEventsPage(page: number, total: number, pageSize: number) {
  const totalPages = getErrorEventsPageCount(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(totalPages, Math.max(1, Math.trunc(page)));
}

export function getErrorEventsPageRange({
  page,
  pageSize,
  total,
  visibleCount,
}: {
  page: number;
  pageSize: number;
  total: number;
  visibleCount: number;
}) {
  if (total <= 0 || visibleCount <= 0) return { from: 0, to: 0 };

  const normalizedPage = clampErrorEventsPage(page, total, pageSize);
  const from = (normalizedPage - 1) * pageSize + 1;
  return {
    from,
    to: Math.min(total, from + visibleCount - 1),
  };
}
