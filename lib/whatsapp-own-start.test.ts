import assert from "node:assert/strict";
import test from "node:test";
import { getOwnWhatsAppStartNotice } from "@/lib/whatsapp-own-start";

const own = { id: "own", owner_user_id: "viewer", status: "connected", provider: "evolution_go", can_send: true };
const conversation = { id: "history", session_id: "other", lead_id: "lead", contact_phone: "5511999999999" };
const get = (patch: Partial<Parameters<typeof getOwnWhatsAppStartNotice>[0]> = {}) => getOwnWhatsAppStartNotice({
  conversation, sessions: [own], currentUserId: "viewer", canOperate: true, ...patch,
});

test("connected own account offers start and disconnected account offers connection", () => {
  assert.deepEqual(get(), { kind: "start", ownConnectedSessionIds: ["own"] });
  assert.equal(get({ sessions: [] })?.kind, "connect");
  assert.equal(get({ sessions: [{ ...own, status: "disconnected" }] })?.kind, "connect");
});
test("an authorized current route needs no strip, including assigned shared attendance", () => {
  assert.equal(get({ conversation: { ...conversation, session_id: "own" } }), null);
  assert.equal(get({ conversation: { ...conversation, lead: { id: "lead", assignee: { id: "viewer" } } },
    sessions: [{ ...own, id: "other", owner_user_id: "admin" }] }), null);
});
test("historical own route remains readonly and can prepare a new own route", () => {
  assert.equal(get({ conversation: { ...conversation, session_id: "own", historical_lead_view: true } })?.kind, "start");
});
test("legacy, denied and shared sessions are never offered as the viewer's number", () => {
  for (const session of [{ ...own, provider: "evolution" }, { ...own, can_send: false }, { ...own, owner_user_id: "admin" }]) {
    assert.equal(get({ sessions: [session] })?.kind, "connect");
  }
});
test("read-only, unresolved, groups and contacts without a lead show no attendance strip", () => {
  for (const patch of [{ canOperate: false }, { currentUserId: null }, { sessions: undefined }, { loadingSessions: true },
    { conversation: null }, { conversation: { ...conversation, is_group: true } }, { conversation: { ...conversation, lead_id: null } }]) {
    assert.equal(get(patch), null);
  }
});
test("new lead preserves the normal composer and multiple own numbers require explicit choice", () => {
  assert.equal(get({ conversation: { ...conversation, id: null, session_id: null } }), null);
  assert.equal(get({ conversation: { ...conversation, id: null }, sessions: [] })?.kind, "connect");
  assert.deepEqual(get({ sessions: [own, { ...own, id: "own-2" }] })?.ownConnectedSessionIds, ["own", "own-2"]);
});
