import assert from "node:assert/strict";
import test from "node:test";
import { availabilityDraftReducer, EMPTY_AVAILABILITY_DRAFT } from "./member-availability-draft";
import type { MemberAvailabilitySnapshot } from "@/lib/api/teams";
import { createDefaultAvailabilityWeek, isValidAvailabilityWeek } from "./availability-week";

const snapshot = (revision: number): MemberAvailabilitySnapshot => ({ revision, availability: [] });

test("background refresh preserves the edited week and observed revision until explicit reload", () => {
  let draft = availabilityDraftReducer(EMPTY_AVAILABILITY_DRAFT, { type: "observe", scopeKey: "org-a:member-a", snapshot: snapshot(4) });
  draft = availabilityDraftReducer(draft, { type: "edit", scopeKey: "org-a:member-a", update: (week) => week.map((day) => day.day_of_week === 1 ? { ...day, start_time: "22:00", end_time: "06:00" } : day) });
  const observed = availabilityDraftReducer(draft, { type: "observe", scopeKey: "org-a:member-a", snapshot: snapshot(5) });
  assert.equal(observed, draft);
  assert.equal(observed.revision, 4);
  assert.equal(observed.schedules[1].start_time, "22:00");
  const reloaded = availabilityDraftReducer(observed, { type: "reload", scopeKey: "org-a:member-a", snapshot: snapshot(5) });
  assert.equal(reloaded.revision, 5);
  assert.equal(reloaded.schedules[1].start_time, "08:00");
});

test("switching tenant or member clears the prior draft and ignores late edit callbacks", () => {
  let draft = availabilityDraftReducer(EMPTY_AVAILABILITY_DRAFT, { type: "observe", scopeKey: "org-a:member-a", snapshot: snapshot(4) });
  draft = availabilityDraftReducer(draft, { type: "confirm", scopeKey: "org-a:member-a", confirmed: true });
  draft = availabilityDraftReducer(draft, { type: "observe", scopeKey: "org-b:member-b", snapshot: snapshot(9) });
  assert.equal(draft.revision, 9);
  assert.equal(draft.legacyConfirmed, false);
  const stale = availabilityDraftReducer(draft, { type: "edit", scopeKey: "org-a:member-a", update: () => [] });
  assert.equal(stale, draft);
  assert.equal(stale.schedules.length, 7);
});

test("closing and reopening the same member hydrates the current week", () => {
  let draft = availabilityDraftReducer(EMPTY_AVAILABILITY_DRAFT, { type: "observe", scopeKey: "org-a:member-a", snapshot: snapshot(4) });
  draft = availabilityDraftReducer(draft, { type: "close" });
  assert.equal(draft.revision, null);
  draft = availabilityDraftReducer(draft, { type: "observe", scopeKey: "org-a:member-a", snapshot: snapshot(8) });
  assert.equal(draft.revision, 8);
});

test("a complete legacy week with null active clocks requires both repair and explicit confirmation", () => {
  const availability: MemberAvailabilitySnapshot["availability"] = createDefaultAvailabilityWeek().map((day) => ({ ...day, start_time: null, end_time: null, id: `day-${day.day_of_week}`, team_member_id: "member-a", created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z" }));
  let draft = availabilityDraftReducer(EMPTY_AVAILABILITY_DRAFT, { type: "observe", scopeKey: "org-a:member-a", snapshot: { revision: 4, availability } });
  assert.equal(draft.legacyConfirmed, false);
  assert.equal(draft.reviewReason, "invalid");
  assert.equal(isValidAvailabilityWeek(draft.schedules), false);
  draft = availabilityDraftReducer(draft, { type: "confirm", scopeKey: "org-a:member-a", confirmed: true });
  assert.equal(isValidAvailabilityWeek(draft.schedules), false, "confirmation alone must never invent the missing shift");
  draft = availabilityDraftReducer(draft, { type: "edit", scopeKey: "org-a:member-a", update: (week) => week.map((day) => ({ ...day, start_time: "09:15:30", end_time: "18:45:45" })) });
  assert.equal(isValidAvailabilityWeek(draft.schedules), true);
  assert.equal(draft.schedules[1].start_time, "09:15:30");
});
