import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoundRobinInputSchema, updateRoundRobinInputSchema } from '@/lib/validation/crm-support';
import { createEmptyDistributionQueueFormData } from '@/lib/round-robin/distribution-queue-form';
import { distributionDraftKey, readDistributionDraftRecovery, saveDistributionDraft } from '@/lib/round-robin/pending-draft';
import { countDistributionQueueNameCharacters, isValidDistributionQueueName } from '@/lib/round-robin/queue-name';

const parseCreate = (name: string) => createRoundRobinInputSchema.safeParse({ name });
const parseUpdate = (name: string) => updateRoundRobinInputSchema.safeParse({ expectedRevision: 3, name });

for (const [mode, parse] of [['create', parseCreate], ['update', parseUpdate]] as const) {
  test(`${mode}: queue names count code points at 1/2/119/120/121, including 64 emoji`, () => {
    for (const character of ['a', '😀']) {
      for (const length of [1, 2, 64, 119, 120, 121]) {
        const name = character.repeat(length);
        assert.equal(countDistributionQueueNameCharacters(name), length);
        assert.equal(isValidDistributionQueueName(name), length >= 2 && length <= 120);
        const parsed = parse(name);
        assert.equal(parsed.success, length >= 2 && length <= 120, `${length} ${character} code points`);
        if (parsed.success) assert.equal(parsed.data.name, name);
      }
    }
  });

  test(`${mode}: trim stays unchanged and surrogate pairs are never counted twice`, () => {
    const name = ' \t' + '😀'.repeat(120) + '\n ';
    const parsed = parse(name);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.name, name.trim());
    assert.equal(parse('a'.repeat(119) + '🚀').success, true);
    assert.equal(parse('a'.repeat(120) + '🚀').success, false);
    assert.equal(parse('e\u0301').success, true, 'a combining sequence contains two code points');
    assert.equal(parse('  😀  ').success, false, 'one supplementary character is one code point');
    assert.equal(parse(' \t\n ').success, false);
    assert.equal(parse('\uD800\uD800').success, true, 'preserve the existing isolated-surrogate policy');
  });
}

function memoryStorage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
}

test('creation and edit drafts roundtrip Unicode and invalid transient/legacy names without trimming or truncation', () => {
  const storage = memoryStorage();
  const now = 1_800_000_000_000;
  for (const queueId of [undefined, 'queue-id']) {
    const key = distributionDraftKey('org-a', 'user-a', queueId)!;
    for (const name of ['', '😀', '😀'.repeat(64), '😀'.repeat(120), '😀'.repeat(121), 'a'.repeat(121), '  Nome da fila  ']) {
      const form = {
        ...createEmptyDistributionQueueFormData(), name, expectedRevision: 3,
        ...(!queueId ? { creationAttemptId: '11111111-1111-4111-8111-111111111111' } : {}),
      };
      assert.equal(saveDistributionDraft(storage, key, form, now), true, `${queueId ?? 'new'} ${Array.from(name).length} code points`);
      const recovered = readDistributionDraftRecovery(storage, key, now + 1_000);
      assert.equal(recovered?.status, 'ready');
      if (recovered?.status === 'ready') {
        assert.equal(recovered.form.name, name);
        assert.equal(recovered.form.expectedRevision, 3);
        assert.equal(recovered.form.creationAttemptId, form.creationAttemptId);
      }
      if (Array.from(name.trim()).length > 120 || Array.from(name.trim()).length < 2) {
        assert.equal(parseCreate(name).success, false, 'recoverable text is still not valid API input');
        assert.equal(parseUpdate(name).success, false);
      }
    }
  }
});

test('draft byte quota still bounds a long name and preserves the previous recoverable record on refusal', () => {
  const storage = memoryStorage(), key = distributionDraftKey('org-a', 'user-a')!;
  const now = 1_800_000_000_000;
  const previous = { ...createEmptyDistributionQueueFormData(), name: '😀'.repeat(120) };
  assert.equal(saveDistributionDraft(storage, key, previous, now), true);
  const record = storage.getItem(key);
  assert.equal(saveDistributionDraft(storage, key, { ...previous, name: '😀'.repeat(250_001) }, now + 100), false);
  assert.equal(storage.getItem(key), record);
  const recovered = readDistributionDraftRecovery(storage, key, now + 1_000);
  assert.equal(recovered?.status === 'ready' && recovered.form.name, previous.name);
});
