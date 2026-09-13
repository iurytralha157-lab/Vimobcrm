type StaleSensitivePublicSiteFields = {
  body_scripts: null;
  google_ads_id: null;
  google_analytics_id: null;
  google_search_console_verification: null;
  gtm_id: null;
  head_scripts: null;
  meta_pixel_id: null;
};

// Availability fallback may keep public content, but it must never reactivate a
// tracker, custom script or ownership-verification token that an operator has
// removed since the last successful canonical read.
export function stripStalePublicSiteIntegrations<T extends object>(
  site: T,
): T & StaleSensitivePublicSiteFields {
  return {
    ...site,
    body_scripts: null,
    google_ads_id: null,
    google_analytics_id: null,
    google_search_console_verification: null,
    gtm_id: null,
    head_scripts: null,
    meta_pixel_id: null,
  };
}
