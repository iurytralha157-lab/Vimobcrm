import assert from "node:assert/strict";
import test from "node:test";
import { canPurgeNotification } from "./notification-retention.ts";

test("in-app-only notifications remain eligible for normal retention", () => {
  assert.equal(canPurgeNotification(null), true);
  assert.equal(canPurgeNotification({ event_key: "announcement" }), true);
});

test("all delivery-backed rows are retained until an audited archive exists", () => {
  for (
    const status of [
      "delivered",
      "sent",
      "skipped",
      "cancelled",
      "canceled",
      "pending",
      "processing",
      "failed",
      "accepted",
      "outcome_unknown",
      "delivery_failed",
      "permanent_failed",
    ]
  ) {
    assert.equal(
      canPurgeNotification({
        dispatch: { push: { required: true, status } },
      }),
      false,
      status,
    );
  }
});

test("an unknown provider outcome is retained even with a successful-looking status", () => {
  assert.equal(
    canPurgeNotification({
      dispatch: {
        whatsapp: {
          required: true,
          status: "sent",
          outcome_unknown: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    canPurgeNotification({ outcome_unknown: "true" }),
    false,
  );
});

test("legacy channel aliases receive the same fail-closed retention policy", () => {
  assert.equal(
    canPurgeNotification({
      whatsapp_dispatch_required: true,
      whatsapp_dispatch: { status: "pending" },
    }),
    false,
  );
  assert.equal(
    canPurgeNotification({
      push_dispatch: { status: "delivered" },
      email_dispatch: { status: "sent" },
    }),
    false,
  );
});

test("missing, malformed, and future delivery states fail closed", () => {
  assert.equal(
    canPurgeNotification({ whatsapp_dispatch_required: true }),
    false,
  );
  assert.equal(canPurgeNotification({ dispatch: {} }), false);
  assert.equal(
    canPurgeNotification({
      dispatch: { push: { status: "blocked_dependency" } },
    }),
    false,
  );
  assert.equal(
    canPurgeNotification({ dispatch: { push: "sent" } }),
    false,
  );
  assert.equal(
    canPurgeNotification({ dispatch: { push: { required: false } } }),
    false,
  );
  assert.equal(canPurgeNotification(["unexpected"]), false);
});

test("one unfinished channel keeps the whole notification", () => {
  assert.equal(
    canPurgeNotification({
      dispatch: {
        push: { required: true, status: "delivered" },
        email: { required: true, status: "accepted" },
      },
    }),
    false,
  );
});

test("even false legacy delivery flags retain the row for an audited archive", () => {
  assert.equal(
    canPurgeNotification({ whatsapp_dispatch_required: false }),
    false,
  );
});
