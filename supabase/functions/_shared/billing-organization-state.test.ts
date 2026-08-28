import assert from "node:assert/strict";
import test from "node:test";
import { billingOrganizationIsUnavailable } from "./billing-organization-state.ts";

test("recognizes canonical inactive and cleanup outcomes", () => {
  assert.equal(
    billingOrganizationIsUnavailable({ outcome: "organization_inactive" }),
    true,
  );
  assert.equal(
    billingOrganizationIsUnavailable({ outcome: "organization_not_found" }),
    true,
  );
  assert.equal(
    billingOrganizationIsUnavailable({ outcome: "organization_cleanup" }),
    true,
  );
});

test("keeps compatibility with the former cleanup busy reason", () => {
  assert.equal(
    billingOrganizationIsUnavailable({
      outcome: "busy",
      busy_reason: "organization_cleanup",
    }),
    true,
  );
  assert.equal(
    billingOrganizationIsUnavailable({
      outcome: "busy",
      busy_reason: "organization_inactive",
    }),
    true,
  );
});

test("does not confuse a transient billing lease with inactive tenancy", () => {
  assert.equal(
    billingOrganizationIsUnavailable({
      outcome: "busy",
      busy_reason: "payment_attempt",
    }),
    false,
  );
  assert.equal(billingOrganizationIsUnavailable({ outcome: "claimed" }), false);
  assert.equal(billingOrganizationIsUnavailable(null), false);
});
