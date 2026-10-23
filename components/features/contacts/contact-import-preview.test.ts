import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImportContactSample } from './contact-import-preview';

test('preview validates a bounded sample without changing import rows', () => {
  const rows = Array.from({ length: 30 }, (_, index) => Object.freeze({
    rowNumber: index + 2,
    nome: 'Contato de exemplo',
    telefone: '+5511999999999',
    tags: 'Tag que ainda não existe',
  }));
  const before = JSON.stringify(rows);
  const sample = buildImportContactSample(rows);
  assert.equal(sample.length, 6);
  assert.ok(sample.every((row) => row.issues.length === 0));
  assert.equal(sample[0].tags, 'Tag que ainda não existe');
  assert.equal(JSON.stringify(rows), before);
  assert.notEqual(sample[0], rows[0]);
  assert.equal(buildImportContactSample(rows, 100).length, 20);
  assert.deepEqual(buildImportContactSample(rows, -1), []);
});

test('preview reports invalid identity formats without claiming destination validity', () => {
  const sample = buildImportContactSample([
    { rowNumber: 2, nome: 'A', telefone: 'invalid', email: 'invalid' },
    { rowNumber: 3, nome: 'Contato válido', email: 'contato@example.com', pipeline: 'Funil não existente' },
  ]);
  assert.equal(sample[0].issues.length, 3);
  assert.equal(sample[1].issues.length, 0);
  assert.equal(sample[1].pipeline, 'Funil não existente');
});

test('preview does not add a phone requirement to the import schema', () => {
  const sample = buildImportContactSample([
    { rowNumber: 2, nome: 'Contato por email', email: 'contato@example.com' },
    { rowNumber: 3, nome: 'Contato sem canais' },
  ]);
  assert.ok(sample.every((row) => row.issues.length === 0));
});
