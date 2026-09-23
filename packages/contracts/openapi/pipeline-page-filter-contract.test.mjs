import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import yaml from "js-yaml";

const document = yaml.load(
  readFileSync("packages/contracts/openapi/v1.yaml", "utf8"),
);

function queryParameter(path, name) {
  return document.paths[path].get.parameters.find((candidate) => {
    if (candidate.name) return candidate.name === name;
    return candidate.$ref?.endsWith(`/${name}`);
  });
}

test("OpenAPI exposes the Facebook Page filter on every shared Meta-filter surface", () => {
  for (const path of [
    "/v1/pipeline-board",
    "/v1/pipeline-stage-leads",
    "/v1/pipeline-stage-counts",
    "/v1/lead-meta-filters",
  ]) {
    const parameter = queryParameter(path, "filterPage");
    assert.equal(parameter?.in, "query", `${path} must expose filterPage`);
    assert.equal(parameter?.schema?.maxLength, 255);
  }

  const contactsPage = queryParameter("/v1/contacts", "pageId");
  assert.equal(contactsPage?.in, "query");
  assert.equal(contactsPage?.schema?.maxLength, 255);

  for (const path of [
    "/v1/dashboard/stats",
    "/v1/dashboard/funnel",
    "/v1/dashboard/sources",
    "/v1/dashboard/top-brokers",
    "/v1/dashboard/lead-distribution",
    "/v1/dashboard/first-contact",
    "/v1/dashboard/deals-evolution",
  ]) {
    assert.equal(
      queryParameter(path, "DashboardPageId")?.$ref,
      "#/components/parameters/DashboardPageId",
      `${path} must reuse DashboardPageId`,
    );
  }

  assert.ok(document.components.schemas.LeadMetaFilters.required.includes("pages"));
  assert.equal(
    document.components.schemas.LeadMetaFilters.properties.pages.items.$ref,
    "#/components/schemas/LeadMetaPageOption",
  );
  assert.deepEqual(document.components.schemas.LeadMeta.properties.page_id.type, ["string", "null"]);
  assert.deepEqual(document.components.schemas.LeadMeta.properties.page_name.type, ["string", "null"]);
});
