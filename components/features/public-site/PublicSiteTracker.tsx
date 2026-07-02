"use client";

import { useEffect } from "react";

import { createClientId } from "@/lib/client-id";
import { publicSiteAPI } from "@/lib/api/public-site";

function getSessionId() {
  const key = "vimob_session_id";
  let sessionId = window.localStorage.getItem(key);

  if (!sessionId) {
    sessionId = createClientId("session");
    window.localStorage.setItem(key, sessionId);
  }

  return sessionId;
}

function getDeviceType() {
  if (window.innerWidth <= 768) return "mobile";
  if (window.innerWidth <= 1024) return "tablet";
  return "desktop";
}

function getBrowserName() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg")) return "edge";
  if (ua.includes("Chrome")) return "chrome";
  if (ua.includes("Firefox")) return "firefox";
  if (ua.includes("Safari")) return "safari";
  return "other";
}

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
    const params = new URLSearchParams(window.location.search);

    void publicSiteAPI.track({
      organization_id: organizationId,
      event_type: "pageview",
      page_path: window.location.pathname,
      page_title: pageTitle,
      referrer: document.referrer || null,
      session_id: getSessionId(),
      property_id: propertyId || null,
      device_type: getDeviceType(),
      browser: getBrowserName(),
      screen_width: window.screen.width,
      screen_height: window.screen.height,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
    }).catch(() => {
      // Tracking is useful, but it should never interrupt the public site.
    });
  }, [organizationId, pageTitle, propertyId]);

  return null;
}
