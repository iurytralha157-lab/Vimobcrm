import assert from "node:assert/strict";
import test from "node:test";

import {
  canShareOwnWhatsAppSession,
  eligibleWhatsAppAccessRecipients,
} from "./whatsapp-session-sharing";

test("only a qualified owner may share a WhatsApp number", () => {
  const own = { ownerUserId: "owner", currentUserId: "owner" };
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "user" }), false);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "manager" }), true);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "admin" }), true);
  assert.equal(canShareOwnWhatsAppSession({ ...own, memberRole: "user", isSuperAdmin: true }), false);
  assert.equal(canShareOwnWhatsAppSession({ ...own, isTeamLeader: true }), true);
  assert.equal(canShareOwnWhatsAppSession({ ...own, ownerUserId: "other", memberRole: "admin" }), false);
});

test("leaders only see active members of teams they lead as recipients", () => {
  const users = [
    { id: "owner", is_active: true },
    { id: "team-member", is_active: true },
    { id: "outside-team", is_active: true },
    { id: "inactive-member", is_active: false },
  ];
  const leader = eligibleWhatsAppAccessRecipients(users, {
    currentUserId: "owner",
    isTeamLeader: true,
    ledUserIds: ["team-member", "inactive-member"],
  });
  assert.deepEqual(leader.map((user) => user.id), ["team-member"]);

  const manager = eligibleWhatsAppAccessRecipients(users, {
    currentUserId: "owner",
    memberRole: "manager",
  });
  assert.deepEqual(manager.map((user) => user.id), ["team-member", "outside-team"]);

  const ordinary = eligibleWhatsAppAccessRecipients(users, {
    currentUserId: "owner",
    memberRole: "user",
  });
  assert.deepEqual(ordinary, []);
});
