import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function section(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing ${start}`);
  assert.ok(endIndex > startIndex, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test("every AI property disclosure path crosses the public-site eligibility boundary", async () => {
  const handler = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  const organizationContext = section(
    handler,
    "async function buildOrganizationContext",
    "function summarizeInventory",
  );
  const directLookup = section(
    handler,
    "async function fetchPropertyById",
    "async function findMentionedProperties",
  );
  const mentionedLookup = section(
    handler,
    "async function findMentionedProperties",
    "async function searchBestProperties",
  );
  const search = section(
    handler,
    "async function searchBestProperties",
    "function propertySelect",
  );

  for (const disclosurePath of [
    organizationContext,
    directLookup,
    mentionedLookup,
    search,
  ]) {
    assert.match(disclosurePath, /filterPublicSiteEligibleProperties\(/);
  }

  assert.match(handler, /"published_on_site"/);
  assert.doesNotMatch(handler, /function isOfferableProperty/);
  assert.doesNotMatch(handler, /currentProperty \? propertyLine\(currentProperty\) : lead\.property_code/);
  assert.match(handler, /startsWith\("ultimo imovel relevante:"\)/);
});
