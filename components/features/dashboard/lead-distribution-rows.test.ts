import assert from "node:assert/strict";
import test from "node:test";

import { visibleBrokerDistributionRows } from "./lead-distribution-rows";

const users = [
  { id: "broker-1", kind: "entity" as const, name: "Ana", avatarUrl: null, leadCount: 3 },
  { id: "broker-2", kind: "entity" as const, name: "Bruno", avatarUrl: null, leadCount: 0 },
  { id: null, kind: "unassigned" as const, name: "Sem responsável", avatarUrl: null, leadCount: 2 },
];

test("broker chart shows only brokers with leads without an unassigned footer cohort", () => {
  assert.deepEqual(visibleBrokerDistributionRows(users), [
    { id: "broker-1", kind: "entity", name: "Ana", avatarUrl: null, leadCount: 3 },
  ]);
  assert.deepEqual(visibleBrokerDistributionRows(users, "all"), visibleBrokerDistributionRows(users));
});

test("unassigned filter shows exactly the filtered unassigned count without inventing a broker", () => {
  assert.deepEqual(visibleBrokerDistributionRows(users, "unassigned"), [
    { id: "unassigned", kind: "unassigned", name: "Sem responsável", avatarUrl: null, leadCount: 2 },
  ]);
  assert.deepEqual(visibleBrokerDistributionRows(users.filter((row) => row.kind !== "unassigned"), "unassigned"), []);
});

test("selected broker keeps only that broker even if a stale response contains others", () => {
  assert.deepEqual(visibleBrokerDistributionRows(users, "broker-1").map((row) => row.id), ["broker-1"]);
  assert.deepEqual(visibleBrokerDistributionRows(users, "broker-2"), []);
});
