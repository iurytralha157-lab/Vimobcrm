import assert from 'node:assert/strict';
import test from 'node:test';
import { getDisplayInitial, normalizeDisplayName } from './display-name';
import { getInitials } from './user-display';
import { normalizeSearchText, searchTextIncludes } from './search-text';

test('decorative names have plain display and search equivalence without changing the original object', () => {
  const lead = { name: '𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪' };
  assert.equal(normalizeDisplayName(lead.name), 'Ana Silva');
  assert.equal(getDisplayInitial(lead.name), 'A'); assert.equal(getInitials(lead.name), 'AS');
  assert.equal(searchTextIncludes(lead.name, 'Ana Silva'), true); assert.equal(searchTextIncludes('Ana Silva', lead.name), true);
  assert.equal(lead.name, '𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪');
});

test('common names and other alphabets preserve their display; search still ignores Portuguese accents', () => {
  for (const name of ['Márcia Freitas', '李明', 'Ана Иванова', 'أحمد علي', '👩🏽‍💻 Ana']) assert.equal(normalizeDisplayName(name), name);
  assert.equal(normalizeSearchText('Ｍárcia'), 'marcia'); assert.equal(normalizeDisplayName('Jose\u0301'), 'José');
  assert.equal(normalizeDisplayName('', 'Lead'), 'Lead'); assert.equal(normalizeDisplayName(null), '');
});

test('avatar initials keep full emoji and flags instead of an isolated UTF-16 surrogate', () => {
  assert.equal(getDisplayInitial('👩🏽‍💻 Ana'), '👩🏽‍💻'); assert.equal(getDisplayInitial('🇧🇷 Ana'), '🇧🇷');
  assert.equal(getDisplayInitial('👨‍👩‍👧‍👦 Família'), '👨‍👩‍👧‍👦'); assert.equal(getInitials('👩🏽‍💻 Ana'), '👩🏽‍💻A');
  assert.equal(getInitials('𝓐𝓷𝓪', { singleWordCharacters: 2 }), 'AN');
});
