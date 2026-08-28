import assert from "node:assert/strict";
import test from "node:test";
import { canonicalAIPauseReason } from "./canonical-ai-pause.ts";

const now = Date.parse("2026-08-16T15:00:00.000Z");

test("canonical human override and future pause block the legacy responder", () => {
  assert.equal(
    canonicalAIPauseReason({ human_override: true, paused_until: null }, now),
    "human_override",
  );
  assert.equal(
    canonicalAIPauseReason({
      human_override: false,
      paused_until: "2026-08-16T15:05:00.000Z",
    }, now),
    "paused_until",
  );
});

test("expired pause is allowed and malformed canonical state fails closed", () => {
  assert.equal(
    canonicalAIPauseReason({
      human_override: false,
      paused_until: "2026-08-16T14:59:59.000Z",
    }, now),
    null,
  );
  assert.equal(canonicalAIPauseReason(null, now), null);
  assert.equal(
    canonicalAIPauseReason({ human_override: null, paused_until: null }, now),
    "invalid_human_override",
  );
  assert.equal(
    canonicalAIPauseReason({ human_override: false, paused_until: "invalid" }, now),
    "invalid_paused_until",
  );
});
