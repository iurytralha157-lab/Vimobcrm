import assert from 'node:assert/strict';
import test from 'node:test';
import { getTagColorStyle } from './tag-color';

test('uses theme tokens when a tag color is absent or unsafe', () => {
  assert.deepEqual(getTagColorStyle(null), {
    backgroundColor: 'var(--primary)',
    color: 'var(--primary-foreground)',
  });
  assert.deepEqual(getTagColorStyle('url(javascript:alert(1))'), {
    backgroundColor: 'var(--primary)',
    color: 'var(--primary-foreground)',
  });
});

test('chooses a readable foreground for valid short and long hex colors', () => {
  assert.deepEqual(getTagColorStyle('#fff'), {
    backgroundColor: '#fff',
    color: '#0f172a',
  });
  assert.deepEqual(getTagColorStyle('#111827'), {
    backgroundColor: '#111827',
    color: '#ffffff',
  });
});
