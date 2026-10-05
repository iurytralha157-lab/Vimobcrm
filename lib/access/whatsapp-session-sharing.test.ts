import assert from "node:assert/strict";
import test from "node:test";

import {
  canShareOwnWhatsAppSession,
  eligibleWhatsAppAccessRecipients,
  getOwnConnectedWhatsAppSessions,
  isExactExistingLeadConversation,
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

test("new conversation choice contains only connected numbers owned by the user", () => {
  const sessions = [
    { id: "mine", organization_id: "org", owner_user_id: "me", status: "connected", provider: "evolution_go" },
    { id: "shared", organization_id: "org", owner_user_id: "other", status: "connected", provider: "evolution_go" },
    { id: "offline", organization_id: "org", owner_user_id: "me", status: "disconnected", provider: "evolution_go" },
    { id: "legacy", organization_id: "org", owner_user_id: "me", status: "connected", provider: "evolution" },
    { id: "unknown", organization_id: "org", owner_user_id: "me", status: "connected" },
    { id: "other-org", organization_id: "other", owner_user_id: "me", status: "connected", provider: "evolution_go" },
  ];
  assert.deepEqual(getOwnConnectedWhatsAppSessions(sessions, "me", "org").map((session) => session.id), ["mine"]);
});

test("own conversation is reused only with exact organization, session, lead and phone", () => {
  const input = { organizationId: "org", sessionId: "own-session", leadId: "lead", phone: "+5511999999999" };
  const existing = {
    session_id: "own-session",
    lead_id: "lead",
    contact_phone: "+5511999999999",
    remote_jid: "5511999999999@s.whatsapp.net",
    is_group: false,
    session: { organization_id: "org", provider: "evolution_go" },
  };
  assert.equal(isExactExistingLeadConversation(existing, input), true);
  assert.equal(isExactExistingLeadConversation(null, input), false);
  assert.equal(isExactExistingLeadConversation({ ...existing, lead_id: "other-lead" }, input), false);
  assert.equal(isExactExistingLeadConversation({ ...existing, session_id: "other-session" }, input), false);
  assert.equal(isExactExistingLeadConversation({ ...existing, contact_phone: "+5511888888888", remote_jid: "5511888888888@s.whatsapp.net" }, input), false);
  assert.equal(isExactExistingLeadConversation({ ...existing, session: { ...existing.session, organization_id: "other" } }, input), false);
  assert.equal(isExactExistingLeadConversation({ ...existing, historical_lead_view: true }, input), false);
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
