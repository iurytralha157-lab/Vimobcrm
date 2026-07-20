import { createClientId } from '@/lib/client-id';

const SESSION_KEY = 'vimob_session_id';
const ATTRIBUTION_KEY = 'vimob_site_attribution';

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

export function getPublicSiteAttribution(): PublicSiteAttribution {
  const sessionId = getOrCreateSessionId();
  const current = currentAttribution(sessionId);
  const stored = readStoredAttribution();
  const attribution = stored?.session_id === sessionId
    ? mergeAttribution(stored, current)
    : current;
  window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
  return attribution;
}

export function createPublicSubmissionId() {
  return createClientId('submission');
}

function getOrCreateSessionId() {
  let value = window.localStorage.getItem(SESSION_KEY);
  if (!value) {
    value = createClientId('session');
    window.localStorage.setItem(SESSION_KEY, value);
  }
  return value;
}

function currentAttribution(sessionId: string): PublicSiteAttribution {
  const params = new URLSearchParams(window.location.search);
  return {
    session_id: sessionId,
    landing_page: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer || null,
    utm_source: clean(params.get('utm_source')),
    utm_medium: clean(params.get('utm_medium')),
    utm_campaign: clean(params.get('utm_campaign')),
    utm_term: clean(params.get('utm_term')),
    utm_content: clean(params.get('utm_content')),
    gclid: clean(params.get('gclid')),
    fbclid: clean(params.get('fbclid')),
  };
}

function mergeAttribution(first: PublicSiteAttribution, current: PublicSiteAttribution) {
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

function readStoredAttribution(): PublicSiteAttribution | null {
  try {
    const raw = window.sessionStorage.getItem(ATTRIBUTION_KEY);
    return raw ? JSON.parse(raw) as PublicSiteAttribution : null;
  } catch {
    return null;
  }
}

function clean(value: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 300) : null;
}
