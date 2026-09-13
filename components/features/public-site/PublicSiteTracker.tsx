"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { trackEvent } from "@/hooks/useTracking";
import { createEngagementDurationTracker } from "@/lib/site/engagement-duration";
import {
  PUBLIC_TRACKING_HEARTBEAT_MS,
  pickPublicSiteSearchFilters,
} from "@/lib/site/public-tracking";

export function PublicSiteTracker({
  organizationId,
  pageTitle,
  propertyId,
}: Readonly<{
  organizationId: string;
  pageTitle: string;
  propertyId?: string;
}>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serializedSearchParams = searchParams.toString();

  useEffect(() => {
    const durationTracker = createEngagementDurationTracker(
      document.visibilityState !== "hidden",
    );
    void trackEvent({
      organizationId,
      eventType: "pageview",
      pagePath: pathname,
      pageTitle,
      propertyId,
    });

    const filters = pickPublicSiteSearchFilters(serializedSearchParams);
    if (Object.keys(filters).length > 0) {
      void trackEvent({
        organizationId,
        eventType: "property_search",
        pagePath: pathname,
        pageTitle,
        metadata: { filters },
      });
    }

    const recordDuration = (pause = false) => {
      const durationSeconds = pause
        ? durationTracker.pause()
        : durationTracker.flush();
      if (durationSeconds < 1) return;
      void trackEvent({
        organizationId,
        eventType: "page_duration",
        pagePath: pathname,
        pageTitle,
        propertyId,
        metadata: { duration_seconds: durationSeconds },
      });
    };
    const heartbeat = window.setInterval(
      () => recordDuration(),
      PUBLIC_TRACKING_HEARTBEAT_MS,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        recordDuration(true);
        return;
      }
      durationTracker.resume();
    };
    const handlePageHide = () => recordDuration(true);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      recordDuration(true);
    };
  }, [organizationId, pageTitle, pathname, propertyId, serializedSearchParams]);

  return null;
}
