import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyDistributionQueueFormData } from '@/lib/round-robin/distribution-queue-form';
import { distributionQueueAutoReplyError } from '@/lib/round-robin/whatsapp-auto-reply-validation';

function configured(message: string, delay = 30) {
  const form = createEmptyDistributionQueueFormData();
  form.conditions = [{ id: 'reply', type: 'whatsapp_message_contains', values: ['campanha'], sessionId: 'session' }];
  form.settings.whatsapp_distribution_auto_reply_enabled = true;
  form.settings.whatsapp_distribution_auto_reply_message = message;
  form.settings.whatsapp_distribution_auto_reply_delay_seconds = delay;
  return form;
}

test('configured automatic replies share the code-point bound at readiness and submission', () => {
  for (const unit of ['a', '😀', 'a\u0301']) {
    assert.equal(distributionQueueAutoReplyError(configured(unit)), null);
  }
  for (const count of [1, 3999, 4000]) {
    assert.equal(distributionQueueAutoReplyError(configured('😀'.repeat(count))), null);
    assert.equal(distributionQueueAutoReplyError(configured('a'.repeat(count))), null);
  }
  for (const message of ['', '   ', 'a'.repeat(4001), '😀'.repeat(4001)]) {
    assert.match(distributionQueueAutoReplyError(configured(message))!, /entre 1 e 4000/);
  }
  assert.equal(distributionQueueAutoReplyError(configured('  😀  ')), null);
});

test('reply delay is required to be an integer inside the existing bounds', () => {
  for (const delay of [1, 3600]) assert.equal(distributionQueueAutoReplyError(configured('válida', delay)), null);
  for (const delay of [0, -1, 3601, 1.5, Number.NaN]) {
    assert.match(distributionQueueAutoReplyError(configured('válida', delay))!, /entre 1 e 3600/);
  }
});

test('disabled replies and conditions that will not configure a campaign do not block unrelated edits', () => {
  const disabled = configured('');
  disabled.settings.whatsapp_distribution_auto_reply_enabled = false;
  assert.equal(distributionQueueAutoReplyError(disabled), null);
  const absent = configured('');
  absent.conditions = [{ id: 'source', type: 'source', values: ['facebook'] }];
  assert.equal(distributionQueueAutoReplyError(absent), null);
  const empty = configured('');
  empty.conditions[0].values = ['  '];
  assert.equal(distributionQueueAutoReplyError(empty), null);
});
