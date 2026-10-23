import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoundRobinInputSchema, updateRoundRobinInputSchema } from '@/lib/validation/crm-support';

const parseCreate = (message: string) => createRoundRobinInputSchema.safeParse({ name: 'Fila Unicode QA', settings: { whatsapp_distribution_auto_reply_message: message } });
const parseUpdate = (message: string) => updateRoundRobinInputSchema.safeParse({ expectedRevision: 3, settings: { whatsapp_distribution_auto_reply_message: message } });

for (const [name, parse] of [['create', parseCreate], ['update', parseUpdate]] as const) {
  test(`${name}: 2000 and 4000 supplementary characters use the same rune bound as Go`, () => {
    for (const length of [2000, 4000]) {
      const message = '😀'.repeat(length);
      const parsed = parse(message);
      assert.equal(parsed.success, true, `${length} code points must be accepted`);
      if (parsed.success) assert.equal(parsed.data.settings?.whatsapp_distribution_auto_reply_message, message);
    }
  });

  test(`${name}: limits are code points, including combining marks and surrogate pairs`, () => {
    assert.equal(parse('a'.repeat(3999) + '🚀').success, true);
    assert.equal(parse('a\u0301'.repeat(2000)).success, true);
    assert.equal(parse('😀'.repeat(4001)).success, false);
    assert.equal(parse('a\u0301'.repeat(2001)).success, false);
    assert.equal(parse('a'.repeat(4001)).success, false);
  });

  test(`${name}: preserve the existing trim and isolated-surrogate policy`, () => {
    const message = '  ' + '😀'.repeat(4000) + '\n';
    const parsed = parse(message);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.settings?.whatsapp_distribution_auto_reply_message, message.trim());
    // JSON/Go already define replacement of isolated UTF-16 surrogates. This
    // length fix must not introduce a separate normalization/rejection policy.
    assert.equal(parse('\uD800').success, true);
    assert.equal(parse('\uDC00').success, true);
    assert.equal(parse('   \n').success, false);
  });
}
