import assert from "node:assert/strict";
import test from "node:test";

import {
  canShareOwnWhatsAppSession,
  eligibleWhatsAppAccessRecipients,
} from "./whatsapp-session-sharing";

test("only a qualified owner may share a WhatsApp number", () => {
  const own = { ownerUserId: "owner", currentUserId: "owner" };
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "user" }), false);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "manager" }), false);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "admin" }), true);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: " OWNER " }), true);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "user", isSuperAdmin: true }), false);
  assert.equal(canShareOwnWhatsAppSession({ ...own, isTeamLeader: true }), false);
  assert.equal(canShareOwnWhatsAppSession({ ...own, ownerUserId: "other", memberRole: "admin" }), false);
});

test("only organization administrators see active recipients for sharing", () => {
  const users = [
    { id: "owner", is_active: true, home_organization_id: "org-a" },
    { id: "team-member", is_active: true, home_organization_id: "org-a" },
    { id: "outside-team", is_active: true, home_organization_id: "org-a" },
    { id: "inactive-member", is_active: false, home_organization_id: "org-a" },
  ];
  const leader = eligibleWhatsAppAccessRecipients(users, {
    organizationId: "org-a",
    currentUserId: "owner",
    isTeamLeader: true,
    ledUserIds: ["team-member", "inactive-member"],
  });
  assert.deepEqual(leader, []);

  const manager = eligibleWhatsAppAccessRecipients(users, {
    organizationId: "org-a",
    currentUserId: "owner",
    memberRole: "manager",
  });
  assert.deepEqual(manager, []);

  const administrator = eligibleWhatsAppAccessRecipients(users, {
    organizationId: "org-a",
    currentUserId: "owner",
    memberRole: "admin",
  });
  assert.deepEqual(administrator.map((user) => user.id), ["team-member", "outside-team"]);

  const ordinary = eligibleWhatsAppAccessRecipients(users, {
    organizationId: "org-a",
    currentUserId: "owner",
    memberRole: "user",
  });
  assert.deepEqual(ordinary, []);
});

test("sharing excludes secondary memberships and unknown home organizations without filtering the CRM catalogue", () => {
  const users = [
    { id: "home-a", organization_id: "org-b", home_organization_id: "org-a", is_active: true },
    { id: "home-b", organization_id: "org-b", home_organization_id: "org-b", is_active: true },
    { id: "legacy", organization_id: "org-b", is_active: true },
    { id: "unknown", organization_id: "org-b", home_organization_id: null, is_active: true },
    { id: "inactive-b", organization_id: "org-b", home_organization_id: "org-b", is_active: false },
  ];
  const eligible = eligibleWhatsAppAccessRecipients(users, { currentUserId: "admin-b", memberRole: "admin", organizationId: "org-b" });
  assert.deepEqual(eligible.map(user => user.id), ["home-b"]);
  assert.equal(users.length, 5, "sharing must not mutate the multi-organization CRM catalogue");
  assert.deepEqual(eligibleWhatsAppAccessRecipients(users, { currentUserId: "admin-b", memberRole: "admin", organizationId: null }), []);
});
