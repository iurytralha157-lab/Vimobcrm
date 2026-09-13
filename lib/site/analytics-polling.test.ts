import assert from "node:assert/strict";
import test from "node:test";

import {
  SITE_ANALYTICS_POLLING_PROFILES,
  getSiteAnalyticsPollingOptions,
} from "./analytics-polling";

const healthyQuery = { state: { error: null } };
const failedQuery = { state: { error: new Error("offline") } };

test("summary refreshes more often than detailed analytics", () => {
  const summary = getSiteAnalyticsPollingOptions("summary");
  const detailed = getSiteAnalyticsPollingOptions("detailed");

  assert.equal(summary.refetchInterval(healthyQuery), 60_000);
  assert.equal(detailed.refetchInterval(healthyQuery), 300_000);
  assert.ok(
    SITE_ANALYTICS_POLLING_PROFILES.summary.refetchIntervalMs <
      SITE_ANALYTICS_POLLING_PROFILES.detailed.refetchIntervalMs,
  );
});

test("periodic refresh pauses after errors and never runs in background", () => {
  for (const profile of ["summary", "detailed", "journeys"] as const) {
    const options = getSiteAnalyticsPollingOptions(profile);
    assert.equal(options.refetchInterval(failedQuery), false);
    assert.equal(options.refetchIntervalInBackground, false);
  }
});

test("journey profile uses the slower mounted-panel cadence", () => {
  const journeys = getSiteAnalyticsPollingOptions("journeys");

  assert.equal(journeys.refetchInterval(healthyQuery), 300_000);
  assert.equal(journeys.staleTime, 120_000);
});
