import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  let state;
  const record = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./use-password-recovery-form.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: record.exports, module: record, require: name => {
    assert.equal(name, 'react');
    return { useState: initial => {
      state ??= typeof initial === 'function' ? initial() : initial;
      return [state, update => { state = typeof update === 'function' ? update(state) : update; }];
    } };
  } });
  return identity => record.exports.usePasswordRecoveryForm(identity);
}

test('a new recovery identity renders with no loading, passwords, errors or visibility from A', () => {
  const render = harness(), a = render('a/sid-a');
  a.setPassword('Synthetic-password-a1!'); a.setConfirmPassword('Synthetic-password-a1!');
  a.setLoading(true); a.setErrors({ password: 'synthetic A error' }); a.setShowPassword(true);
  assert.equal(render('a/sid-a').loading, true);
  const b = render('b/sid-b');
  assert.equal(b.loading, false); assert.equal(b.password, ''); assert.equal(b.confirmPassword, '');
  assert.equal(Object.keys(b.errors).length, 0); assert.equal(b.showPassword, false);
});
test('stale A setters cannot clear B or release its in-flight request', () => {
  const render = harness(), a = render('a/sid-a'), b = render('b/sid-b');
  b.setPassword('Synthetic-password-b1!'); b.setLoading(true);
  a.setPassword(''); a.setLoading(false); a.setErrors({ password: 'stale A error' });
  const current = render('b/sid-b');
  assert.equal(current.password, 'Synthetic-password-b1!'); assert.equal(current.loading, true);
  assert.equal(Object.keys(current.errors).length, 0);
});
test('a new session for the same user also resets the form before it is presented', () => {
  const render = harness(), first = render('a/sid-a'); first.setPassword('Synthetic-password-a1!'); first.setLoading(true);
  const next = render('a/new-sid-a'); assert.equal(next.loading, false); assert.equal(next.password, '');
});
