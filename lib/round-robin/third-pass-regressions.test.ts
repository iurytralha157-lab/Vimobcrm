import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyDistributionQueueFormData, hydrateDistributionQueueFormData, type ExistingDistributionQueue } from "./distribution-queue-form";
import { hasQueueRedistributionCapacity, hasValidQueueCriteria, hasValidQueueDestination, queueMutationCollections, queueRedistributionCapacity, queueSnapshotPreservation } from "./queue-snapshot";
import { distributionDraftKey, readDistributionDraftRecovery, saveDistributionDraft } from "./pending-draft";
import { createQueueOperatingSchedule } from "./operating-schedule";

test("managed redistribution accepts zero/one eligible while legacy still requires an alternative", () => {
  for (const eligible of [0, 1, 2, null]) {
    assert.equal(hasQueueRedistributionCapacity({ enable_redistribution: true, operating_schedule: createQueueOperatingSchedule() }, eligible), true);
    assert.equal(hasQueueRedistributionCapacity({ enable_redistribution: false }, eligible), true);
    assert.equal(hasQueueRedistributionCapacity({ enable_redistribution: true }, eligible), eligible === null || eligible >= 2);
  }
});

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const rule = "33333333-3333-4333-8333-333333333333";
const queue: ExistingDistributionQueue = {
  id: rule, revision: 3, name: "Shared", eligible_user_count: 2,
  rules: [{ id: rule, match_type: "campaign_contains", match_value: "Alpha, Beta", match: { campaign_name_contains_literals: ["Alpha, Beta"] } }],
  members: [{ id: a, user_id: a, weight: 10, is_active: true }, { id: b, user_id: b, weight: 10, is_active: true }],
};

test("shared queues use the authoritative count while preserving outsiders", () => {
  const form = hydrateDistributionQueueFormData(queue, []);
  assert.equal(queueRedistributionCapacity(form.members, queue, [], [a], true), 2);
  form.members[0].weight = 25;
  assert.equal(queueRedistributionCapacity(form.members, queue, [], [a], true), 2, "weights do not change eligible identities");
  assert.equal(queueSnapshotPreservation(form, queue).preserveMemberSnapshot, false);
  form.members.push({ type: "user", entityId: rule, weight: 10, isActive: true });
  assert.equal(queueRedistributionCapacity(form.members, queue, [], [a, rule], true), null, "an outsider's overlap must be validated by server");
  assert.equal(queueRedistributionCapacity(hydrateDistributionQueueFormData(queue, []).members, { ...queue, eligible_user_count: undefined }, [], [a], true), null, "mixed rollout must not guess");
});

test("snapshot preservation is derived from loaded fields rather than recovery flags", () => {
  const form = hydrateDistributionQueueFormData(queue, []);
  assert.deepEqual(queueSnapshotPreservation(form, queue), { preserveRuleSnapshot: true, preserveMemberSnapshot: true });
  form.conditions[0].values = ["Changed"];
  form.conditions[0].originalFingerprint = JSON.stringify(["campaign_contains", ["Changed"], ""]);
  form.preserveRuleSnapshot = true;
  assert.equal(queueSnapshotPreservation(form, queue).preserveRuleSnapshot, false);
  form.members[1].reenroll = true;
  form.preserveMemberSnapshot = true;
  assert.equal(queueSnapshotPreservation(form, queue).preserveMemberSnapshot, false);
  assert.equal(queueRedistributionCapacity(form.members, queue, [], [a], true), null);
});

test("rename omits unchanged collections and internal flags; create always includes its roster and rules", () => {
  const form = hydrateDistributionQueueFormData(queue, []);
  form.name = "Renamed";
  Object.assign(form, queueSnapshotPreservation(form, queue));
  assert.deepEqual(queueMutationCollections(form, true), {});
  const creating = queueMutationCollections(form);
  assert.equal(creating.members?.length, 2);
  assert.equal(creating.rules?.length, 1);
  assert.equal("preserveRuleSnapshot" in creating, false);
  assert.equal("preserveMemberSnapshot" in creating, false);
  form.members[0].weight = 22;
  Object.assign(form, queueSnapshotPreservation(form, queue));
  const updating = queueMutationCollections(form, true);
  assert.equal(updating.members?.[0].weight, 22);
  assert.equal("rules" in updating, false, "unchanged virtual/legacy rules must not materialize");
});

test("global and ruleless legacy destinations can be retained without inventing a target", () => {
  const global: ExistingDistributionQueue = { id: a, name: "Global", rules: [], members: [] };
  const form = hydrateDistributionQueueFormData(global, []);
  form.name = "Renamed";
  assert.equal(hasValidQueueDestination(form, global), true);
  assert.equal(hasValidQueueCriteria(form, global), true);
  assert.equal(hasValidQueueDestination(form), false);
  assert.equal(hasValidQueueCriteria(form), false);
  form.target_pipeline_id = a;
  assert.equal(hasValidQueueDestination(form, global), false, "changing destination requires a complete target");
  const previouslyTargeted = { ...global, target_pipeline_id: a, target_stage_id: b };
  assert.equal(hasValidQueueDestination(createEmptyDistributionQueueFormData(), previouslyTargeted), false, "cannot erase a destination via legacy exception");
  form.conditions = [{ id: "new", type: "city", values: [] }];
  assert.equal(hasValidQueueCriteria(form, global), false);
});

function storageFixture() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("valid long campaign values and raw fingerprints remain recoverable", () => {
  const storage = storageFixture();
  const form = hydrateDistributionQueueFormData({
    ...queue,
    rules: [{ id: rule, match_type: "campaign_contains", match_value: "x".repeat(18099), match: { campaign_name_contains_literals: ["x".repeat(18099)] } }],
  }, []);
  form.name = "Unsaved";
  assert.ok(form.conditions[0].originalFingerprint!.length > 10000);
  const key = distributionDraftKey(a, b, rule)!;
  assert.equal(saveDistributionDraft(storage, key, form, 1800000000000), true);
  const recovered = readDistributionDraftRecovery(storage, key, 1800000001000);
  assert.equal(recovered?.status, "ready");
  if (recovered?.status !== "ready") assert.fail("long valid draft lost");
  assert.equal(recovered.form.conditions[0].values[0].length, 18099);
});

test("large legacy collections are recoverable but a byte quota failure is explicit", () => {
  const storage = storageFixture();
  const form = hydrateDistributionQueueFormData(queue, []);
  form.members = Array.from({ length: 501 }, () => ({ ...form.members[0] }));
  form.conditions = Array.from({ length: 201 }, () => ({ ...form.conditions[0] }));
  const key = distributionDraftKey(a, b, rule)!;
  assert.equal(saveDistributionDraft(storage, key, form, 1800000000000), true);
  form.conditions[0].values = ["🌇".repeat(260000)];
  const previous = storage.getItem(key);
  assert.equal(saveDistributionDraft(storage, key, form, 1800000000001), false);
  assert.equal(storage.getItem(key), previous, "failed byte-bound save must not replace the recoverable snapshot");
  const blocked = { ...storage, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(saveDistributionDraft(blocked, key, hydrateDistributionQueueFormData(queue, [])), false);
});

