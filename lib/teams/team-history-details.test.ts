import assert from "node:assert/strict";
import test from "node:test";
import { getTeamHistoryDetails } from "./team-history-details";
import type { TeamHistoryEvent } from "@/lib/api/teams";

function event(changes: Partial<TeamHistoryEvent>): TeamHistoryEvent {
  return { id: "audit-event", entity_id: "member-id", entity_type: "team_member_availability", action: "update", created_at: "2026-10-12T00:00:00Z", ...changes };
}

test("availability details show the day, prior window and midnight rollover without raw IDs", () => {
  const details = getTeamHistoryDetails(event({
    old_data: { team_member_id: "private-member-id", day_of_week: 1, start_time: "08:00:00", end_time: "18:00:00", is_active: true },
    new_data: { team_member_id: "private-member-id", day_of_week: 1, start_time: "22:00:00", end_time: "06:00:00", is_active: true },
  }));
  assert.deepEqual(details, [{ label: "Segunda-feira", before: "08:00 – 18:00", after: "22:00 – 06:00 (+1 dia)" }]);
  assert.equal(JSON.stringify(details).includes("private-member-id"), false);
});

test("team change descriptions whitelist relevant fields and preserve before/after", () => {
  const details = getTeamHistoryDetails(event({ entity_type: "team", old_data: { name: "Equipe anterior", logo_url: "https://private.example/old" }, new_data: { name: "Equipe atual", logo_url: "https://private.example/new", secret_field: "internal" }, diff: { name: { old: "Equipe anterior", new: "Equipe atual" }, logo_url: {}, secret_field: {} } }));
  assert.deepEqual(details, [{ label: "Nome", before: "Equipe anterior", after: "Equipe atual" }, { label: "Logo", before: "Logo definida", after: "Logo definida" }]);
  assert.equal(JSON.stringify(details).includes("private.example"), false);
});

test("history shows saved seconds instead of rounding an audited shift", () => {
  const details = getTeamHistoryDetails(event({ old_data: { day_of_week: 1, start_time: "09:15:30", end_time: "18:45:45", is_active: true }, new_data: { day_of_week: 1, start_time: "08:00:01", end_time: "08:00:02", is_active: true } }));
  assert.deepEqual(details, [{ label: "Segunda-feira", before: "09:15:30 – 18:45:45", after: "08:00:01 – 08:00:02" }]);
});
