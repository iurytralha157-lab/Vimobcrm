export const SITE_ANALYTICS_POLLING_PROFILES = {
  summary: {
    refetchIntervalMs: 60_000,
    staleTimeMs: 30_000,
  },
  detailed: {
    refetchIntervalMs: 5 * 60_000,
    staleTimeMs: 2 * 60_000,
  },
  journeys: {
    refetchIntervalMs: 5 * 60_000,
    staleTimeMs: 2 * 60_000,
  },
} as const;

export type SiteAnalyticsPollingProfile =
  keyof typeof SITE_ANALYTICS_POLLING_PROFILES;

export function getSiteAnalyticsPollingOptions(
  profile: SiteAnalyticsPollingProfile,
) {
  const { refetchIntervalMs, staleTimeMs } =
    SITE_ANALYTICS_POLLING_PROFILES[profile];

  return {
    refetchInterval: (query: { state: { error: unknown } }) =>
      query.state.error ? false : refetchIntervalMs,
    refetchIntervalInBackground: false,
    staleTime: staleTimeMs,
  } as const;
}
