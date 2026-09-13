import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptPublicCookieConsent,
  getPublicCookieConsentKey,
  hasPublicCookieConsent,
  PUBLIC_COOKIE_CONSENT_KEY_PREFIX,
  type PublicCookieConsentStorage,
} from "./public-consent";

function memoryStorage(): PublicCookieConsentStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("versions and isolates cookie consent on the shared sites origin", () => {
  assert.match(PUBLIC_COOKIE_CONSENT_KEY_PREFIX, /v2$/);
  assert.notEqual(
    getPublicCookieConsentKey("org-a"),
    getPublicCookieConsentKey("org-b"),
  );
});

test("rejects consent storage without a tenant identity", () => {
  assert.throws(() => getPublicCookieConsentKey("  "), /must not be empty/);
});

test("persists consent only for the selected organization", () => {
  const storage = memoryStorage();
  const organizationId = `org-consent-${Date.now()}`;

  assert.equal(hasPublicCookieConsent(organizationId, storage), false);
  acceptPublicCookieConsent(organizationId, storage);
  assert.equal(hasPublicCookieConsent(organizationId, storage), true);
  assert.equal(hasPublicCookieConsent(`${organizationId}-other`, storage), false);
});

test("keeps explicit consent for the page lifecycle when storage is blocked", () => {
  const organizationId = `org-blocked-${Date.now()}`;
  const blockedStorage: PublicCookieConsentStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.equal(hasPublicCookieConsent(organizationId, blockedStorage), false);
  acceptPublicCookieConsent(organizationId, blockedStorage);
  assert.equal(hasPublicCookieConsent(organizationId, blockedStorage), true);
});
