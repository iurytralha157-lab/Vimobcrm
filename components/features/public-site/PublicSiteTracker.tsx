"use client";

import { useEffect } from "react";

import { trackEvent } from "@/hooks/useTracking";

export function PublicSiteTracker({
  organizationId,
  pageTitle,
  propertyId,
}: Readonly<{
  organizationId: string;
  pageTitle: string;
  propertyId?: string;
}>) {
  useEffect(() => {
    const startedAt = Date.now();
    let durationRecorded = false;
    void trackEvent({ organizationId, eventType: "pageview", pageTitle, propertyId });

    const query = Object.fromEntries(new URLSearchParams(window.location.search));
    const searchKeys = ["search", "cidade", "bairro", "tipo", "finalidade", "min_price", "max_price", "quartos", "suites", "banheiros", "vagas"];
    if (searchKeys.some((key) => query[key])) {
      void trackEvent({
        organizationId,
        eventType: "property_search",
        pageTitle,
        metadata: { filters: query, search_term: query.search || null },
      });
    }

    const sessionMarker = `vimob_session_started:${organizationId}`;
    if (!window.sessionStorage.getItem(sessionMarker)) {
      window.sessionStorage.setItem(sessionMarker, "1");
      void trackEvent({ organizationId, eventType: "session_start", pageTitle, propertyId });
    }

    const recordDuration = () => {
	  if (durationRecorded) return;
	  durationRecorded = true;
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      void trackEvent({
        organizationId,
        eventType: "page_duration",
        pageTitle,
        propertyId,
        metadata: { duration_seconds: durationSeconds },
      });
    };
    window.addEventListener("pagehide", recordDuration);
    return () => {
	  window.removeEventListener("pagehide", recordDuration);
	  recordDuration();
	};
  }, [organizationId, pageTitle, propertyId]);

  return null;
}
