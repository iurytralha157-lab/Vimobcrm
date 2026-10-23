import type { QueryClient } from "@tanstack/react-query";
import { refreshScheduleQueries } from "./schedule-query-refresh";

/**
 * Reset the offset-based event pages before refreshing dashboard aggregates.
 * A mutation can otherwise leave later pages anchored to stale row positions.
 */
export function invalidateScheduleDashboardCaches(queryClient: QueryClient) {
  void queryClient.resetQueries({
    queryKey: ["schedule-dashboard", "events"],
  });
  void refreshScheduleQueries(queryClient, {
    queryKey: ["schedule-dashboard"],
    predicate: (query) => query.queryKey[1] !== "events",
  });
}
