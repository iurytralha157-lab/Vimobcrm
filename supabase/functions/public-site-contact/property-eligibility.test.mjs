import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalPublicPropertyId,
  publicContactPropertyIsEligible,
} from "./property-eligibility.ts";

const property = {
  id: "10000000-0000-4000-8000-000000000001",
  organization_id: "20000000-0000-4000-8000-000000000001",
  status: "active",
  published_on_site: true,
};

function publication(overrides = {}) {
  return { id: "30000000-0000-4000-8000-000000000001", organization_id: property.organization_id,
    property_id: property.id, channel: "site", channel_account_key: "default", desired_state: "published", published_version: 7,
    ...overrides };
}

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
      publication({ desired_state: "unpublished", published_version: null }),
      false,
    ),
    false,
  );
});

test("versioned publication requires published desired state and a durable published version", () => {
  assert.equal(
    publicContactPropertyIsEligible(
      { ...property, published_on_site: false },
      publication(),
      true,
    ),
    true,
  );
  assert.equal(
    publicContactPropertyIsEligible(
      property,
      publication(),
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

test("the retired Edge endpoint cannot restore a second lead writer", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /status:\s*410/);
  assert.match(source, /public_site_contact_endpoint_retired/);
  assert.doesNotMatch(source, /\.from\(['"]leads['"]\)|\.insert\(|\.update\(/);
});

test("a first delivery preserves only a same-tenant authorized legacy listing", () => {
  const pending = publication({ published_version: null });
  assert.equal(publicContactPropertyIsEligible(property, pending, false), true);
  for (const bad of [{ ...pending, organization_id: "other" }, { ...pending, desired_state: "unpublished" },
    { ...pending, desired_state: "paused" }, { ...pending, channel_account_key: "other" }]) {
    assert.equal(publicContactPropertyIsEligible(property, bad, false), false);
  }
  assert.equal(publicContactPropertyIsEligible({ ...property, autorizado_comercializacao: false }, pending, false), false);
  assert.equal(publicContactPropertyIsEligible({ ...property, autorizado_comercializacao: false }, publication(), true), false);
  for (const status of ["active", "ativo", "available", "disponivel"]) {
    assert.equal(publicContactPropertyIsEligible({ ...property, status, autorizado_comercializacao: null }, pending, false), true);
  }
});
