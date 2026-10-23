import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- Node's type-stripping runner needs the extension.
import { buildContactExportDynamicColumns } from './contact-export-dynamic.ts';

test('distinct labels retain accents, punctuation, non-Latin text and long suffixes', () => {
  const labels = ['Área', 'Area', 'cidade.estado', 'cidade-estado', '住所', `${'a'.repeat(100)}1`, `${'a'.repeat(100)}2`];
  const contact = { id: 'a', metadata_json: JSON.stringify({ fields: labels.map((name, index) => ({ name, value: String(index) })) }) };
  const columns = buildContactExportDynamicColumns([contact]).filter((column) => column.key.startsWith('question_'));
  assert.equal(columns.length, labels.length);
  assert.equal(new Set(columns.map((column) => column.key)).size, labels.length);
  assert.deepEqual(columns.map((column) => column.value(contact)).sort(), labels.map((_, index) => String(index)).sort());
});

test('identical labels from separate JSON sources preserve both answers', () => {
  const contact = { id: 'a', metadata_json: JSON.stringify({ field: { name: 'Renda', value: '100' } }), meta_payload_json: JSON.stringify({ field: { name: 'Renda', value: '200' } }) };
  const columns = buildContactExportDynamicColumns([contact]).filter((column) => column.key.startsWith('question_'));
  assert.equal(columns.length, 2);
  assert.deepEqual(columns.map((column) => column.value(contact)).sort(), ['100', '200']);
});

test('literal dotted paths and nested paths have different identities', () => {
  const contact = { id: 'a', metadata_json: JSON.stringify({ 'cidade.estado': 'SP', cidade: { estado: 'RJ' } }) };
  const columns = buildContactExportDynamicColumns([contact]);
  assert.equal(columns.length, 2);
  assert.equal(new Set(columns.map((column) => column.header)).size, 2);
  assert.deepEqual(columns.map((column) => column.value(contact)).sort(), ['RJ', 'SP']);
});

test('same exact field across contacts shares its column without losing values', () => {
  const contacts = ['100', '200'].map((value, index) => ({ id: String(index), metadata_json: JSON.stringify({ field: { name: 'Renda', value } }) }));
  const columns = buildContactExportDynamicColumns(contacts).filter((column) => column.key.startsWith('question_'));
  assert.equal(columns.length, 1);
  assert.deepEqual(contacts.map((contact) => columns[0].value(contact)), ['100', '200']);
});

test('repeated answers to one label retain all distinct values including zero', () => {
  const contact = { id: 'a', metadata_json: JSON.stringify({ fields: [{ name: 'Renda', value: 0 }, { name: 'Renda', value: '200' }, { name: 'Renda', value: 0 }] }) };
  const column = buildContactExportDynamicColumns([contact]).find((candidate) => candidate.key.startsWith('question_'));
  assert.ok(column);
  assert.deepEqual(JSON.parse(column.value(contact)), ['0', '200']);
});

test('expanded fields preserve numeric JSON precision and primitive arrays', () => {
  const contact = { id: 'a', meta_raw_payload_json: '{"fields":[{"name":"Valor","value":9007199254740993}],"numbers":[1.20,9007199254740993]}' };
  const columns = buildContactExportDynamicColumns([contact]);
  assert.equal(columns.find((column) => column.key.startsWith('question_'))?.value(contact), '9007199254740993');
  assert.ok(columns.some((column) => column.value(contact) === '[1.20,9007199254740993]'));
});

test('expansion includes deep fields, all object-array items and properties after the former cutoffs', () => {
  const contact = { id: 'a', metadata_json: JSON.stringify({
    rows: Array.from({ length: 25 }, (_, index) => ({ custom: `item-${index}` })),
    nested: { a: { b: { c: { d: 'deep' } } } },
    many: Object.fromEntries(Array.from({ length: 260 }, (_, index) => [`key-${index}`, `property-${index}`])),
  }) };
  const values = new Set(buildContactExportDynamicColumns([contact]).map((column) => column.value(contact)));
  assert.ok(values.has('deep') && values.has('item-24') && values.has('property-259'));
});

test('budget failure provides a raw JSON alternative and never returns truncated columns', () => {
  assert.throws(() => buildContactExportDynamicColumns([{ id: 'a', metadata_json: '{"a":1,"b":2}' }], { nodes: 2, characters: 100 }), /Desmarque a expansão.*Metadados JSON/);
});

test('same label with distinct IDs stays separate; identified forms remain stable after array reordering', () => {
  const makeForm = (id: string, value: string) => ({ id, fields: [{ id: 'q', name: 'Renda', value }] });
  const contacts = [{ id: 'a', metadata_json: JSON.stringify({ forms: [makeForm('form-A', '100'), makeForm('form-B', '200')] }) },
    { id: 'b', metadata_json: JSON.stringify({ forms: [makeForm('form-B', '300'), makeForm('form-A', '400')] }) }];
  const questions = buildContactExportDynamicColumns(contacts).filter((column) => column.key.startsWith('question_'));
  assert.equal(questions.length, 2);
  const formA = questions.find((column) => column.header.includes('form-A'));
  assert.ok(formA);
  assert.deepEqual(contacts.map((contact) => formA.value(contact)), ['100', '400']);
  const distinct = { id: 'c', metadata_json: JSON.stringify({ fields: [{ id: 'q-A', name: 'Renda', value: '100' }, { id: 'q-B', name: 'Renda', value: '200' }] }) };
  assert.equal(buildContactExportDynamicColumns([distinct]).filter((column) => column.key.startsWith('question_')).length, 2);
  const noQuestionID = { id: 'd', metadata_json: JSON.stringify({ forms: [
    { id: 'form-A', fields: [{ name: 'Renda', value: '100' }] },
    { id: 'form-B', fields: [{ name: 'Renda', value: '200' }] },
  ] }) };
  assert.equal(buildContactExportDynamicColumns([noQuestionID]).filter((column) => column.key.startsWith('question_')).length, 2);
  const submissions = ['lead-A', 'lead-B'].map((id) => ({ id,
    meta_payload_json: JSON.stringify({ data: { id, form_id: 'form-A', fields: [{ name: 'Renda', value: id }] } }),
  }));
  assert.equal(buildContactExportDynamicColumns(submissions).filter((column) => column.key.startsWith('question_')).length, 1);
});

test('complete expansion redacts documents at any supported depth and Meta answer labels', () => {
  const contact = { id: 'a', metadata_json: JSON.stringify({ deeply: { nested: { CPF: 'cpf-secret', rg: 'rg-secret', safe: 'allowed' } } }),
    meta_raw_payload_json: JSON.stringify({ field_data: [{ name: 'Qual seu CPF?', values: ['cpf-answer'] }, { name: 'numero_do_rg', value: 'rg-answer' }, { name: 'Cidade', values: ['São Paulo'] }] }) };
  const columns = buildContactExportDynamicColumns([contact]);
  const values = columns.map((column) => column.value(contact)).join('|');
  for (const secret of ['cpf-secret', 'rg-secret', 'cpf-answer', 'rg-answer']) assert.equal(values.includes(secret), false);
  assert.ok(values.includes('allowed') && values.includes('São Paulo'));
});
