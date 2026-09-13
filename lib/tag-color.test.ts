import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getContrastTextClass,
  getTagColorStyle,
  getTagColorStyleWithWhiteText,
} from './tag-color';

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

test('returns utility classes with the caller fallback and legacy alpha support', () => {
  assert.equal(getContrastTextClass('#fff'), 'text-slate-950');
  assert.equal(getContrastTextClass('#000000'), 'text-white');
  assert.equal(getContrastTextClass('#ffffff80'), 'text-slate-950');
  assert.equal(getContrastTextClass('transparent'), 'text-white');
  assert.equal(
    getContrastTextClass('transparent', 'text-primary-foreground'),
    'text-primary-foreground',
  );
});

test('preserves the tag hue while guaranteeing white text on opaque chips', () => {
  assert.deepEqual(getTagColorStyleWithWhiteText('#111827'), {
    backgroundColor: '#111827',
    color: '#ffffff',
  });
  assert.equal(getTagColorStyleWithWhiteText('#fff').color, '#ffffff');
  assert.notEqual(getTagColorStyleWithWhiteText('#fff').backgroundColor, '#ffffff');
  assert.deepEqual(getTagColorStyleWithWhiteText('not-a-color'), {
    backgroundColor: 'var(--primary)',
    color: '#ffffff',
  });
});
