import { useCallback } from 'react';
import { publicSiteAPI } from '@/lib/api/public-site';
import { getPublicSiteAttribution } from '@/lib/public-site-attribution';

function getOS(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'other';
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
  leadId?: string;
  metadata?: Record<string, unknown>;
}

export async function trackEvent(params: TrackEventParams) {
  const attribution = getPublicSiteAttribution();
  const sessionId = attribution.session_id;
  const os = getOS();

  const enrichedMetadata = {
    ...(params.metadata || {}),
    os,
	locale: navigator.language,
	timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const payload = {
    session_id: sessionId,
    event_type: params.eventType,
    page_path: params.pagePath || window.location.pathname,
    page_title: params.pageTitle || document.title,
    referrer: document.referrer || null,
    organization_id: params.organizationId,
    property_id: params.propertyId || null,
    lead_id: params.leadId || null,
    metadata: enrichedMetadata,
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    ...getDeviceInfo(),
  };

  try {
    await publicSiteAPI.track(payload);
    return true;
  } catch {
    // Analytics must never interrupt the public site experience.
    return false;
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
