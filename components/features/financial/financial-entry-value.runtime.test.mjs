import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { financialCalendarDateSchema } from '@/lib/validation/financial';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const file = new URL('./FinancialEntryForm.tsx', import.meta.url);
const ast = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(node => ts.isIdentifier(node.name) && node.name.text === 'formSchema');
assert.ok(declaration?.initializer, 'the form-owned schema must exist');
const evaluatedModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(`module.exports = ${declaration.initializer.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { module: evaluatedModule, z, financialCalendarDateSchema });
const schema = evaluatedModule.exports;
const base = { type: 'receivable', category: 'Outros recebimentos', description: 'QA validação', due_date: '2026-11-14' };
const required = 'Valor é obrigatório';
const invalid = 'Informe um valor numérico válido';

const cases = [
  ['missing', {}, required],
  ['undefined', { amount: undefined }, required],
  ['NaN', { amount: Number.NaN }, invalid],
  ['null', { amount: null }, invalid],
  ['numeric string', { amount: '100' }, invalid],
  ['empty string', { amount: '' }, invalid],
  ['whitespace', { amount: '  ' }, invalid],
  ['boolean', { amount: true }, invalid],
  ['array', { amount: [100] }, invalid],
  ['object', { amount: { value: 100 } }, invalid],
  ['Infinity', { amount: Infinity }, invalid],
  ['negative Infinity', { amount: -Infinity }, invalid],
];
for (const [name, input, expected] of cases) test(`form schema rejects ${name} with a Portuguese amount error`, () => {
  const result = schema.safeParse({ ...base, ...input });
  assert.equal(result.success, false, 'invalid input must never be coerced into a payment amount');
  const issue = result.error.issues.find(issue => issue.path.join('.') === 'amount');
  assert.equal(issue?.message, expected);
});

for (const amount of [0, -1, 0.009]) test(`existing lower bound is preserved for ${amount}`, () => {
  const result = schema.safeParse({ ...base, amount });
  assert.equal(result.success, false);
  assert.equal(result.error.issues.find(issue => issue.path.join('.') === 'amount')?.message, 'Valor deve ser maior que zero');
});

for (const amount of [0.01, 1, 1234.56]) test(`valid numeric amount ${amount} is unchanged`, () => {
  const result = schema.parse({ ...base, amount });
  assert.equal(result.amount, amount);
  assert.equal(typeof result.amount, 'number');
});

for (const [name, amount, expected] of [['empty', undefined, required], ['NaN', Number.NaN, invalid], ['string', '100', invalid]]) {
  test(`real React Hook Form resolver exposes ${name} error and no submission values`, async () => {
    const result = await zodResolver(schema)({ ...base, amount }, {}, { fields: {}, criteriaMode: 'all', shouldUseNativeValidation: false });
    assert.equal(result.errors.amount?.message, expected);
    assert.deepEqual(result.values, {});
  });
}

test('real resolver keeps a valid payable numeric amount and existing form fields', async () => {
  const result = await zodResolver(schema)({ ...base, type: 'payable', amount: 200 }, {}, { fields: {}, shouldUseNativeValidation: false });
  assert.deepEqual(result.errors, {});
  assert.equal(result.values.amount, 200);
  assert.equal(result.values.type, 'payable');
  assert.equal(result.values.due_date, base.due_date);
});
