import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

test("OpenAPI documents lead import distribution controls", () => {
  const schema = document.components.schemas.CreateLeadRequest;

  assert.equal(schema.properties.teamId.format, "uuid");
  assert.equal(schema.properties.importMode.type, "boolean");
  assert.equal(schema.properties.autoDistribute.type, "boolean");
  assert.equal(schema.properties.roundRobinId.format, "uuid");
  assert.match(schema.properties.importMode.description, /lead_import/);
  assert.match(schema.properties.roundRobinId.description, /autoDistribute=true/);
  assert.match(schema.properties.roundRobinId.description, /distribution_manage/);
  assert.equal(schema.required.includes("autoDistribute"), false);
  assert.equal(schema.required.includes("roundRobinId"), false);
});

test("OpenAPI exposes the exact create distribution outcome", () => {
  const schema = document.components.schemas.CreateLeadResponse;

  assert.ok(schema.required.includes("distributionOutcome"));
  assert.deepEqual(schema.properties.distributionOutcome.enum, [
    "assigned",
    "already_assigned",
    "no_matching_queue",
    "no_available_members",
    "skipped",
    "reentry_preserved",
  ]);
  assert.match(schema.properties.distributionOutcome.description, /created but remains without an automatic assignment/);
  assert.match(schema.properties.reentry.description, /prior owner is preserved/);
  assert.match(schema.properties.reentry.description, /not redistributed/);
});
