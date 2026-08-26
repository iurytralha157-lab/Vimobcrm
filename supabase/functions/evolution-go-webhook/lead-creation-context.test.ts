import { hasVerifiedMetaAdLeadCreationContext } from "./lead-creation-context.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const currentOrganizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const importedAdId = "123456789012345";

function importedAdLookup(entries: string[]) {
  const imported = new Set(entries);
  return async (organizationId: string, sourceId: string) =>
    imported.has(`${organizationId}:${sourceId}`);
}

Deno.test("rejects missing, incomplete and untrusted Meta referral contexts", async () => {
  let lookupCalls = 0;
  const lookup = async () => {
    lookupCalls += 1;
    return true;
  };

  const cases = [
    { name: "missing referral", referral: null },
    {
      name: "ctwa-only referral",
      referral: { explicit_source_type: "ad", ctwa_clid: "click-id" },
    },
    {
      name: "arbitrary source id",
      referral: { explicit_source_type: "ad", source_id: "external-ref" },
    },
    {
      name: "non-ad source type",
      referral: { explicit_source_type: "ctwa", source_id: importedAdId },
    },
  ];

  for (const testCase of cases) {
    const verified = await hasVerifiedMetaAdLeadCreationContext(
      currentOrganizationId,
      testCase.referral,
      lookup,
    );
    assert(!verified, `${testCase.name} was accepted`);
  }

  assert(
    lookupCalls === 0,
    `invalid referrals triggered ${lookupCalls} lookup(s)`,
  );
});

Deno.test("requires the imported ad to belong to the current organization", async () => {
  const referral = {
    explicit_source_type: "ad",
    source_id: importedAdId,
  };
  const lookup = importedAdLookup([
    `${otherOrganizationId}:${importedAdId}`,
  ]);

  assert(
    !(await hasVerifiedMetaAdLeadCreationContext(
      currentOrganizationId,
      referral,
      lookup,
    )),
    "an ad imported by another organization was accepted",
  );
  assert(
    await hasVerifiedMetaAdLeadCreationContext(
      otherOrganizationId,
      referral,
      lookup,
    ),
    "the organization that imported the ad was rejected",
  );
});

Deno.test("accepts only a numeric imported ad in the same organization", async () => {
  const lookup = importedAdLookup([
    `${currentOrganizationId}:${importedAdId}`,
  ]);

  assert(
    await hasVerifiedMetaAdLeadCreationContext(
      currentOrganizationId,
      { explicit_source_type: "ad", source_id: importedAdId },
      lookup,
    ),
    "a verified Meta ad was rejected",
  );
  assert(
    !(await hasVerifiedMetaAdLeadCreationContext(
      currentOrganizationId,
      { explicit_source_type: "ads", source_id: importedAdId },
      lookup,
    )),
    "a non-exact ad source type was accepted",
  );
});
