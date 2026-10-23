import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

test("team reads and writes expose a safe monotonic revision", () => {
  const team = document.components.schemas.Team;
  assert.ok(team.required.includes("revision"));
  assert.equal(team.properties.revision.type, "integer");
  assert.equal(team.properties.revision.format, "int64");
  assert.equal(team.properties.revision.minimum, 1);
  assert.equal(team.properties.revision.maximum, Number.MAX_SAFE_INTEGER);

  for (const [path, method, success] of [
    ["/v1/teams", "get", "200"],
    ["/v1/teams", "post", "201"],
    ["/v1/teams/{id}", "get", "200"],
    ["/v1/teams/{id}", "patch", "200"],
    ["/v1/teams/{id}/status", "patch", "200"],
  ]) {
    const operation = document.paths[path][method];
    const responseRef = operation.responses[success].content["application/json"].schema.$ref;
    const response = document.components.schemas[responseRef.split("/").at(-1)];
    const dataRef = method === "get" && path === "/v1/teams"
      ? response.properties.data.items.$ref
      : response.properties.data.$ref;
    assert.equal(dataRef, "#/components/schemas/Team", `${method} ${path}`);
  }
});

test("team PATCH requires a revision and documents its stable conflict", () => {
  const patch = document.paths["/v1/teams/{id}"].patch;
  const requestRef = patch.requestBody.content["application/json"].schema.$ref;
  const request = document.components.schemas[requestRef.split("/").at(-1)];
  assert.deepEqual(request.required, ["expected_revision"]);
  assert.equal(request.minProperties, 2);
  assert.equal(request.additionalProperties, false);
  assert.equal(request.properties.expected_revision.type, "integer");
  assert.equal(request.properties.expected_revision.minimum, 1);
  assert.equal(request.properties.expected_revision.maximum, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(request.dependentRequired.members, ["expected_member_ids"]);
  assert.deepEqual(request.dependentRequired.memberIds, ["expected_member_ids"]);
  assert.equal(request.properties.expected_member_ids.type, "array");
  assert.equal(request.properties.expected_member_ids.uniqueItems, true);
  assert.equal(request.properties.expected_member_ids.items.format, "uuid");
  assert.equal(request.anyOf.length, 5);
  assert.ok(!request.anyOf.some(({ required }) => required.includes("expected_revision")));

  const conflictSchema = patch.responses["409"].content["application/json"].schema;
  assert.deepEqual(conflictSchema.oneOf.map(({ $ref }) => $ref).sort(), [
    "#/components/schemas/TeamQueueSyncErrorEnvelope",
    "#/components/schemas/TeamRevisionConflictErrorEnvelope",
  ]);
  const conflictRef = conflictSchema.oneOf.find(({ $ref }) =>
    $ref === "#/components/schemas/TeamRevisionConflictErrorEnvelope").$ref;
  const conflict = document.components.schemas[conflictRef.split("/").at(-1)];
  assert.equal(conflict.properties.error.properties.code.const, "team_revision_conflict");
  assert.deepEqual(conflict.properties.error.required, ["code", "message"]);
});

test("team create and update reject both member list formats together", () => {
  for (const schemaName of ["CreateTeamRequest", "UpdateTeamRequest"]) {
    const request = document.components.schemas[schemaName];
    assert.deepEqual(request.not.required, ["members", "memberIds"], schemaName);
    assert.ok(request.properties.members, schemaName);
    assert.ok(request.properties.memberIds, schemaName);
  }
});
