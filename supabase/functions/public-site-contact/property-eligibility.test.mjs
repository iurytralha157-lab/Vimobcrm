import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalPublicPropertyId,
  publicContactPropertyIsEligible,
} from "./property-eligibility.ts";

const property = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "active",
  published_on_site: true,
};

test("public contact accepts only canonical UUID property references", () => {
  assert.equal(canonicalPublicPropertyId(property.id), property.id);
  assert.equal(canonicalPublicPropertyId(`  ${property.id}  `), property.id);
  assert.equal(canonicalPublicPropertyId("not-a-uuid"), null);
  assert.equal(canonicalPublicPropertyId("10000000-0000-0000-0000-000000000001"), null);
  assert.equal(canonicalPublicPropertyId(null), null);
});

test("legacy publication is accepted only before an authoritative publication row exists", () => {
  assert.equal(publicContactPropertyIsEligible(property, null, false), true);
  assert.equal(
    publicContactPropertyIsEligible(
      property,
      { desired_state: "unpublished", published_version: null },
      false,
    ),
    false,
  );
});

test("versioned publication requires published desired state and a durable published version", () => {
  assert.equal(
    publicContactPropertyIsEligible(
      { ...property, published_on_site: false },
      { desired_state: "published", published_version: 7 },
      true,
    ),
    true,
  );
  assert.equal(
    publicContactPropertyIsEligible(
      property,
      { desired_state: "published", published_version: 7 },
      false,
    ),
    false,
  );
});

test("only active properties can be attached to a public contact", () => {
  for (const status of [
    "sold",
    "rented",
    "reserved",
    "draft",
    "inactive",
    "vendido",
    "locado",
    "reservado",
    "rascunho",
    "arquivado",
    "excluido",
    "unknown",
    "",
    null,
  ]) {
    assert.equal(
      publicContactPropertyIsEligible({ ...property, status }, null, false),
      false,
      String(status),
    );
  }
  assert.equal(
    publicContactPropertyIsEligible({ ...property, status: "ativo" }, null, false),
    true,
  );
});

test("the Edge handler validates public eligibility before any lead mutation", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const validation = source.indexOf("loadPublicContactProperty(supabase, organization_id, property_id)");
  const leadLookup = source.indexOf(".from('leads')");

  assert.ok(validation >= 0, "handler must call the canonical public-property guard");
  assert.ok(leadLookup > validation, "property eligibility must be checked before lead lookup/write");
  assert.match(source, /interest_property_id:\s*validatedPropertyId/);
  assert.doesNotMatch(source, /interest_property_id:\s*property_id/);
  assert.match(source, /\.eq\('id', leadId\)\s*\.eq\('organization_id', organization_id\)/);
});
