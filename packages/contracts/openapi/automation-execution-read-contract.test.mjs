import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const document = yaml.load(readFileSync(new URL("./v1.yaml", import.meta.url), "utf8"));
const route = "/v1/automation-executions";

function items(operation) {
  const envelope = operation.responses["200"].content["application/json"].schema;
  assert.deepEqual(envelope.required, ["data"]);
  assert.equal(envelope.properties.data.type, "array");
  return envelope.properties.data.items;
}

test("execution summaries separate complete totals from bounded active IDs", () => {
  const summary = document.paths[`${route}/summary`].get;
  assert.deepEqual(summary.parameters, [{ $ref: "#/components/parameters/OrganizationIdHeader" }]);
  const { required, properties } = items(summary);
  assert.deepEqual(required, Object.keys(properties));
  assert.equal(properties.activeExecutionIds.maxItems, 100);
  assert.equal(properties.activeIdsTruncated.type, "boolean");
  assert.deepEqual(properties.lastStartedAt.type, ["string", "null"]);
  assert.equal(properties.lastStartedAt.format, undefined);
  for (const count of ["total", "queued", "running", "waiting", "completed", "failed", "cancelled"]) {
    assert.deepEqual(properties[count], { type: "integer", minimum: 0 });
  }
});

test("execution steps expose a scoped execution ID and pagination limits", () => {
  const operation = document.paths[`${route}/{id}/steps`].get;
  const [organization, id, limit, offset] = operation.parameters;
  assert.equal(organization.$ref, "#/components/parameters/OrganizationIdHeader");
  assert.deepEqual(id, { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } });
  assert.deepEqual(limit.schema, { type: "integer", minimum: 1, maximum: 200, default: 50 });
  assert.deepEqual(offset.schema, { type: "integer", minimum: 0, maximum: 10000, default: 0 });
  const { required, properties } = items(operation);
  assert.deepEqual(required, Object.keys(properties));
  for (const nullable of ["action_type", "completed_at", "error_message"]) {
    assert.deepEqual(properties[nullable].type, ["string", "null"]);
  }
  assert.equal(properties.started_at.type, "string");
  for (const field of ["started_at", "completed_at"]) {
    assert.equal(properties[field].format, undefined);
  }
});
