import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

function resolveSchema(reference) {
  return document.components.schemas[reference.split("/").at(-1)];
}

test("OpenAPI documents every standalone property-owner operation", () => {
  for (const [path, method] of [
    ["/v1/property-owners", "get"],
    ["/v1/property-owners", "post"],
    ["/v1/property-owners/{id}", "patch"],
    ["/v1/property-owners/{id}", "delete"],
  ]) {
    const operation = document.paths[path]?.[method];
    assert.ok(operation, `${method.toUpperCase()} ${path} is missing`);
    assert.equal(
      operation.parameters[0].$ref,
      "#/components/parameters/OrganizationIdHeader",
    );
  }
});

test("owner pagination is bounded and returns the mutation revision", () => {
  const list = document.paths["/v1/property-owners"].get;
  const limit = list.parameters.find((parameter) => parameter.name === "limit");
  const cursor = list.parameters.find((parameter) => parameter.name === "cursor");
  assert.deepEqual(
    [limit.schema.minimum, limit.schema.maximum, limit.schema.default],
    [1, 100, 50],
  );
  assert.equal(cursor.schema.maxLength, 2048);

  const page = resolveSchema(
    list.responses["200"].content["application/json"].schema.$ref,
  );
  assert.deepEqual(page.required, ["data", "next_cursor", "total_count"]);
  const owner = resolveSchema(page.properties.data.items.$ref);
  assert.ok(owner.required.includes("updated_at"));
  assert.equal(owner.properties.updated_at.format, "date-time");
});

test("owner PATCH and DELETE require expected_updated_at and expose conflicts", () => {
  const itemPath = document.paths["/v1/property-owners/{id}"];
  const update = resolveSchema(
    itemPath.patch.requestBody.content["application/json"].schema.$ref,
  );
  const deletion = resolveSchema(
    itemPath.delete.requestBody.content["application/json"].schema.$ref,
  );

  assert.ok(update.required.includes("expected_updated_at"));
  assert.equal(update.properties.expected_updated_at.format, "date-time");
  assert.deepEqual(deletion.required, ["expected_updated_at"]);
  assert.equal(deletion.additionalProperties, false);
  assert.equal(itemPath.patch.responses["409"].$ref, "#/components/responses/APIError");
  assert.equal(itemPath.delete.responses["409"].$ref, "#/components/responses/APIError");
});
