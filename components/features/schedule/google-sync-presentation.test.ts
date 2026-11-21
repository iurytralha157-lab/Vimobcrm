import assert from "node:assert/strict";
import test from "node:test";
import { getGoogleSyncFeedback, GOOGLE_TASKS_DATE_ONLY_NOTICE } from "./google-sync-presentation";

test("uses the server destination for pending, synced and failed activity exports", () => {
  for (const target of ["calendar", "tasks"] as const) {
    const label = target === "tasks" ? "Google Tasks" : "Google Agenda";
    for (const [status, tone] of [["pending", "pending"], ["synced", "success"], ["error", "warning"], ["conflict", "warning"]]) {
      const feedback = getGoogleSyncFeedback({ target, status, isMasked: false });
      assert.equal(feedback?.tone, tone);
      assert.ok(feedback?.title.includes(label));
      assert.equal(feedback?.description.includes(GOOGLE_TASKS_DATE_ONLY_NOTICE), target === "tasks");
    }
  }
});

test("masked activities never expose Google destination, grant or delivery status", () => {
  for (const target of ["calendar", "tasks", null, undefined] as const) {
    for (const status of ["pending", "synced", "error", "conflict", "needs_auth", "not_connected"]) {
      assert.equal(getGoogleSyncFeedback({ target, status, isMasked: true }), null);
    }
  }
});

test("authorization guidance points to the connection without claiming a successful send", () => {
  for (const status of ["needs_auth", "not_connected"]) {
    const feedback = getGoogleSyncFeedback({ target: "tasks", status, isMasked: false });
    assert.equal(feedback?.requiresConnection, true);
    assert.equal(feedback?.tone, "warning");
    assert.match(feedback?.title || "", /Autorize.*Google Tasks/);
    assert.match(feedback?.description || "", /horários.*Vimob/);
  }
});

test("keeps old Calendar failures readable and does not invent a destination for null", () => {
  assert.match(getGoogleSyncFeedback({ status: "error", isMasked: false })?.title || "", /Google Agenda/);
  assert.equal(getGoogleSyncFeedback({ status: "synced", isMasked: false }), null);
  assert.equal(getGoogleSyncFeedback({ target: null, status: "error", isMasked: false }), null);
  const unknown = getGoogleSyncFeedback({ target: "tasks", status: "future_state", isMasked: false });
  assert.equal(unknown?.tone, "neutral");
  assert.doesNotMatch(unknown?.title || "", /Enviado|pendente/);
});
