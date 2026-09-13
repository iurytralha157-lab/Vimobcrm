import type { QueryClient } from "@tanstack/react-query";

/**
 * Reset the offset-based event pages before refreshing dashboard aggregates.
 * A mutation can otherwise leave later pages anchored to stale row positions.
 */
export function invalidateScheduleDashboardCaches(queryClient: QueryClient) {
  void queryClient.resetQueries({
    queryKey: ["schedule-dashboard", "events"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["schedule-dashboard"],
    predicate: (query) => query.queryKey[1] !== "events",
  });
}
