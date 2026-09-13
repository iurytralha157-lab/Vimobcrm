import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

const adminOperations = [
  ["/v1/integrations/portals/chaves-na-mao", "get"],
  ["/v1/integrations/portals/chaves-na-mao", "put"],
  ["/v1/integrations/portals/chaves-na-mao/activate", "post"],
  ["/v1/integrations/portals/chaves-na-mao/pause", "post"],
  ["/v1/integrations/portals/chaves-na-mao/regenerate-feed-token", "post"],
  ["/v1/integrations/portals/chaves-na-mao/publications", "get"],
  ["/v1/integrations/portals/chaves-na-mao/publications", "put"],
];

test("OpenAPI documents every dedicated Chaves na Mão management operation", () => {
  for (const [path, method] of adminOperations) {
    const operation = document.paths[path]?.[method];
    assert.ok(operation, `${method.toUpperCase()} ${path} is missing`);
    assert.equal(
      operation.parameters[0].$ref,
      "#/components/parameters/OrganizationIdHeader",
    );
    assert.equal(
      operation.responses["503"].$ref,
      "#/components/responses/ChavesNaMaoHomologationRequired",
    );
  }
});

test("Chaves na Mão contract is publication-only and fail-closed", () => {
  const schemas = document.components.schemas;
  assert.equal(
    schemas.ChavesNaMaoIntegration.properties.lead_webhook_available.const,
    false,
  );
  assert.deepEqual(
    schemas.ChavesNaMaoPublicationSetting.properties.publicationType.enum,
    ["STANDARD", "FEATURED"],
  );
  assert.equal(
    schemas.ChavesNaMaoPublicationSettingsRequest.properties.publications
      .maxItems,
    1000,
  );
  assert.equal(
    schemas.ChavesNaMaoHomologationRequiredErrorEnvelope.properties.error
      .properties.code.const,
    "chaves_na_mao_homologation_required",
  );

  const chavesPaths = Object.keys(document.paths).filter((path) =>
    path.includes("chaves-na-mao"),
  );
  assert.equal(chavesPaths.some((path) => path.includes("/leads")), false);
});

test("public Chaves na Mão feed is tokenized XML without a lead webhook", () => {
  const operation =
    document.paths[
      "/v1/public/integrations/portals/chaves-na-mao/feed/{token}"
    ].get;
  assert.deepEqual(operation.security, []);
  assert.equal(
    operation.parameters[0].$ref,
    "#/components/parameters/ChavesNaMaoFeedToken",
  );
  assert.equal(
    operation.responses["200"].content["application/xml"].schema.type,
    "string",
  );
  assert.match(
    operation.responses["503"].description,
    /chaves_na_mao_homologation_required/,
  );
});
