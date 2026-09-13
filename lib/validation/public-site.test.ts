import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_TRACKING_EVENT_TYPES } from "../site/public-tracking";
import {
  publicContactInputSchema,
  publicContactResponseSchema,
  publicSiteContactSchema,
  publicTrackingInputSchema,
  publicTrackingResponseSchema,
} from "./public-site";
import { publicSiteContactSchema as publicSiteContactSchemaFromLegacyModule } from "./schemas";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";

function validContact() {
  return {
    organization_id: ORGANIZATION_ID,
    name: "  André Silva  ",
    email: "andre@example.com",
    phone: "+55 (11) 99999-9999",
    message: "  Quero conhecer o imóvel.  ",
    privacy_accepted: true,
    property_id: PROPERTY_ID,
    session_id: "session-123",
    submission_id: "submission-12345678",
    landing_page: "/imoveis/AP-123",
    referrer: null,
  } as const;
}

function validTracking() {
  return {
    organization_id: ORGANIZATION_ID,
    event_type: "pageview",
    page_path: "/imoveis/AP-123",
    page_title: "Imóvel AP-123",
    referrer: null,
    session_id: "session-123",
    property_id: PROPERTY_ID,
    device_type: "mobile",
    browser: "chrome",
    screen_width: 390,
    screen_height: 844,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    gclid: null,
    fbclid: null,
    metadata: {
      os: "iOS",
      timezone: "America/Sao_Paulo",
    },
  } as const;
}

test("contact form and API adapter share one strict schema", () => {
  assert.equal(publicContactInputSchema, publicSiteContactSchema);
  assert.equal(
    publicSiteContactSchemaFromLegacyModule,
    publicSiteContactSchema,
  );

  const parsed = publicSiteContactSchema.parse(validContact());
  assert.equal(parsed.name, "André Silva");
  assert.equal(parsed.message, "Quero conhecer o imóvel.");
  assert.equal(parsed.referrer, null);
  assert.equal(
    publicSiteContactSchema.safeParse({ ...validContact(), email: "" }).success,
    true,
  );

  assert.equal(
    publicSiteContactSchema.safeParse({ ...validContact(), unexpected: true })
      .success,
    false,
  );
  assert.equal(
    publicSiteContactSchema.safeParse({
      ...validContact(),
      phone: "sem número",
    }).success,
    false,
  );
});

test("tracking accepts every canonical event and rejects typos", () => {
  for (const eventType of PUBLIC_TRACKING_EVENT_TYPES) {
    const payload = {
      ...validTracking(),
      event_type: eventType,
      metadata:
        eventType === "page_duration"
          ? { ...validTracking().metadata, duration_seconds: 1 }
          : validTracking().metadata,
    };
    assert.equal(
      publicTrackingInputSchema.safeParse(payload).success,
      true,
      eventType,
    );
  }

  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "page_duraton",
    }).success,
    false,
  );
});

test("tracking rejects forged lead ids and undeclared fields", () => {
  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      lead_id: "33333333-3333-4333-8333-333333333333",
    }).success,
    false,
  );
  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      lead_id: null,
    }).success,
    false,
  );
});

test("public sessions reserve the synthetic contact prefix", () => {
  for (const sessionId of [
    "site-contact:forged",
    "  site-contact:forged",
    "   ",
  ]) {
    assert.equal(
      publicTrackingInputSchema.safeParse({
        ...validTracking(),
        session_id: sessionId,
      }).success,
      false,
      `tracking session ${JSON.stringify(sessionId)}`,
    );
    assert.equal(
      publicSiteContactSchema.safeParse({
        ...validContact(),
        session_id: sessionId,
      }).success,
      false,
      `contact session ${JSON.stringify(sessionId)}`,
    );
  }
  assert.equal(
    publicSiteContactSchema.safeParse({
      ...validContact(),
      session_id: null,
    }).success,
    true,
  );
});

test("tracking accepts bounded click ids and rejects oversized values", () => {
  const parsed = publicTrackingInputSchema.parse({
    ...validTracking(),
    gclid: "  google-click-id  ",
    fbclid: "facebook-click-id",
  });
  assert.equal(parsed.gclid, "google-click-id");
  assert.equal(parsed.fbclid, "facebook-click-id");

  for (const key of ["gclid", "fbclid"] as const) {
    assert.equal(
      publicTrackingInputSchema.safeParse({
        ...validTracking(),
        [key]: "x".repeat(301),
      }).success,
      false,
      key,
    );
  }
});

test("page duration requires whole seconds within the Go limit", () => {
  for (const durationSeconds of [1, 86_400]) {
    assert.equal(
      publicTrackingInputSchema.safeParse({
        ...validTracking(),
        event_type: "page_duration",
        metadata: {
          ...validTracking().metadata,
          duration_seconds: durationSeconds,
        },
      }).success,
      true,
    );
  }

  for (const durationSeconds of [undefined, 0, 1.5, 86_401]) {
    const metadata = { ...validTracking().metadata } as Record<string, unknown>;
    if (durationSeconds !== undefined) {
      metadata.duration_seconds = durationSeconds;
    }
    assert.equal(
      publicTrackingInputSchema.safeParse({
        ...validTracking(),
        event_type: "page_duration",
        metadata,
      }).success,
      false,
      String(durationSeconds),
    );
  }

  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "pageview",
      metadata: {
        ...validTracking().metadata,
        duration_seconds: 30,
      },
    }).success,
    false,
  );
});

test("tracking metadata filters are strict and bounded", () => {
  const valid = publicTrackingInputSchema.safeParse({
    ...validTracking(),
    event_type: "property_search",
    metadata: {
      ...validTracking().metadata,
      filters: { search: "apartamento", cidade: "São Paulo", vagas: "2" },
    },
  });
  assert.equal(valid.success, true);

  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "property_search",
      metadata: {
        ...validTracking().metadata,
        filters: { search: "apartamento", token: "secret" },
      },
    }).success,
    false,
  );

  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "property_search",
      metadata: {
        ...validTracking().metadata,
        filters: { search: "apartamento" },
        search_term: "forjado pelo cliente",
      },
    }).success,
    false,
  );
});

test("tracking metadata fields are scoped to their event", () => {
  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "pageview",
      metadata: { ...validTracking().metadata, action: "forged" },
    }).success,
    false,
  );
  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "cta_click",
      metadata: {
        ...validTracking().metadata,
        action: "open_whatsapp_lead_form",
        placement: "property",
      },
    }).success,
    true,
  );
  assert.equal(
    publicTrackingInputSchema.safeParse({
      ...validTracking(),
      event_type: "pageview",
      metadata: { ...validTracking().metadata, locale: "pt-BR" },
    }).success,
    false,
  );
});

test("public response contracts reject invented fields", () => {
  assert.equal(
    publicContactResponseSchema.safeParse({
      success: true,
      lead_id: PROPERTY_ID,
      reentry: false,
    }).success,
    true,
  );
  assert.equal(
    publicTrackingResponseSchema.safeParse({ ok: true }).success,
    true,
  );
  assert.equal(
    publicTrackingResponseSchema.safeParse({ ok: true, visitor_id: "secret" })
      .success,
    false,
  );
});
