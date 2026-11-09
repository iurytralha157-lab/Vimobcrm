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
test("only the assigned owner of an exact usable route can explicitly resume missing attendance", () => {
  const assigned = { ...conversation, session_id: own.id, lead: { id: "lead", assignee: { id: "viewer" } } };
  assert.deepEqual(get({ conversation: assigned, attendanceMissing: true }), {
    kind: "start", ownConnectedSessionIds: [own.id], preserveComposer: true, resumeCapture: true,
  });
  assert.equal(get({ conversation: assigned }), null);
  assert.equal(get({ conversation: { ...assigned, lead: { id: "lead", assignee: { id: "other" } } }, attendanceMissing: true }), null);
  assert.equal(get({ conversation: { ...assigned, historical_lead_view: true }, attendanceMissing: true })?.resumeCapture, undefined);
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

test("supervisory access offers neither a new own conversation nor a connection action", () => {
  const supervisory = { ...conversation, historical_lead_view: true, supervisory_lead_view: true };
  assert.equal(get({ conversation: supervisory }), null);
  assert.equal(get({ conversation: supervisory, sessions: [] }), null);
});
