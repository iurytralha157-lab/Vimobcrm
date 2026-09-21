import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

test("OpenAPI documents unassigned team filtering on every pipeline board read", () => {
  for (const path of [
    "/v1/pipeline-board",
    "/v1/pipeline-stage-leads",
    "/v1/pipeline-stage-counts",
  ]) {
    const operation = document.paths[path].get;
    const parameter = operation.parameters.find(
      (candidate) => candidate.name === "unassigned",
    );

    assert.equal(parameter?.in, "query", `${path} must expose unassigned as a query parameter`);
    assert.equal(parameter?.schema?.type, "boolean", `${path} must type unassigned as boolean`);

    const teamParameter = operation.parameters?.find(
      (candidate) => candidate.name === "teamId",
    );
    assert.equal(teamParameter?.in, "query", `${path} must expose teamId as a query parameter`);
    assert.equal(teamParameter?.schema?.type, "string", `${path} must type teamId as string`);
    assert.equal(teamParameter?.schema?.format, "uuid", `${path} must type teamId as uuid`);
  }

  assert.deepEqual(
    document.components.schemas.PipelineBoardLead.properties.team_id.type,
    ["string", "null"],
  );
  assert.equal(
    document.components.schemas.PipelineBoardLead.properties.team_id.format,
    "uuid",
  );
  assert.ok(
    document.components.schemas.PipelineBoardLead.required.includes("team_id"),
  );
});
