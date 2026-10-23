import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

function productionModule(path, dependencies) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const body = source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source)).join('\n');
  const code = ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  return exports;
}
const common = productionModule('lib/validation/common.ts', { z });
const feedback = productionModule('lib/validation/lead-feedback.ts', { z, ...common });

// Execute the actual completion schema declaration with its real primitive
// schemas. No substitute schema, network, browser or database is involved.
const auxiliary = ts.createSourceFile('auxiliary.ts', readFileSync('lib/validation/auxiliary.ts', 'utf8'), ts.ScriptTarget.Latest, true);
function declaration(name) {
  let result;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(auxiliary) === name) result = `const ${node.getText(auxiliary)};`;
    ts.forEachChild(node, visit);
  };
  visit(auxiliary);
  assert.ok(result, `${name} exists in production`);
  return result;
}
const completionCode = ts.transpileModule(`${declaration('leadTaskTypeSchema')}\n${declaration('cadenceTaskCompletionInputSchema')}`,
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
const completion = Function('z', 'uuidSchema', `${completionCode}; return cadenceTaskCompletionInputSchema;`)(z, common.uuidSchema);
const ID = '11111111-1111-4111-8111-111111111111';
const command = { commandId: ID, content: ' Feedback sintético ' };

test('feedback validates and trims a command without changing its identity', () => {
  assert.deepEqual(feedback.leadFeedbackCommandSchema.parse(command), { commandId: ID, content: 'Feedback sintético' });
});
test('feedback rejects empty text, invalid command identity and unknown fields', () => {
  for (const input of [{ ...command, content: '  ' }, { ...command, commandId: 'retry' }, { ...command, leadId: ID }]) {
    assert.equal(feedback.leadFeedbackCommandSchema.safeParse(input).success, false);
  }
});
test('feedback accepts 2000 Unicode codepoints and rejects 2001 without truncating the input', () => {
  assert.equal(feedback.leadFeedbackCommandSchema.parse({ ...command, content: '🙂'.repeat(2000) }).content.length, 4000);
  const input = { ...command, content: '🙂'.repeat(2001) };
  assert.equal(feedback.leadFeedbackCommandSchema.safeParse(input).success, false);
  assert.equal(Array.from(input.content).length, 2001);
});
test('receipt requires the persisted command, lead, activity and time', () => {
  const receipt = { commandId: ID, leadId: ID, activityId: ID, recordedAt: '2026-10-17T12:00:00Z' };
  assert.equal(feedback.leadFeedbackResponseSchema.safeParse({ data: receipt }).success, true);
  for (const field of Object.keys(receipt)) {
    const missing = { ...receipt }; delete missing[field];
    assert.equal(feedback.leadFeedbackResponseSchema.safeParse({ data: missing }).success, false);
  }
});
test('cadence rejects notes beyond the persisted server limit before a request', () => {
  const input = { leadId: ID, taskId: ID, outcome: 'answered', outcomeNotes: 'a'.repeat(1001) };
  assert.equal(completion.safeParse(input).success, false);
  assert.equal(input.outcomeNotes.length, 1001);
});
test('cadence uses the same Unicode and surrounding-space limit as its server', () => {
  const notes = `  ${'🙂'.repeat(1000)}  `;
  assert.equal(completion.parse({ leadId: ID, taskId: ID, outcomeNotes: notes }).outcomeNotes, notes);
  assert.equal(completion.safeParse({ leadId: ID, taskId: ID, outcomeNotes: '🙂'.repeat(1001) }).success, false);
});
