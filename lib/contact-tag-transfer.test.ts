import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContactTags, serializeContactTags } from './contact-tag-transfer';

test('tag transfer preserves separators, quotes, unicode and repeated names', () => {
  const names = ['Quente, investidor', 'Casa; apartamento', 'A | B', '"São José"', 'Quente, investidor'];
  assert.deepEqual(parseContactTags(serializeContactTags(names)), { names: names.slice(0, 4) });
});

test('tag transfer accepts legacy templates and empty cells', () => {
  assert.deepEqual(parseContactTags(' quente, investidor; cliente | quente '), { names: ['quente', 'investidor', 'cliente'] });
  assert.deepEqual(parseContactTags(''), { names: [] });
  assert.deepEqual(parseContactTags('[]'), { names: [] });
});

test('malformed JSON tags fail closed instead of creating split tag names', () => {
  for (const value of ['["Quente, investidor"', '[1]', '[null]', '[{}]']) {
    const parsed = parseContactTags(value);
    assert.deepEqual(parsed.names, []);
    assert.ok(parsed.error);
  }
});
