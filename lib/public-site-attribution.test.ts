import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublicAttributionKey,
  sanitizePublicReferrer,
} from "./site/public-attribution";

test("namespaces attribution for organizations on the shared sites origin", () => {
  assert.notEqual(getPublicAttributionKey("org-a"), getPublicAttributionKey("org-b"));
  assert.match(getPublicAttributionKey("org-a"), /v2:org-a$/);
});

test("removes query strings, fragments, credentials and unsupported schemes from referrers", () => {
  assert.equal(
    sanitizePublicReferrer("https://partner.example/imoveis?email=a%40b.com#lead"),
    "https://partner.example/imoveis",
  );
  assert.equal(
    sanitizePublicReferrer("https://user:secret@partner.example/path?token=secret"),
    "https://partner.example/path",
  );
  assert.equal(sanitizePublicReferrer("javascript:alert(1)"), null);
  assert.equal(sanitizePublicReferrer("not a url"), null);
});
