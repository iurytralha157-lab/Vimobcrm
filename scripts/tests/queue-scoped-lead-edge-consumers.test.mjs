import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const threeCPlusSource = await readFile(
  new URL("../../supabase/functions/threecplus-webhook/index.ts", import.meta.url),
  "utf8",
);

test("3C Plus fails closed when a phone belongs to multiple queue-scoped cards", () => {
  assert.match(threeCPlusSource, /\.rpc\(\s*['"]find_lead_by_normalized_phone['"]/);
  assert.match(threeCPlusSource, /leadLookupError\.code\s*===\s*['"]23505['"]/);
  assert.match(threeCPlusSource, /whatsapp_lead_phone_ambiguous/);
  assert.doesNotMatch(
    threeCPlusSource,
    /\.from\(['"]leads['"]\)[\s\S]{0,500}\.limit\(1\)/,
  );
});

test("3C Plus preserves the call card snapshot and tenant-scopes callbacks", () => {
  assert.match(
    threeCPlusSource,
    /\.from\(['"]telephony_calls['"]\)[\s\S]{0,300}\.select\(['"]lead_id, user_id['"]\)[\s\S]{0,300}\.eq\(['"]organization_id['"], organizationId\)[\s\S]{0,200}\.eq\(['"]external_call_id['"], call_id\)/,
  );

  const organizationGuards = threeCPlusSource.match(
    /\.eq\(['"]organization_id['"], organizationId\)/g,
  ) ?? [];
  assert.ok(
    organizationGuards.length >= 5,
    `expected the lookup and every callback write to be tenant-scoped, found ${organizationGuards.length}`,
  );

  const snapshotLookup = threeCPlusSource.indexOf(".select('lead_id, user_id')");
  const phoneLookup = threeCPlusSource.indexOf(".rpc(\n        'find_lead_by_normalized_phone'");
  assert.ok(snapshotLookup >= 0, "expected an existing-call snapshot lookup");
  assert.ok(
    phoneLookup > snapshotLookup,
    "existing-call snapshot must be resolved before any phone lookup",
  );
  assert.match(threeCPlusSource, /if \(!existingCallFound && phoneToSearch\)/);
});
