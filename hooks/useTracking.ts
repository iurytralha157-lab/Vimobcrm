import { useCallback } from 'react';
import { publicSiteAPI } from '@/lib/api/public-site';

function getSessionId(): string {
  let id = localStorage.getItem('vimob_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('vimob_session_id', id);
  }
  return id;
}

function getUTMs() {
  const p = new URLSearchParams(window.location.search);
  return {
    utm_source: p.get('utm_source') || null,
    utm_medium: p.get('utm_medium') || null,
    utm_campaign: p.get('utm_campaign') || null,
  };
}

function getOS(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'other';
}

let cachedGeo: { city?: string; region?: string; lat?: number; lng?: number } | null = null;

async function getGeoInfo(): Promise<{ city?: string; region?: string; lat?: number; lng?: number }> {
  if (cachedGeo) return cachedGeo;
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      cachedGeo = {
        city: data.city || undefined,
        region: data.region || undefined,
        lat: data.latitude || undefined,
        lng: data.longitude || undefined,
      };
      return cachedGeo;
    }
  } catch {
    // Silently fail - geo is optional
  }
  cachedGeo = {};
  return cachedGeo;
}

function getDeviceInfo() {
  const width = window.innerWidth;
  let deviceType = 'desktop';
  if (width <= 768) deviceType = 'mobile';
  else if (width <= 1024) deviceType = 'tablet';

  const ua = navigator.userAgent;
  let browser = 'other';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'chrome';
  else if (ua.includes('Firefox')) browser = 'firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'safari';
  else if (ua.includes('Edg')) browser = 'edge';

  return {
    device_type: deviceType,
    browser,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
  };
}

export interface TrackEventParams {
  organizationId: string;
  eventType: string;
  pagePath?: string;
  pageTitle?: string;
  propertyId?: string;
  metadata?: Record<string, unknown>;
}

export async function trackEvent(params: TrackEventParams) {
  const sessionId = getSessionId();
  const os = getOS();
  const geo = await getGeoInfo();

  const enrichedMetadata = {
    ...(params.metadata || {}),
    os,
    ...(geo.city ? { city: geo.city } : {}),
    ...(geo.region ? { region: geo.region } : {}),
    ...(geo.lat ? { lat: geo.lat } : {}),
    ...(geo.lng ? { lng: geo.lng } : {}),
  };

  const payload = {
    session_id: sessionId,
    event_type: params.eventType,
    page_path: params.pagePath || window.location.pathname,
    page_title: params.pageTitle || document.title,
    referrer: document.referrer || null,
    organization_id: params.organizationId,
    property_id: params.propertyId || null,
    metadata: enrichedMetadata,
    ...getUTMs(),
    ...getDeviceInfo(),
  };

  console.log('[Tracking] Sending event:', params.eventType, 'org:', params.organizationId, 'path:', payload.page_path);

  try {
    await publicSiteAPI.track(payload);
    console.log('[Tracking] Event recorded successfully:', params.eventType);
  } catch (e) {
    console.error('[Tracking] Failed:', e);
  }
}

// Convenience functions
export async function trackPageView(params: {
  organizationId: string;
  pagePath: string;
  pageTitle?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  propertyId?: string;
}) {
  await trackEvent({
    organizationId: params.organizationId,
    eventType: 'pageview',
    pagePath: params.pagePath,
    pageTitle: params.pageTitle,
    propertyId: params.propertyId,
  });
}

export async function trackFavorite(organizationId: string, propertyId: string) {
  await trackEvent({
    organizationId,
    eventType: 'favorite',
    propertyId,
  });
}

export async function trackConversion(organizationId: string) {
  await trackEvent({
    organizationId,
    eventType: 'form_submit',
  });
}

export async function trackWhatsAppClick(organizationId: string, metadata?: Record<string, unknown>) {
  await trackEvent({
    organizationId,
    eventType: 'whatsapp_click',
    metadata,
  });
}

export async function trackCtaClick(organizationId: string, metadata?: Record<string, unknown>) {
  await trackEvent({
    organizationId,
    eventType: 'cta_click',
    metadata,
  });
}

// Hook for use in components
export function useTracking(organizationId?: string) {
  const track = useCallback(
    async (eventType: string, metadata?: Record<string, unknown>, propertyId?: string) => {
      if (!organizationId) return;
      await trackEvent({
        organizationId,
        eventType,
        propertyId,
        metadata,
      });
    },
    [organizationId]
  );

  return { track };
}
