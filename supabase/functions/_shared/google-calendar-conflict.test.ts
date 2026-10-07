import assert from "node:assert/strict";
import test from "node:test";

import {
  conditionalGoogleWriteHeaders,
  decideGooglePullForLocalEvent,
  googleEventDiffersFromLink,
  GoogleCalendarConflictError,
  hasUnsyncedVimobChanges,
} from "./google-calendar-conflict.ts";

test("only unsent or unresolved Vimob edits block automatic Google imports", () => {
  for (const status of ["pending", "error", "conflict"]) {
    assert.equal(hasUnsyncedVimobChanges(status), true);
  }
  for (const status of ["synced", "not_connected", null, undefined]) {
    assert.equal(hasUnsyncedVimobChanges(status), false);
  }
});

test("a changed or unknown Google version requires review", () => {
  assert.equal(googleEventDiffersFromLink('"v1"', '"v1"'), false);
  assert.equal(googleEventDiffersFromLink('"v1"', '"v2"'), true);
  assert.equal(googleEventDiffersFromLink(null, '"v2"'), true);
  assert.equal(googleEventDiffersFromLink('"v1"', null), true);
});

test("pull preserves unsent Vimob edits and never auto-resolves a conflict", () => {
  assert.equal(decideGooglePullForLocalEvent("synced", '"v1"', '"v2"'), "apply");
  assert.equal(decideGooglePullForLocalEvent("pending", '"v1"', '"v1"'), "preserve");
  assert.equal(decideGooglePullForLocalEvent("pending", '"v1"', '"v2"'), "conflict");
  assert.equal(decideGooglePullForLocalEvent("error", null, '"v2"'), "conflict");
  assert.equal(decideGooglePullForLocalEvent("conflict", '"v2"', '"v2"'), "conflict");
});

test("conditional writes preserve Google's quoted ETag and fail closed without one", () => {
  assert.deepEqual(conditionalGoogleWriteHeaders('"v1"'), {
    "If-Match": '"v1"',
  });
  assert.throws(
    () => conditionalGoogleWriteHeaders(null),
    GoogleCalendarConflictError,
  );
});
