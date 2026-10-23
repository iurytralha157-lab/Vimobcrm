import assert from 'node:assert/strict';
import test from 'node:test';
import { countDistributionQueueInputCharacters } from '@/lib/round-robin/input-text';
import { countDistributionQueueNameCharacters, isValidDistributionQueueName } from '@/lib/round-robin/queue-name';
import { distributionQueueAutoReplyError } from '@/lib/round-robin/whatsapp-auto-reply-validation';
import { createEmptyDistributionQueueFormData } from '@/lib/round-robin/distribution-queue-form';
import { createRoundRobinInputSchema, updateRoundRobinInputSchema } from '@/lib/validation/crm-support';
import { distributionDraftKey, saveDistributionDraft, readDistributionDraftRecovery } from '@/lib/round-robin/pending-draft';

const NEL = '\u0085', BOM = '\uFEFF';
const parsers = [
  ['create', (name: string, message?: string) => createRoundRobinInputSchema.safeParse({ name, ...(message === undefined ? {} : { settings: { whatsapp_distribution_auto_reply_message: message } }) })],
  ['update', (name: string, message?: string) => updateRoundRobinInputSchema.safeParse({ expectedRevision: 3, name, ...(message === undefined ? {} : { settings: { whatsapp_distribution_auto_reply_message: message } }) })],
] as const;

function configured(message: string) {
  const form = createEmptyDistributionQueueFormData();
  form.conditions = [{ id: 'reply', type: 'whatsapp_message_contains', values: ['campanha'], sessionId: 'session' }];
  form.settings.whatsapp_distribution_auto_reply_enabled = true;
  form.settings.whatsapp_distribution_auto_reply_message = message;
  form.settings.whatsapp_distribution_auto_reply_delay_seconds = 30;
  return form;
}

test('name validation counts the text Go receives after the existing JavaScript trim', () => {
  for (const raw of [`A${NEL}`, `${NEL}A${NEL}`, `${NEL}${NEL}`]) {
    assert.equal(countDistributionQueueNameCharacters(raw), raw.includes('A') ? 1 : 0, JSON.stringify(raw));
    assert.equal(isValidDistributionQueueName(raw), false);
    for (const [mode, parse] of parsers) assert.equal(parse(raw).success, false, mode);
  }
});

test('valid maximum names accept Go whitespace at the edges without truncating the payload', () => {
  for (const unit of ['a', '😀']) {
    const raw = `${NEL}${unit.repeat(120)}${NEL}`;
    assert.equal(countDistributionQueueNameCharacters(raw), 120);
    for (const [mode, parse] of parsers) {
      const result = parse(raw);
      assert.equal(result.success, true, mode);
      if (result.success) assert.equal(result.data.name, raw, 'keep the existing JS-only payload trim');
    }
  }
});

test('reply NEL-only text is rejected by readiness and both schemas', () => {
  for (const raw of [NEL, `${NEL}\r\n${NEL}`, ` ${NEL} `]) {
    assert.match(distributionQueueAutoReplyError(configured(raw))!, /entre 1 e 4000/);
    for (const [mode, parse] of parsers) assert.equal(parse('Fila QA', raw).success, false, mode);
  }
});

test('maximum replies accept edge NEL without truncating or replacing the raw message', () => {
  for (const unit of ['a', '😀']) {
    const raw = `${NEL}${unit.repeat(4000)}${NEL}`;
    assert.equal(distributionQueueAutoReplyError(configured(raw)), null);
    for (const [mode, parse] of parsers) {
      const result = parse('Fila QA', raw);
      assert.equal(result.success, true, mode);
      if (result.success) assert.equal(result.data.settings?.whatsapp_distribution_auto_reply_message, raw);
    }
    assert.match(distributionQueueAutoReplyError(configured(`${NEL}${unit.repeat(4001)}${NEL}`))!, /entre 1 e 4000/);
  }
});

test('composition order preserves BOM exposed only after Go whitespace is removed', () => {
  for (const [raw, expected] of [
    [`${NEL}${BOM}A${BOM}${NEL}`, 3],
    [`${BOM}${NEL}A${NEL}${BOM}`, 1],
    [`${NEL}${BOM}${NEL}`, 1],
    [`${BOM}A${BOM}`, 1],
    [`A${NEL}B`, 3],
    [`A${BOM}B`, 3],
  ] as const) assert.equal(countDistributionQueueInputCharacters(raw), expected, JSON.stringify(raw));
  assert.equal(distributionQueueAutoReplyError(configured(`${NEL}${BOM}${NEL}`)), null);
});

test('multiline interior characters stay counted and parsed input retains its existing trim policy', () => {
  const raw = ` ${NEL}\r\nOlá\n\n😀\r\n${NEL} `;
  assert.equal(countDistributionQueueInputCharacters(raw), 6);
  for (const [mode, parse] of parsers) {
    const result = parse('Fila QA', raw);
    assert.equal(result.success, true, mode);
    if (result.success) assert.equal(result.data.settings?.whatsapp_distribution_auto_reply_message, raw.trim());
  }
});

test('draft recovery preserves edge whitespace, BOM, multiline and invalid transient text verbatim', () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
  const now = 1_800_000_000_000;
  for (const queueId of [undefined, 'queue-id']) {
    const key = distributionDraftKey('org', 'user', queueId)!;
    for (const raw of [`A${NEL}`, `${NEL}${BOM}A${BOM}${NEL}`, ` \r\n${NEL}Olá\n\n😀${NEL}\r\n `, `${NEL}😀${NEL}`.repeat(121)]) {
      const form = { ...configured(raw), name: raw, expectedRevision: 3 };
      assert.equal(saveDistributionDraft(storage, key, form, now), true);
      const recovery = readDistributionDraftRecovery(storage, key, now + 1000);
      assert.equal(recovery?.status, 'ready');
      if (recovery?.status === 'ready') {
        assert.equal(recovery.form.name, raw);
        assert.equal(recovery.form.settings.whatsapp_distribution_auto_reply_message, raw);
      }
    }
  }
});

test('disabled or unconfigured reply validation remains nonblocking', () => {
  const disabled = configured(NEL);
  disabled.settings.whatsapp_distribution_auto_reply_enabled = false;
  assert.equal(distributionQueueAutoReplyError(disabled), null);
  const absent = configured(NEL);
  absent.conditions = [];
  assert.equal(distributionQueueAutoReplyError(absent), null);
});
