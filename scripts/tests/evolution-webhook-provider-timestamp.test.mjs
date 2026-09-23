import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEvolutionProviderOccurredAt,
  providerOccurredByInboxAcceptance,
} from "../../supabase/functions/evolution-webhook/provider-timestamp.ts";

test("Evolution provider seconds and milliseconds normalize to the same instant", () => {
  const expected = "2023-11-14T22:13:20.000Z";
  assert.equal(normalizeEvolutionProviderOccurredAt(1_700_000_000), expected);
  assert.equal(normalizeEvolutionProviderOccurredAt(1_700_000_000_000), expected);
  assert.equal(normalizeEvolutionProviderOccurredAt("1700000000"), expected);
  assert.equal(normalizeEvolutionProviderOccurredAt("1700000000000"), expected);
});

test("missing or malformed Evolution provider time fails closed", () => {
  for (const value of [null, undefined, "", "not-a-time", {}, -1, 0, Infinity, 9e15]) {
    assert.equal(normalizeEvolutionProviderOccurredAt(value), null);
  }
});

test("provider occurrence cannot follow the durable inbox acceptance", () => {
  const acceptedAt = "2023-11-14T22:13:20.500Z";
  assert.equal(
    providerOccurredByInboxAcceptance(
      normalizeEvolutionProviderOccurredAt(1_700_000_000_000),
      acceptedAt,
    ),
    true,
  );
  assert.equal(
    providerOccurredByInboxAcceptance(
      normalizeEvolutionProviderOccurredAt(1_700_000_001_000),
      acceptedAt,
    ),
    false,
  );
  assert.equal(providerOccurredByInboxAcceptance(null, acceptedAt), false);
  assert.equal(providerOccurredByInboxAcceptance("2023-11-14T22:13:20.000Z", null), false);
});
