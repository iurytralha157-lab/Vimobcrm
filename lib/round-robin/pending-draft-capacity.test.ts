import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyDistributionQueueFormData } from "./distribution-queue-form";
import { distributionDraftKey, readDistributionDraftRecovery, saveDistributionDraft } from "./pending-draft";

test("a supported 500-person queue can preserve its creation attempt and display names before POST", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const key = distributionDraftKey("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222")!;
  const form = createEmptyDistributionQueueFormData();
  form.name = "Fila com 500 participantes";
  form.creationAttemptId = "33333333-3333-4333-8333-333333333333";
  form.conditions = [{ id: "source-qa", type: "source", values: ["site"] }];
  form.members = Array.from({ length: 500 }, (_, index) => ({
    type: "user" as const,
    entityId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: "Pessoa QA ".repeat(28),
    weight: 10,
    isActive: true,
  }));
  assert.ok(JSON.stringify(form).length > 100_000, "fixture must exceed the old recovery limit");
  assert.equal(saveDistributionDraft(storage, key, form, 1_800_000_000_000), true);
  const recovered = readDistributionDraftRecovery(storage, key, 1_800_000_001_000);
  assert.equal(recovered?.status, "ready");
  if (recovered?.status !== "ready") assert.fail("creation intent was lost");
  assert.equal(recovered.form.creationAttemptId, form.creationAttemptId);
  assert.equal(recovered.form.members.length, 500);
  assert.equal(recovered.form.members[499].name, form.members[499].name);
});
