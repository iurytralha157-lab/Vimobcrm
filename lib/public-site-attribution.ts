import { createClientId } from "@/lib/client-id";
import {
  getPublicAttributionKey,
  sanitizePublicReferrer,
} from "@/lib/site/public-attribution";
import {
  hasPublicSiteSessionStarted as hasStoredPublicSiteSessionStarted,
  markPublicSiteSessionStarted as markStoredPublicSiteSessionStarted,
  resolvePublicSiteSessionId,
} from "@/lib/site/public-session";

const inMemorySessionIds = new Map<string, string>();
const inMemorySessionStorage = {
  getItem(key: string) {
    return inMemorySessionIds.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    inMemorySessionIds.set(key, value);
  },
};

export type PublicSiteAttribution = {
  session_id: string;
  landing_page: string;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
};

export function getPublicSiteAttribution(
  organizationId: string,
  options: Readonly<{ recordActivity?: boolean }> = {},
): PublicSiteAttribution {
  const sessionId = getOrCreatePublicSiteSessionId(organizationId, options);
  if (!sessionId) {
    throw new Error("Public site attribution is only available in the browser");
  }
  const current = currentAttribution(sessionId);
  const stored = readStoredAttribution(organizationId);
  const attribution =
    stored?.session_id === sessionId
      ? mergeAttribution(stored, current)
      : current;
  writeStoredAttribution(organizationId, attribution);
  return attribution;
}

export function createPublicSubmissionId() {
  return createClientId("submission");
}

export function getOrCreatePublicSiteSessionId(
  organizationId: string,
  options: Readonly<{ recordActivity?: boolean }> = {},
) {
  if (typeof window === "undefined") return null;

  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }

  try {
    return resolvePublicSiteSessionId(
      window.sessionStorage,
      normalizedOrganizationId,
      () => createClientId("session"),
      options,
    );
  } catch {
    // Some privacy modes can deny Web Storage. Keep the visit stable in
    // memory while retaining the same inactivity semantics.
    return resolvePublicSiteSessionId(
      inMemorySessionStorage,
      normalizedOrganizationId,
      () => createClientId("session"),
      options,
    );
  }
}

export function hasPublicSiteSessionStarted(
  organizationId: string,
  sessionId: string,
) {
  if (typeof window === "undefined") return false;

  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }

  try {
    if (
      hasStoredPublicSiteSessionStarted(
        window.sessionStorage,
        normalizedOrganizationId,
        sessionId,
      )
    ) {
      return true;
    }
  } catch {
    // Fall through to the in-memory marker used when Web Storage writes are
    // unavailable or only partially supported.
  }
  try {
    return hasStoredPublicSiteSessionStarted(
      inMemorySessionStorage,
      normalizedOrganizationId,
      sessionId,
    );
  } catch {
    return false;
  }
}

export function markPublicSiteSessionStarted(
  organizationId: string,
  sessionId: string,
) {
  if (typeof window === "undefined") return false;

  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }

  try {
    return markStoredPublicSiteSessionStarted(
      window.sessionStorage,
      normalizedOrganizationId,
      sessionId,
    );
  } catch {
    return markStoredPublicSiteSessionStarted(
      inMemorySessionStorage,
      normalizedOrganizationId,
      sessionId,
    );
  }
}

function currentAttribution(sessionId: string): PublicSiteAttribution {
  const params = new URLSearchParams(window.location.search);
  return {
    session_id: sessionId,
    landing_page: window.location.pathname || "/",
    referrer: sanitizePublicReferrer(document.referrer),
    utm_source: clean(params.get("utm_source")),
    utm_medium: clean(params.get("utm_medium")),
    utm_campaign: clean(params.get("utm_campaign")),
    utm_term: clean(params.get("utm_term")),
    utm_content: clean(params.get("utm_content")),
    gclid: clean(params.get("gclid")),
    fbclid: clean(params.get("fbclid")),
  };
}

function mergeAttribution(
  first: PublicSiteAttribution,
  current: PublicSiteAttribution,
) {
  return {
    ...first,
    utm_source: current.utm_source || first.utm_source,
    utm_medium: current.utm_medium || first.utm_medium,
    utm_campaign: current.utm_campaign || first.utm_campaign,
    utm_term: current.utm_term || first.utm_term,
    utm_content: current.utm_content || first.utm_content,
    gclid: current.gclid || first.gclid,
    fbclid: current.fbclid || first.fbclid,
  };
}

function readStoredAttribution(
  organizationId: string,
): PublicSiteAttribution | null {
  try {
    const raw = window.sessionStorage.getItem(
      getPublicAttributionKey(organizationId),
    );
    return raw ? (JSON.parse(raw) as PublicSiteAttribution) : null;
  } catch {
    return null;
  }
}

function writeStoredAttribution(
  organizationId: string,
  attribution: PublicSiteAttribution,
) {
  try {
    window.sessionStorage.setItem(
      getPublicAttributionKey(organizationId),
      JSON.stringify(attribution),
    );
  } catch {
    // Attribution is best effort. Storage restrictions must never block a
    // public lead form or analytics event.
  }
}

export {
  getPublicAttributionKey,
  sanitizePublicReferrer,
} from "@/lib/site/public-attribution";

function clean(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 300) : null;
}
