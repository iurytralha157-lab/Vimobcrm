import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyDistributionQueueFormData, distributionQueueRuleInputs, getDistributionQueueEligibleUserIds, hydrateDistributionQueueFormData, normalizeExistingDistributionQueue, sanitizeDistributionQueueConditions } from "./distribution-queue-form";
import { clearDistributionDraftsForUser, distributionDraftKey, readDistributionDraft, readDistributionDraftRecovery, saveDistributionDraft } from "./pending-draft";
import { addRoundRobinMemberInputSchema, createRoundRobinRuleInputSchema, updateRoundRobinInputSchema, updateRoundRobinMemberInputSchema } from "../validation/crm-support";
import { canEditQueueMember, isUnchangedQueueMember, moveEditableQueueMember, queueMemberKey, type QueueMemberDraft } from "./member-context";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const RULE = "33333333-3333-4333-8333-333333333333";

test("17 and 100 selected tags survive hydration, rename and request validation", () => {
  for (const count of [17, 100]) {
    const values = Array.from({ length: count }, (_, index) => `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`);
    const raw = values.join(",");
    const form = hydrateDistributionQueueFormData({ revision: 7, name: "Queue", rules: [{ id: RULE, match_type: "tag", match_value: raw, match: { tags: values } }] }, []);
    form.name = "Renamed queue";
    assert.deepEqual(form.conditions[0].values, values);
    const request = distributionQueueRuleInputs(form.conditions);
    assert.deepEqual(request.conditions, []);
    const payload = updateRoundRobinInputSchema.parse({ expectedRevision: 7, name: form.name, rules: request.rules.map((rule) => ({ id: rule.id, matchType: rule.match_type, matchValue: rule.match_value, match: rule.match })) });
    assert.equal(payload.rules?.[0].matchValue, raw);
  }
});

test("campaign literals containing commas roundtrip while old CSV retains its old semantics", () => {
  const literal = "Lançamento, Centro";
  const modern = hydrateDistributionQueueFormData({ rules: [{ id: RULE, match_type: "campaign_contains", match_value: literal, match: { campaign_name_contains_literals: [literal] } }] }, []);
  assert.deepEqual(modern.conditions[0].values, [literal]);
  assert.equal(distributionQueueRuleInputs(modern.conditions).rules[0].match_value, literal);
  modern.conditions[0].values = ["Novo, Centro"];
  assert.deepEqual(distributionQueueRuleInputs(modern.conditions).conditions[0].values, ["Novo, Centro"]);
  const legacy = hydrateDistributionQueueFormData({ rules: [{ id: RULE, match_type: "campaign_contains", match_value: literal, match: { campaign_name_contains: "Lançamento" } }] }, []);
  assert.deepEqual(legacy.conditions[0].values, ["Lançamento", "Centro"]);
  assert.deepEqual(distributionQueueRuleInputs(legacy.conditions).rules[0].match, { campaign_name_contains: "Lançamento" });
});

test("out-of-scope participants remain read-only and cannot be moved across", () => {
  const members = [{ id: USER_A, type: "user" as const, entityId: USER_A, weight: 10, isActive: true }, { id: USER_B, type: "user" as const, entityId: USER_B, weight: 20, isActive: false }, { id: RULE, type: "user" as const, entityId: RULE, weight: 10, isActive: true }];
  const editable = (member: QueueMemberDraft) => canEditQueueMember(member, [USER_A, RULE], []);
  assert.equal(editable(members[0]), true);
  assert.equal(editable(members[1]), false);
  assert.equal(isUnchangedQueueMember(members[1], { id: USER_B, user_id: USER_B, weight: 20, is_active: false }), true);
  assert.equal(isUnchangedQueueMember({ ...members[1], weight: 21 }, { id: USER_B, user_id: USER_B, weight: 20 }), false);
  assert.equal(isUnchangedQueueMember({ ...members[1], reenroll: true }, { id: USER_B, user_id: USER_B, weight: 20 }), false);
  assert.equal(moveEditableQueueMember(members, queueMemberKey(members[0]), queueMemberKey(members[2]), editable), members);
  assert.equal(canEditQueueMember({ ...members[0], teamId: USER_B }, [USER_A], []), false);
});

test("new member transports preserve false and integer overflow fails before API", () => {
  assert.equal(addRoundRobinMemberInputSchema.parse({ expectedRevision: 1, userId: USER_A, isActive: false }).isActive, false);
  assert.equal(updateRoundRobinMemberInputSchema.safeParse({ expectedRevision: 1, position: 2_147_483_647 }).success, true);
  assert.equal(updateRoundRobinMemberInputSchema.safeParse({ expectedRevision: 1, position: 2_147_483_648 }).success, false);
  assert.equal(createRoundRobinRuleInputSchema.safeParse({ expectedRevision: 1, matchType: "city", matchValue: "x".repeat(18_099) }).success, true);
  assert.equal(createRoundRobinRuleInputSchema.safeParse({ expectedRevision: 1, matchType: "city", matchValue: "x".repeat(18_100) }).success, false);
});

test("saved queue adapter preserves object settings and excludes invalid JSON settings", () => {
  const settings = { ignore_availability: true, legacy_schedule: { retained: true } };
  assert.equal(normalizeExistingDistributionQueue({ revision: 8, settings }).settings, settings);
  for (const value of [null, false, "invalid", []]) assert.equal(normalizeExistingDistributionQueue({ settings: value }).settings, null);
  assert.equal(normalizeExistingDistributionQueue({ reentry_behavior: "keep_assignee" }).reentry_behavior, "keep_assignee");
  assert.equal(normalizeExistingDistributionQueue({ reentry_behavior: "unsupported_legacy" }).hasUnsupportedReentryBehavior, true);
});

test("editing a queue name preserves legacy property and unknown rule metadata, state and identity", () => {
  for (const type of ["property", "custom_legacy"]) {
    const original = { id: RULE, match_type: type, match_value: USER_A, match: { retained: { nested: true } }, priority: 27, is_active: false };
    const form = hydrateDistributionQueueFormData({ revision: 7, name: "Fila QA", rules: [original] }, []);
    form.name = "Fila QA renomeada";
    const request = distributionQueueRuleInputs(sanitizeDistributionQueueConditions(form.conditions, []));
    assert.deepEqual(request.conditions, []);
    assert.deepEqual(request.rules, [original]);
    assert.equal(form.expectedRevision, 7);
    assert.equal(form.conditions[0].legacyType, type === "property" ? undefined : type);
  }
});

test("editing a supported criterion sends its changed values under the saved rule ID", () => {
  const form = hydrateDistributionQueueFormData({ rules: [{ id: RULE, match_type: "property", match_value: USER_A }] }, []);
  form.conditions[0].values = [USER_B];
  const request = distributionQueueRuleInputs(form.conditions);
  assert.deepEqual(request.rules, []);
  assert.deepEqual(request.conditions, [{ id: RULE, type: "interest_property", values: [USER_B], sessionId: undefined }]);
});

test("a new criterion keeps its visual priority when unchanged raw rules are sent separately", () => {
  const form = hydrateDistributionQueueFormData({ rules: [{ id: RULE, match_type: "property", match_value: USER_A, priority: 27 }] }, []);
  form.conditions.push({ id: "draft-condition", type: "city", values: ["São Paulo"] });
  const request = distributionQueueRuleInputs(form.conditions);
  assert.equal(request.rules.length, 1);
  assert.deepEqual(request.conditions, [{ id: "draft-condition", type: "city", values: ["São Paulo"], sessionId: undefined, priority: 999 }]);
});

test("inactive queue rows cannot count as active capacity after the user is invited again", () => {
  const members = [{ type: "user" as const, entityId: USER_A, weight: 1, isActive: false }, { type: "user" as const, entityId: USER_B, weight: 1, isActive: true }];
  assert.deepEqual(getDistributionQueueEligibleUserIds(members, [], [USER_A, USER_B]), [USER_B]);
  members[0].isActive = true;
  assert.deepEqual(getDistributionQueueEligibleUserIds(members, [], [USER_A, USER_B]), [USER_A, USER_B]);
});

test("drafts are principal scoped, expire, and keep their stale revision for explicit review", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const key = distributionDraftKey(USER_A, USER_B, RULE)!;
  const form = createEmptyDistributionQueueFormData();
  form.name = "Rascunho QA"; form.expectedRevision = 7;
  saveDistributionDraft(storage, key, form, 1000);
  assert.equal(readDistributionDraft(storage, key, 8, 1100)?.expectedRevision, 7);
  assert.equal(readDistributionDraft(storage, distributionDraftKey(USER_B, USER_A, RULE)!, 7, 1100), null);
  assert.equal(readDistributionDraft(storage, key, 7, 1000 + 2 * 60 * 60 * 1000 + 1), null);
  assert.equal(values.has(key), false);
  values.set(key, '{"savedAt":1100,"form":{"name":"invalid"}}');
  assert.equal(readDistributionDraft(storage, key, 7, 1200), null);
});

test("logout clears only the previous user's distribution drafts across organizations", () => {
  const ownKeys = [distributionDraftKey(USER_A, USER_B, RULE)!, distributionDraftKey(RULE, USER_B)!];
  const retainedKeys = [distributionDraftKey(USER_A, USER_A, RULE)!, `vimob:distribution-draft:${USER_A}:${USER_B}suffix:new`, `vimob:distribution-draft:${USER_A}:${USER_B}`, "other-domain-draft"];
  const values = new Map([...ownKeys, ...retainedKeys].map((key) => [key, "draft"]));
  const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] || null, removeItem: (key: string) => { values.delete(key); } };
  clearDistributionDraftsForUser(storage, USER_B);
  assert.deepEqual([...values.keys()], retainedKeys);
  clearDistributionDraftsForUser(storage, "");
  assert.equal(values.size, retainedKeys.length);
});

test("logout tolerates browser storage restrictions", () => {
  const blockedStorage = { get length(): number { throw new Error("Storage blocked"); }, key: () => null, removeItem: () => { throw new Error("Storage blocked"); } };
  assert.doesNotThrow(() => clearDistributionDraftsForUser(blockedStorage, USER_A));
});

test("an expired unconfirmed creation drops private fields and retains its attempt key for explicit review", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const key = distributionDraftKey(USER_A, USER_B)!;
  const form = createEmptyDistributionQueueFormData();
  form.creationAttemptId = RULE; form.name = "Private draft name";
  assert.equal(saveDistributionDraft(storage, key, form, 1000), true);
  assert.deepEqual(readDistributionDraftRecovery(storage, key, 1000 + 2 * 60 * 60 * 1000 + 1), { status: "review_required", creationAttemptId: RULE });
  assert.equal(values.get(key), JSON.stringify({ reviewRequired: true, creationAttemptId: RULE }));
  assert.deepEqual(readDistributionDraftRecovery(storage, key, 1000 + 3 * 60 * 60 * 1000), { status: "review_required", creationAttemptId: RULE });
});

test("the first creation request is synchronously stored and cannot silently succeed with blocked storage", () => {
  const form = createEmptyDistributionQueueFormData(); form.creationAttemptId = RULE;
  const key = distributionDraftKey(USER_A, USER_B)!;
  const blocked = { getItem: () => null, setItem: () => { throw new Error("Storage blocked"); }, removeItem: () => {} };
  assert.equal(saveDistributionDraft(blocked, key, form, 1000), false);
});
