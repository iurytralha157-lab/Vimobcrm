import assert from "node:assert/strict";
import test from "node:test";
import {
  addRoundRobinMemberInputSchema,
  availabilityInputSchema,
  bulkAvailabilityInputSchema,
  createRoundRobinInputSchema,
  createRoundRobinRuleInputSchema,
  updateRoundRobinInputSchema,
  updateRoundRobinMemberInputSchema,
  updateRoundRobinRuleInputSchema,
  updateTagInputSchema,
} from "./crm-support";

const id = "11111111-1111-4111-8111-111111111111";

test("every management edit carries a revision; a revision alone cannot erase a configuration", () => {
  for (const [schema, changes] of [
    [updateRoundRobinInputSchema, { name: "Fila QA" }],
    [createRoundRobinRuleInputSchema, { matchType: "source", matchValue: "site" }],
    [updateRoundRobinRuleInputSchema, { isActive: false }],
    [addRoundRobinMemberInputSchema, { userId: id }],
    [updateRoundRobinMemberInputSchema, { weight: 2 }],
  ] as const) {
    assert.equal(schema.safeParse(changes).success, false);
    assert.equal(schema.safeParse({ ...changes, expectedRevision: 3 }).success, true);
    assert.equal(schema.safeParse({ ...changes, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }).success, false);
  }
  assert.equal(updateRoundRobinInputSchema.safeParse({ expectedRevision: 3 }).success, false);
  assert.equal(updateRoundRobinMemberInputSchema.safeParse({ expectedRevision: 3 }).success, false);
  assert.equal(updateRoundRobinRuleInputSchema.safeParse({ expectedRevision: 3 }).success, false);
  assert.equal(updateTagInputSchema.safeParse({ name: "QA", color: "#ffffff" }).success, false);
  assert.equal(updateTagInputSchema.safeParse({ name: "QA", color: "#ffffff", expected_updated_at: "2026-10-12T10:00:00.123456Z" }).success, true);
});

test("availability accepts overnight shifts and rejects malformed clocks even on inactive days", () => {
  const day = { team_member_id: id, expected_revision: 4, day_of_week: 1, is_active: true, start_time: "22:00", end_time: "06:00" };
  assert.equal(availabilityInputSchema.safeParse(day).success, true);
  assert.equal(availabilityInputSchema.safeParse({ ...day, end_time: "22:00:00" }).success, false);
  for (const value of ["08:00:garbage", "24:00", "08:70", "08:00:61"]) {
    assert.equal(availabilityInputSchema.safeParse({ ...day, is_active: false, start_time: value }).success, false);
  }
  assert.equal(availabilityInputSchema.safeParse({ ...day, is_active: false, start_time: null, end_time: null }).success, true);
  const week = Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, is_all_day: true, is_active: true }));
  assert.equal(bulkAvailabilityInputSchema.safeParse({ availability: week }).success, false);
  assert.equal(bulkAvailabilityInputSchema.safeParse({ availability: week, expected_revision: 4 }).success, true);
});

test("saved legacy rule identity and inactivity survive transport while numeric limits remain bounded", () => {
  const payload = { name: "Fila QA", rules: [{ id, matchType: "property", matchValue: id, priority: 19, isActive: false }], members: [{ type: "user", entityId: id, isActive: false, weight: 1000 }] };
  const parsed = createRoundRobinInputSchema.parse(payload);
  assert.equal(parsed.rules?.[0].id, id);
  assert.equal(parsed.rules?.[0].isActive, false);
  assert.equal(parsed.members?.[0].isActive, false);
  assert.equal(createRoundRobinInputSchema.safeParse({ name: "QA", conditions: [{ type: "source", values: ["site"], priority: 2_147_483_648 }] }).success, false);
  assert.equal(updateRoundRobinMemberInputSchema.safeParse({ expectedRevision: 1, weight: 1.5 }).success, false);
  assert.equal(updateRoundRobinMemberInputSchema.safeParse({ expectedRevision: 1, weight: 1001 }).success, false);
  assert.equal(createRoundRobinInputSchema.safeParse({ name: "QA", settings: { redistribution_timeout_minutes: 1.5 } }).success, false);
});

test("create keeps collection limits while revisioned edits can preserve legacy snapshots", () => {
  const members = Array.from({ length: 501 }, () => ({ type: "user", entityId: id, weight: 1 }));
  const rules = Array.from({ length: 201 }, () => ({ id, matchType: "source", matchValue: "site", priority: 0 }));
  assert.equal(createRoundRobinInputSchema.safeParse({ name: "QA", members }).success, false);
  assert.equal(createRoundRobinInputSchema.safeParse({ name: "QA", rules }).success, false);
  assert.equal(updateRoundRobinInputSchema.safeParse({ expectedRevision: 1, name: "QA", members, rules }).success, true);
  assert.equal(updateRoundRobinInputSchema.safeParse({ name: "QA", members, rules }).success, false);
  assert.equal(updateRoundRobinInputSchema.safeParse({ expectedRevision: 1, members: [{ ...members[0], weight: 1001 }] }).success, false);
});
