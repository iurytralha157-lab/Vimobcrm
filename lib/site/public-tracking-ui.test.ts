import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public favorites emit analytics only when a property is added", () => {
  const source = readFileSync(
    "components/features/public-site/FavoriteButton.tsx",
    "utf8",
  );

  assert.match(source, /const isAdding = !current\.includes\(propertyId\)/);
  assert.match(
    source,
    /if \(isAdding\) void trackFavorite\(organizationId, propertyId\)/,
  );
});

test("opening the WhatsApp lead form emits a real CTA tied to the property", () => {
  const source = readFileSync(
    "components/features/public-site/PublicContactLeadDialog.tsx",
    "utf8",
  );

  assert.match(source, /eventType: "cta_click"/);
  assert.match(source, /propertyId,/);
  assert.match(source, /action: "open_whatsapp_lead_form"/);
  assert.doesNotMatch(source, /eventType: "form_submit"/);
});

test("public tracking follows client-side path and search navigations", () => {
  const trackerSource = readFileSync(
    "components/features/public-site/PublicSiteTracker.tsx",
    "utf8",
  );
  const shellSource = readFileSync(
    "components/features/public-site/PublicSiteShell.tsx",
    "utf8",
  );

  assert.match(trackerSource, /usePathname\(\)/);
  assert.match(trackerSource, /useSearchParams\(\)/);
  assert.match(
    trackerSource,
    /pickPublicSiteSearchFilters\(serializedSearchParams\)/,
  );
  assert.match(trackerSource, /pagePath: pathname/);
  assert.match(
    trackerSource,
    /\[organizationId, pageTitle, pathname, propertyId, serializedSearchParams\]/,
  );
  assert.match(
    shellSource,
    /<Suspense fallback=\{null\}>[\s\S]*<PublicSiteTracker/,
  );
});

test("public tracking forwards click attribution and confirms session start after the request", () => {
  const trackingSource = readFileSync("hooks/useTracking.ts", "utf8");
  const contactSource = readFileSync(
    "components/features/public-site/PublicContactForm.tsx",
    "utf8",
  );

  assert.match(trackingSource, /gclid: attribution\.gclid/);
  assert.match(trackingSource, /fbclid: attribution\.fbclid/);
  assert.match(trackingSource, /await coordinateSessionStart\(/);
  assert.match(
    trackingSource,
    /start: \(\) =>[\s\S]*publicSiteAPI\.track\([\s\S]*event_type: "session_start"/,
  );
  assert.match(
    trackingSource,
    /event_type: "session_start",[\s\S]*gclid: attribution\.gclid,[\s\S]*fbclid: attribution\.fbclid/,
  );
  assert.match(
    trackingSource,
    /markStarted: \(\) =>[\s\S]*markPublicSiteSessionStarted/,
  );
  assert.match(
    contactSource,
    /void trackEvent\([\s\S]*eventType: "session_start"/,
  );
});
