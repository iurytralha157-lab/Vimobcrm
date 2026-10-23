import assert from "node:assert/strict";
import test from "node:test";
import { clearTeamCreateIntentsForUser, readTeamCreateIntent, saveTeamCreateIntent, teamCreateIntentKey, teamCreationErrorConfirmsNoResult, type TeamCreateIntent } from "./team-create-intent";

const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const otherUser = "00000000-0000-4000-8000-000000000003";
const otherOrg = "00000000-0000-4000-8000-000000000004";
const now = 1_800_000_000_000;
function storage() {
  const items = new Map<string, string>();
  return { get length() { return items.size; }, key(index: number) { return [...items.keys()][index] || null; }, getItem(key: string) { return items.get(key) ?? null; }, setItem(key: string, value: string) { items.set(key, value); }, removeItem(key: string) { items.delete(key); } };
}
const attempt = (): TeamCreateIntent => ({ organizationId, userId, idempotencyKey: "00000000-0000-4000-8000-000000000005", input: { name: "Equipe Norte", is_active: true, logo_url: null, members: [{ userId, isLeader: true, availability: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, is_active: true, is_all_day: false, start_time: "22:00:00", end_time: "06:00:00" })) }] } });

test("reload recovers the exact creation key and frozen validated payload without following later edits", () => {
  const session = storage();
  const intent = attempt();
  assert.equal(saveTeamCreateIntent(session, intent, now), true);
  intent.input.name = "Edited after the request";
  const recovered = readTeamCreateIntent(session, organizationId, userId, now + 60_000);
  assert.equal(recovered?.status, "ready");
  if (recovered?.status !== "ready") assert.fail("Missing prior request");
  assert.equal(recovered.intent.idempotencyKey, intent.idempotencyKey);
  assert.equal(recovered.intent.input.name, "Equipe Norte");
  assert.equal(recovered.intent.input.members?.[0].availability?.[0].start_time, "22:00:00");
});

test("an intent never crosses tenant or principal and mismatched stored scope blocks silent recreation", () => {
  const session = storage();
  saveTeamCreateIntent(session, attempt(), now);
  assert.equal(readTeamCreateIntent(session, otherOrg, userId, now), null);
  assert.equal(readTeamCreateIntent(session, organizationId, otherUser, now), null);
  session.setItem(teamCreateIntentKey(otherOrg, userId)!, session.getItem(teamCreateIntentKey(organizationId, userId)!)!);
  assert.deepEqual(readTeamCreateIntent(session, otherOrg, userId, now), { status: "review_required" });
});

test("expired, future, malformed and oversized requests discard payload but require explicit review", () => {
  for (const value of [JSON.stringify({ ...attempt(), savedAt: now - 2 * 60 * 60 * 1000 - 1 }), JSON.stringify({ ...attempt(), savedAt: now + 1 }), "invalid JSON", "x".repeat(1_000_001)]) {
    const session = storage();
    const key = teamCreateIntentKey(organizationId, userId)!;
    session.setItem(key, value);
    assert.deepEqual(readTeamCreateIntent(session, organizationId, userId, now), { status: "review_required" });
    assert.equal(session.getItem(key), '{"reviewRequired":true}');
    assert.deepEqual(readTeamCreateIntent(session, organizationId, userId, now), { status: "review_required" });
  }
});

test("storage refusal and invalid weeks fail persistence before any request may be sent", () => {
  const refused = { getItem() { return null; }, setItem() { throw new Error("quota"); }, removeItem() {} };
  assert.equal(saveTeamCreateIntent(refused, attempt(), now), false);
  const intent = attempt();
  intent.input.members![0].availability!.pop();
  const session = storage();
  assert.equal(saveTeamCreateIntent(session, intent, now), false);
  assert.equal(session.length, 0);
});

test("logout cleanup removes every team creation for the user and keeps other users and domains", () => {
  const session = storage();
  saveTeamCreateIntent(session, attempt(), now);
  saveTeamCreateIntent(session, { ...attempt(), organizationId: otherOrg }, now);
  saveTeamCreateIntent(session, { ...attempt(), userId: otherUser }, now);
  session.setItem("vimob:distribution-draft:other", "unchanged");
  clearTeamCreateIntentsForUser(session, userId);
  assert.equal(readTeamCreateIntent(session, organizationId, userId, now), null);
  assert.equal(readTeamCreateIntent(session, otherOrg, userId, now), null);
  assert.equal(readTeamCreateIntent(session, organizationId, otherUser, now)?.status, "ready");
  assert.equal(session.getItem("vimob:distribution-draft:other"), "unchanged");
});

test("a refused replay preserves an ambiguous original outcome even after authorization or validation changes", () => {
  for (const status of [400, 401, 403, 404, 409, 500]) assert.equal(teamCreationErrorConfirmsNoResult({ status }, true), false);
  assert.equal(teamCreationErrorConfirmsNoResult({ status: 400 }, false), true);
  assert.equal(teamCreationErrorConfirmsNoResult({ status: 408 }, false), false);
  assert.equal(teamCreationErrorConfirmsNoResult({ status: 409, code: "create_result_unavailable" }, true), true);
});
