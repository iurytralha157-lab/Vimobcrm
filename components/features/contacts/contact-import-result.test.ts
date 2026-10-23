import assert from 'node:assert/strict';
import test from 'node:test';
import { contactImportFailureReport, isConfirmedContactImportFailure } from './contact-import-result';
import { buildContactExportCSV } from '@/lib/export-contacts-csv';
import { parseContactsCSVRecords } from './parse-contacts-csv';

test('only explicit negative outcomes can enter a confirmed retry', () => {
  assert.equal(isConfirmedContactImportFailure({ code: 'invalid_import_row', rowNumber: 2 }), true);
  assert.equal(isConfirmedContactImportFailure({ code: 'lead_import_idempotency_unavailable', rowNumber: 2 }), true);
  for (const code of ['api_timeout', 'api_unavailable', 'internal_error', 'invalid_api_response', 'import_row_failed', 'new_unknown_code']) {
    assert.equal(isConfirmedContactImportFailure({ code, rowNumber: 2 }), false);
  }
  assert.equal(isConfirmedContactImportFailure({ code: 'invalid_import_row', rowNumber: 2 }, new Set([2])), false);
});

test('an explicit unavailable commercial workflow is a confirmed rejection, but uncertain transport stays blocked', () => {
  const rejected = { code: 'lead_creation_workflow_unavailable', rowNumber: 2, name: 'Sintético', message: 'Aguarde a atualização do fluxo comercial.' };
  assert.equal(isConfirmedContactImportFailure(rejected), true);
  assert.equal(contactImportFailureReport([rejected])[0][4], 'Falha confirmada');
  assert.equal(isConfirmedContactImportFailure(rejected, new Set([2])), false);
  assert.equal(isConfirmedContactImportFailure({ code: 'api_timeout', rowNumber: 2 }), false);
});

test('a rolled-back queue pool rejection permits review without widening uncertain retries', () => {
  const rejected = { code: 'queue_pool_changed', rowNumber: 2, name: 'Contato sintético', message: 'O lead mudou no bolsão.' };
  assert.equal(isConfirmedContactImportFailure(rejected), true);
  assert.equal(contactImportFailureReport([rejected])[0][4], 'Falha confirmada');
  assert.equal(isConfirmedContactImportFailure(rejected, new Set([2])), false);
  assert.match(String(contactImportFailureReport([rejected], new Set([2]))[0][4]), /contato não enviado/);
  for (const code of ['api_timeout', 'api_unavailable', 'internal_error', 'invalid_api_response', 'lead_import_request_conflict', 'unknown_409', 'queue_configuration_busy']) {
    assert.equal(isConfirmedContactImportFailure({ code, rowNumber: 2 }), false, code);
  }
});

test('failure report includes every physical row, its outcome and formula-safe contact names', () => {
  const failures = Array.from({ length: 12 }, (_, index) => ({ rowNumber: index + 3, name: '=2+2', code: index === 11 ? 'api_timeout' : 'invalid_import_row', message: `Motivo ${index}` }));
  const report = contactImportFailureReport(failures);
  assert.equal(report.length, 12);
  assert.equal(report[11][0], 14);
  assert.match(String(report[11][4]), /sem confirmação/);
  assert.match(String(contactImportFailureReport(failures, new Set([3]))[0][4]), /contato não enviado/);
  const conflict = { ...failures[0], code: 'lead_import_request_conflict' };
  assert.equal(isConfirmedContactImportFailure(conflict), false);
  assert.match(String(contactImportFailureReport([conflict])[0][4]), /revisão necessária/);
  const csv = buildContactExportCSV(['Linha', 'Nome', 'Código', 'Motivo', 'Resultado'], report);
  assert.equal(parseContactsCSVRecords(csv)[0].values.nome, '=2+2');
});
