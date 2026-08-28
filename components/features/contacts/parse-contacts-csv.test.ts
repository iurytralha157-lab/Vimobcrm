import assert from 'node:assert/strict';
import test from 'node:test';

// The Node type-stripping runner requires the explicit TypeScript extension.
// @ts-expect-error -- production imports remain extensionless for Next.js.
import { parseContactsCSV } from './parse-contacts-csv.ts';

test('parses semicolon CSV with quoted delimiters and escaped quotes', () => {
  assert.deepEqual(
    parseContactsCSV('Nome;Mensagem\r\n"Ana; Maria";"Disse ""olá"""\r\n'),
    [{ nome: 'Ana; Maria', mensagem: 'Disse "olá"' }],
  );
});

test('parses comma CSV with line breaks inside quoted fields', () => {
  assert.deepEqual(
    parseContactsCSV('\uFEFFname,message\nJoão,"linha 1\nlinha 2"\n'),
    [{ name: 'João', message: 'linha 1\nlinha 2' }],
  );
});

test('rejects an unterminated quoted field', () => {
  assert.throws(() => parseContactsCSV('name,message\nAna,"incompleto'), /CSV_INVALID_QUOTES/);
});
