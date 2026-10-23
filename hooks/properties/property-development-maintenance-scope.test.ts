import assert from "node:assert/strict";
import test from "node:test";
import {
  isDevelopmentMaintenanceScopeCurrent,
  nextDevelopmentMaintenanceInvalidation,
  type DevelopmentMaintenanceScope,
} from "./property-development-maintenance-scope";

const initial: DevelopmentMaintenanceScope = {
  userId: "actor-a",
  tenantUserId: "actor-a",
  organizationId: "org-a",
  tenantOrganizationId: "org-a",
  accessSignature: "current-access",
  ready: true,
  canManage: true,
};

test("maintenance permits only the original stable actor, tenant and rights", () => {
  assert.equal(
    isDevelopmentMaintenanceScopeCurrent(initial, { ...initial }, "org-a"),
    true,
  );
  for (const changed of [
    { userId: "actor-b" },
    { userId: null },
    { tenantUserId: "actor-b" },
    { organizationId: "org-b" },
    { tenantOrganizationId: "org-b" },
    { ready: false },
    { canManage: false },
    { accessSignature: "changed-access" },
  ]) {
    assert.equal(
      isDevelopmentMaintenanceScopeCurrent(
        initial,
        { ...initial, ...changed },
        "org-a",
      ),
      false,
    );
  }
  assert.equal(
    isDevelopmentMaintenanceScopeCurrent(initial, initial, "org-b"),
    false,
  );
  assert.equal(
    isDevelopmentMaintenanceScopeCurrent(
      { ...initial, ready: false },
      initial,
      "org-a",
    ),
    false,
  );
});

test("maintenance invalidation stays closed after actor or access A-B-A transitions", () => {
  for (const changed of [
    { ...initial, userId: "actor-b", tenantUserId: "actor-b" },
    { ...initial, organizationId: "org-b", tenantOrganizationId: "org-b" },
    { ...initial, accessSignature: "module-disabled", canManage: false },
  ]) {
    const lost = nextDevelopmentMaintenanceInvalidation(
      false,
      initial,
      changed,
      "org-a",
    );
    assert.equal(lost, true);
    assert.equal(
      nextDevelopmentMaintenanceInvalidation(lost, initial, initial, "org-a"),
      true,
    );
  }
  assert.equal(
    nextDevelopmentMaintenanceInvalidation(false, initial, initial, "org-a"),
    false,
  );
});
