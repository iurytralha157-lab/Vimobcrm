import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);
const propertyWorkspaceProjectionSource = readFileSync(
  "apps/api/internal/properties/workspace_projection.go",
  "utf8",
);
const propertyPrivacySource = readFileSync(
  "apps/api/internal/properties/privacy.go",
  "utf8",
);
const meRepositorySource = readFileSync(
  "apps/api/internal/me/repository.go",
  "utf8",
);

function resolveSchema(reference) {
  return document.components.schemas[reference.split("/").at(-1)];
}

test("property settings PATCH is strict, partial and permission-aware", () => {
  const operation = document.paths["/v1/settings/properties"].patch;
  assert.deepEqual(Object.keys(operation.responses).sort(), [
    "200",
    "400",
    "403",
    "409",
  ]);
  assert.equal(
    operation.parameters[0].$ref,
    "#/components/parameters/OrganizationIdHeader",
  );

  const requestSchema = resolveSchema(
    operation.requestBody.content["application/json"].schema.$ref,
  );
  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(requestSchema.minProperties, 2);
  assert.deepEqual(requestSchema.required, ["expected_updated_at"]);
  assert.equal(
    requestSchema.properties.expected_updated_at.format,
    "date-time",
  );
  assert.deepEqual(requestSchema.properties.property_edit_policy.enum, [
    "everyone",
    "responsible_or_admin",
  ]);
  assert.deepEqual(
    requestSchema.properties.property_owner_contact_visibility.enum,
    ["visible", "hidden"],
  );
  assert.equal(requestSchema.properties.property_edit_policy.nullable, undefined);

  const responseSchema = resolveSchema(
    operation.responses["200"].content["application/json"].schema.$ref,
  );
  assert.deepEqual(responseSchema.required, ["ok", "updated_at"]);
  assert.equal(responseSchema.additionalProperties, false);
  assert.equal(responseSchema.properties.ok.const, true);
  assert.equal(responseSchema.properties.updated_at.format, "date-time");

  const conflictSchema = resolveSchema(
    operation.responses["409"].content["application/json"].schema.$ref,
  );
  assert.equal(
    conflictSchema.properties.error.properties.code.const,
    "property_settings_conflict",
  );
});

test("profile contract exposes the organization revision used by property settings", () => {
  const operation = document.paths["/v1/me/profile"].get;
  const responseSchema = resolveSchema(
    operation.responses["200"].content["application/json"].schema.$ref,
  );
  const organizationReference = responseSchema.properties.organization.oneOf[0].$ref;
  const organizationSchema = resolveSchema(organizationReference);

  assert.ok(organizationSchema.required.includes("updated_at"));
  assert.equal(organizationSchema.properties.updated_at.format, "date-time");
  assert.match(meRepositorySource, /'updated_at', o\.updated_at/);
});

test("property list, detail and update require edit capability while create stays base", () => {
  for (const operation of [
    document.paths["/v1/properties"].get,
    document.paths["/v1/properties/{id}"].get,
  ]) {
    assert.equal(
      operation.responses["200"].headers["Cache-Control"].$ref,
      "#/components/headers/PropertyWorkspaceCacheControl",
    );
    assert.equal(
      operation.responses["200"].headers.Vary.$ref,
      "#/components/headers/PropertyWorkspaceVary",
    );
  }
  const capabilitySchema = document.components.schemas.PropertyWithCapabilities;
  assert.equal(
    capabilitySchema.allOf[0].$ref,
    "#/components/schemas/Property",
  );
  assert.deepEqual(capabilitySchema.allOf[1].required, [
    "can_edit",
    "managed_terms",
  ]);
  assert.equal(capabilitySchema.allOf[1].properties.can_edit.type, "boolean");
  assert.equal(
    capabilitySchema.allOf[1].properties.managed_terms.$ref,
    "#/components/schemas/PropertyManagedTerms",
  );
  assert.equal(
    document.components.schemas.PropertyListResponse.properties.data.items.$ref,
    "#/components/schemas/PropertyWithCapabilities",
  );
  assert.equal(
    document.components.schemas.PropertyResponse.properties.data.$ref,
    "#/components/schemas/PropertyWithCapabilities",
  );
  assert.equal(
    document.components.schemas.PropertyCreateResponse.properties.data.$ref,
    "#/components/schemas/Property",
  );
  assert.equal(
    document.paths["/v1/properties"].post.responses["201"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/PropertyCreateResponse",
  );
  assert.equal(
    document.paths["/v1/properties/{id}"].get.responses["200"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/PropertyResponse",
  );
  assert.equal(
    document.paths["/v1/properties/{id}"].patch.responses["200"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/PropertyResponse",
  );
});

function goStringSlice(source, name) {
  const match = source.match(
    new RegExp(`var ${name} = \\[\\]string\\{([\\s\\S]*?)\\n\\}`),
  );
  assert.ok(match, `${name} não foi encontrado`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

test("workspace OpenAPI enumerates every role-aware property projection field", () => {
  const projectedFields = new Set([
    ...goStringSlice(propertyWorkspaceProjectionSource, "workspacePropertyBaseFields"),
    ...goStringSlice(propertyWorkspaceProjectionSource, "workspacePropertyInternalFields"),
    ...goStringSlice(propertyPrivacySource, "propertyOwnerContactFields"),
  ]);
  assert.deepEqual(
    Object.keys(document.components.schemas.PropertyWorkspaceProperty.properties).sort(),
    [...projectedFields].sort(),
  );

  const meta = document.components.schemas.PropertyWorkspaceMeta;
  assert.deepEqual(Object.keys(meta.properties).sort(), [
    "can_manage",
    "can_view_confidential",
    "can_view_owner_contacts",
    "development_link_available",
    "has_asset_photos",
    "normalized_resources_available",
    "unavailable_resources",
  ]);
});
