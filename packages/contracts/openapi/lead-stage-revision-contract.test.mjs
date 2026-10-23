import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const document = yaml.load(readFileSync("packages/contracts/openapi/v1.yaml", "utf8"));

test("stage moves preserve the original revision and expose conflicts to callers", () => {
  const operation = document.paths["/v1/leads/{id}/move-stage"].post;
  const requestRef = operation.requestBody.content["application/json"].schema.$ref;
  const request = document.components.schemas[requestRef.split("/").at(-1)];
  assert.deepEqual(request.required, ["stageId"]);
  assert.equal(request.additionalProperties, false);
  assert.equal(request.properties.expectedUpdatedAt.type, "string");
  assert.equal(request.properties.expectedUpdatedAt.format, "date-time");
  assert.match(request.properties.expectedUpdatedAt.description, /fractional precision/);
  assert.match(request.properties.expectedUpdatedAt.description, /Required.*won or lost/);
  assert.deepEqual(request.properties.expectedStageId.type, ["string", "null"]);
  assert.match(request.properties.expectedStageId.description, /lead_stage_changed/);
  assert.match(operation.responses["409"].description, /do not retry/);
  assert.equal(request.properties.boardOrderAt.format, "date-time");
  assert.equal(request.properties.stageEnteredAt.deprecated, true);
});

test("automation movement accepts only fenced identity and uses a dedicated internal credential", () => {
  const command = document.paths["/v1/internal/automations/stage-command"].post;
  assert.deepEqual(command.security, [{ automationCommandToken: [] }]);
  const request = command.requestBody.content["application/json"].schema;
  assert.deepEqual(request.required, ["organizationId", "executionId", "nodeKey", "leaseToken", "effectKey"]);
  assert.deepEqual(Object.keys(request.properties), request.required);
  assert.equal(request.additionalProperties, false);
  assert.equal(request.properties.leaseToken.writeOnly, true);
  assert.equal(document.components.securitySchemes.automationCommandToken.name, "X-Internal-Token");
  assert.equal(command.responses["200"].content["application/json"].schema.properties.status.const, "succeeded");
  assert.match(command.responses["503"].description, /never advance/);
});

test("column PATCH requires an original revision as well as an actual edit", () => {
  const schema = document.components.schemas.UpdateStageRequest;
  assert.deepEqual(schema.required, ["expectedUpdatedAt"]);
  assert.equal(schema.minProperties, 2);
  assert.equal(schema.properties.expectedUpdatedAt.format, "date-time");
  const patch = document.paths["/v1/stages/{id}"].patch;
  assert.ok(patch.responses["409"]);
  assert.match(patch.description, /pipeline_stages_changed/);
  assert.match(patch.description, /stage_has_automation_dependencies/);
});
