import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { uploadLeadFiles } from '../../../lib/lead-edit-session.ts';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('./LeadAttachmentRecovery.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('LeadAttachmentRecovery.tsx', source, ts.ScriptTarget.Latest, true);
let retry;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText() === 'retry') retry = node.getText(file); ts.forEachChild(node, visit); }
visit(file);
assert.ok(retry);
function fixture(uploadFile) {
  const active = { current: true }, runningRef = { current: false }, events = [], requests = [];
  const deps = {
    active, runningRef, canUpload: true, leadId: 'lead', pending: ['a', 'b'], uploadLeadFiles,
    setRunning: value => events.push(['running', value]), onRunningChange: value => events.push(['parent', value]),
    setPending: value => events.push(['pending', value]), onFinish: () => events.push(['finish']),
    upload: { mutateAsync: async input => { requests.push(input); return uploadFile(input); } },
  };
  const code = ts.transpileModule(`const ${retry}`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return { run: Function(...Object.keys(deps), `${code}; return retry;`)(...Object.values(deps)), active, events, requests };
}
test('actual document retry prevents concurrent attempts and ignores results after the form unmounts', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture(async () => pending);
  const first = f.run();
  const repeated = f.run();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.events.slice(0, 2), [['running', true], ['parent', true]]);
  f.active.current = false;
  resolve();
  await Promise.all([first, repeated]);
  assert.equal(f.requests.length, 1);
  assert.ok(!f.events.some(([name]) => name === 'finish' || name === 'pending'));
});
test('actual document retry keeps only failed files and releases the close guard', async () => {
  const f = fixture(async ({ file }) => { if (file === 'b') throw new Error('rejected'); });
  await f.run();
  assert.deepEqual(f.events.find(([name]) => name === 'pending'), ['pending', ['b']]);
  assert.deepEqual(f.events.at(-1), ['parent', false]);
  assert.ok(!f.events.some(([name]) => name === 'finish'));
});
