// This file now re-exports from the new tracking modules for backward compatibility
export { trackPageView, trackFavorite, trackConversion, trackEvent, trackWhatsAppClick, trackCtaClick, useTracking } from './useTracking';
export { useSiteAnalytics, useSiteAnalyticsDetailed, useLeadAnalytics } from './use-lead-analytics';
export type { SiteAnalyticsSummary, SiteAnalyticsDetailed, LeadAnalyticsData, LeadJourney } from './use-lead-analytics';
export type { TrackEventParams } from './useTracking';
