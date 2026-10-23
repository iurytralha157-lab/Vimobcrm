import assert from 'node:assert/strict';
import test from 'node:test';
import { assignContactImportKeys, ignoredContactImportColumns, normalizeContactImportRows, resolveContactImportReference, validateContactImportHeaders } from './contact-import-columns';

test('normalizes current and previous export labels, source codes and destination IDs', () => {
  const rows = normalizeContactImportRows([{ rowNumber: 3, values: { Nome: ' Ana ', 'Atendimento/Estágio': 'Negociação', 'Mensagem do lead': 'Detalhes', Origem: 'Importação', 'ID da pipeline': 'pipeline-id', 'ID do estágio': 'stage-id', 'ID do responsável': 'user-id', Cidade: 'Curitiba' } }]);
  assert.deepEqual(rows, [{ rowNumber: 3, nome: 'Ana', estagio: 'Negociação', mensagem: 'Detalhes', fonte: 'import', pipeline_id: 'pipeline-id', stage_id: 'stage-id', assigned_user_id: 'user-id' }]);
  assert.deepEqual(ignoredContactImportColumns(['Nome', 'Atendimento/Estágio', 'Mensagem do lead', 'Cidade', 'Pergunta: orçamento']), ['Cidade', 'Pergunta: orçamento']);
  assert.equal(normalizeContactImportRows([{ rowNumber: 2, values: { Nome: 'Ana', Origem: 'Portal personalizado' } }])[0].fonte, 'Portal personalizado');
  assert.equal(normalizeContactImportRows([{ rowNumber: 2, values: { Nome: 'Ana', Origem: 'Google Ads' } }])[0].fonte, 'google_ads');
  assert.equal(normalizeContactImportRows([{ rowNumber: 2, values: { Nome: 'Ana', Origem: 'Meta Ads' } }])[0].fonte, 'meta');
});

test('duplicate aliases fail before converting values, including unknown duplicate columns', () => {
  for (const headers of [['Email', 'email'], ['Email', 'E-mail'], ['Nome', 'Name'], ['Estágio', 'Atendimento/Estágio'], ['Cidade', 'cidade']]) {
    assert.throws(() => validateContactImportHeaders(headers, 3), /Linha 3.*duplicada/);
  }
  assert.doesNotThrow(() => validateContactImportHeaders(['Pipeline', 'ID da pipeline', '', 'Estágio']));
});

test('homonyms are rejected; IDs and unique emails identify a destination without depending on list order', () => {
  const users = [{ id: 'u1', name: 'João', email: 'one@example.com' }, { id: 'u2', name: 'João', email: 'two@example.com' }];
  assert.match(resolveContactImportReference('João', undefined, users, 'Responsável').error || '', /ambíguo/);
  assert.deepEqual(resolveContactImportReference('two@example.com', undefined, users, 'Responsável'), { id: 'u2' });
  assert.deepEqual(resolveContactImportReference('João', 'u1', [...users].reverse(), 'Responsável'), { id: 'u1' });
  assert.ok(resolveContactImportReference('one@example.com', 'u2', users, 'Responsável').error);
  assert.ok(resolveContactImportReference(undefined, 'different-tenant-id', users, 'Responsável').error);
});

test('execution keys survive a confirmed retry and new selections get new keys', () => {
  let cursor = 0;
  const first = assignContactImportKeys([{ rowNumber: 2, nome: 'Ana' }, { rowNumber: 3, nome: 'Maria' }], () => `key-${++cursor}`);
  assert.equal(assignContactImportKeys(first.slice(1), () => `key-${++cursor}`)[0].importRequestKey, 'key-2');
  assert.equal(cursor, 2);
  assert.equal(assignContactImportKeys([{ rowNumber: 2, nome: 'Ana' }], () => `key-${++cursor}`)[0].importRequestKey, 'key-3');
});
