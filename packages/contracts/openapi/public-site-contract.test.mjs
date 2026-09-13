import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

function requestSchema(operation) {
  const reference =
    operation.requestBody.content["application/json"].schema.$ref;
  return document.components.schemas[reference.split("/").at(-1)];
}

test("public contact endpoint is anonymous and fully documented", () => {
  const operation = document.paths["/v1/public/site/contact"].post;
  assert.deepEqual(operation.security, []);
  assert.deepEqual(Object.keys(operation.responses).sort(), [
    "200",
    "201",
    "400",
    "404",
    "429",
  ]);

  const schema = requestSchema(operation);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "organization_id",
    "name",
    "phone",
    "message",
    "privacy_accepted",
    "submission_id",
  ]);
  assert.equal(schema.properties.session_id.maxLength, 160);
  assert.equal(
    schema.properties.session_id.pattern,
    "^(?!\\s*$)(?!\\s*site-contact:).+",
  );
  assert.equal(schema.properties.privacy_accepted.const, true);
  assert.equal(schema.properties.email.anyOf[1].const, "");
});

test("public tracking endpoint excludes lead_id and constrains duration", () => {
  const operation = document.paths["/v1/public/tracking/events"].post;
  assert.deepEqual(operation.security, []);
  assert.deepEqual(Object.keys(operation.responses).sort(), [
    "201",
    "400",
    "404",
    "429",
  ]);

  const schema = requestSchema(operation);
  assert.equal(schema.additionalProperties, false);
  assert.equal("lead_id" in schema.properties, false);
  assert.equal(
    schema.properties.session_id.pattern,
    "^(?!\\s*$)(?!\\s*site-contact:).+",
  );
  assert.equal(schema.properties.gclid.maxLength, 300);
  assert.equal(schema.properties.fbclid.maxLength, 300);
  assert.deepEqual(schema.properties.event_type.enum, [
    "pageview",
    "page_view",
    "session_start",
    "page_duration",
    "property_search",
    "property_view",
    "favorite",
    "whatsapp_click",
    "cta_click",
  ]);

  const metadata = document.components.schemas.PublicTrackingMetadata;
  assert.equal(metadata.additionalProperties, false);
  assert.equal(metadata.properties.duration_seconds.type, "integer");
  assert.equal(metadata.properties.duration_seconds.minimum, 1);
  assert.equal(metadata.properties.duration_seconds.maximum, 86400);
  assert.equal("search_term" in metadata.properties, false);
  assert.equal("locale" in metadata.properties, false);

  const filters = document.components.schemas.PublicTrackingFilters;
  assert.equal(filters.additionalProperties, false);
  assert.equal("utm_source" in filters.properties, false);
  assert.equal("token" in filters.properties, false);

  const conditional = schema.allOf[0].then.properties.metadata.allOf[1];
  assert.deepEqual(conditional.required, ["duration_seconds"]);
  assert.deepEqual(schema.allOf[0].else.properties.metadata.not.required, [
    "duration_seconds",
  ]);
  assert.deepEqual(schema.allOf[1].else.properties.metadata.not.required, [
    "filters",
  ]);
});
