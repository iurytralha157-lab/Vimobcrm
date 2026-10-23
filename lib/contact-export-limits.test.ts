import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { validateContactExportLayout, validateContactExportXLSXCell } from './contact-export-limits.ts';

test('Excel boundaries fail explicitly with a useful alternative; CSV keeps wide reports', () => {
  assert.doesNotThrow(() => validateContactExportLayout('xlsx', 1, 16_384));
  assert.throws(() => validateContactExportLayout('xlsx', 66, 16_500), /Escolha CSV/);
  assert.doesNotThrow(() => validateContactExportLayout('csv', 66, 16_500));
  assert.throws(() => validateContactExportLayout('xlsx', 1_048_576, 1), /limite de linhas/);
  assert.throws(() => validateContactExportLayout('csv', 10_000, 250), /reduza|Reduza/);
});

test('long Excel cells reject loss instead of silently truncating; exact boundary is valid', () => {
  assert.doesNotThrow(() => validateContactExportXLSXCell('a'.repeat(32_767)));
  assert.throws(() => validateContactExportXLSXCell('a'.repeat(32_768)), /Escolha CSV/);
});
