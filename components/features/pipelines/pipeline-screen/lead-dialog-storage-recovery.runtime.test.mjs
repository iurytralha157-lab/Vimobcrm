import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sourcePath = process.env.LEAD_DIALOG_BOUNDARY_SOURCE || resolve(repository,
  'components/features/pipelines/pipeline-screen/LeadDialogErrorBoundary.tsx');
const source = readFileSync(sourcePath, 'utf8');
const key = 'vimob:lead-dialog-chunk-reload-at';
const now = 1_800_000_000_000;
const windowMs = 5 * 60 * 1000;
const chunk = () => new Error('ChunkLoadError: Failed to load chunk /_next/static/chunks/lead.js');
const Button = () => null;
const dialogs = Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogHeader', 'DialogTitle']
  .map(name => [name, () => null]));

function compile(text, dependencies, environment = {}) {
  const code = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  Function('require', 'exports', ...Object.keys(environment), code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`);
    return dependencies[name];
  }, exports, ...Object.values(environment));
  return exports;
}

const errors = compile(readFileSync(resolve(repository, 'lib/api/vimob-error.ts'), 'utf8'), {});

function harness({ previous = null, failure, ssr = false, reloadFailure = false } = {}) {
  const calls = [], notices = [];
  let closed = 0;
  const storage = {
    getItem(name) {
      calls.push(['get', name]);
      if (failure === 'read') throw new DOMException('Synthetic read denied', 'SecurityError');
      return previous;
    },
    setItem(name, value) {
      calls.push(['set', name, value]);
      if (failure === 'write') throw new DOMException('Synthetic quota exceeded', 'QuotaExceededError');
      previous = value;
    },
  };
  const window = {
    get sessionStorage() {
      if (failure === 'getter') throw new DOMException('Synthetic storage denied', 'SecurityError');
      return storage;
    },
    location: { reload() {
      calls.push(['reload']);
      if (reloadFailure) throw new Error('Synthetic reload blocked');
    } },
  };
  const { LeadDialogErrorBoundary: Boundary } = compile(source, {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@/components/ui/button': { Button }, '@/components/ui/dialog': dialogs,
    './model': { getPipelineErrorMessage: errors.getErrorObjectMessage },
  }, { window: ssr ? undefined : window, Date: { now: () => now }, console: { error: (...args) => notices.push(args) } });
  const boundary = new Boundary({ leadId: 'synthetic-lead-a', children: 'Synthetic content', onClose: () => { closed++; } });
  function catchError(error = chunk(), target = boundary) {
    target.state = { ...target.state, ...Boundary.getDerivedStateFromError(error) };
    target.componentDidCatch(error, { componentStack: '\nSyntheticLeadChild' });
    return target;
  }
  return { Boundary, boundary, calls, notices, catchError, storage, closed: () => closed };
}

function findButton(node) {
  if (!React.isValidElement(node)) return null;
  if (node.type === Button) return node;
  return React.Children.toArray(node.props.children).map(findButton).find(Boolean) || null;
}

for (const failure of ['getter', 'read', 'write']) {
  test(`chunk recovery retains its local fallback when sessionStorage ${failure} fails`, () => {
    const h = harness({ failure });
    assert.doesNotThrow(() => h.catchError());
    assert.equal(h.calls.some(([operation]) => operation === 'reload'), false);
    assert.equal(h.boundary.render().type, dialogs.Dialog);
    assert.equal(findButton(h.boundary.render()).props.children, 'Recarregar');
    assert.equal(h.notices.length, 1, 'The original child failure remains logged');
    if (failure === 'getter') assert.deepEqual(h.calls, []);
    if (failure === 'read') assert.deepEqual(h.calls, [['get', key]]);
    if (failure === 'write') assert.deepEqual(h.calls, [['get', key], ['set', key, String(now)]]);
  });

  test(`manual reload remains usable after sessionStorage ${failure} failure`, () => {
    const h = harness({ failure });
    h.catchError();
    const before = h.calls.length;
    findButton(h.boundary.render()).props.onClick();
    assert.deepEqual(h.calls.slice(before), [['reload']], 'Explicit reload never needs storage');
  });

  test(`a remount cannot auto-reload repeatedly when sessionStorage ${failure} is unavailable`, () => {
    const h = harness({ failure });
    h.catchError();
    const next = new h.Boundary({ ...h.boundary.props, leadId: 'synthetic-lead-b' });
    assert.doesNotThrow(() => h.catchError(chunk(), next));
    assert.equal(h.calls.some(([operation]) => operation === 'reload'), false);
    assert.equal(findButton(next.render()).props.children, 'Recarregar');
  });
}

for (const [label, previous, reload] of [
  ['first attempt', null, true],
  ['recent attempt', String(now - 60_000), false],
  ['exact five-minute boundary', String(now - windowMs), false],
  ['expired attempt', String(now - windowMs - 1), true],
  ['future stored timestamp', String(now + 60_000), false],
]) test(`automatic reload preserves its existing cooldown for ${label}`, () => {
  const h = harness({ previous });
  h.catchError();
  assert.deepEqual(h.calls, reload ? [['get', key], ['set', key, String(now)], ['reload']] : [['get', key]]);
  if (reload) {
    h.catchError();
    assert.equal(h.calls.filter(([operation]) => operation === 'reload').length, 1,
      'A persisted guard prevents another automatic reload');
  }
});

test('ordinary render errors never access storage and retain the close action', () => {
  const h = harness({ failure: 'getter' });
  const error = new Error('Synthetic ordinary lead failure');
  assert.doesNotThrow(() => h.catchError(error));
  assert.deepEqual(h.calls, []);
  const button = findButton(h.boundary.render());
  assert.equal(button.props.children, 'Fechar');
  button.props.onClick();
  assert.equal(h.closed(), 1);
  assert.equal(h.boundary.state.error, error);
});

test('server-side invocation does not require browser storage or navigation', () => {
  const h = harness({ ssr: true, failure: 'getter' });
  assert.doesNotThrow(() => h.catchError());
  assert.deepEqual(h.calls, []);
});

test('a failed automatic navigation retains the local error fallback', () => {
  const h = harness({ reloadFailure: true });
  assert.doesNotThrow(() => h.catchError());
  assert.deepEqual(h.calls, [['get', key], ['set', key, String(now)], ['reload']]);
  assert.equal(findButton(h.boundary.render()).props.children, 'Recarregar');
});

test('healthy children and lead identity reset keep their existing behavior', () => {
  const h = harness();
  assert.equal(h.boundary.render(), 'Synthetic content');
  h.catchError(new Error('Synthetic failure'));
  assert.equal(h.Boundary.getDerivedStateFromProps(h.boundary.props, h.boundary.state), null);
  assert.deepEqual(h.Boundary.getDerivedStateFromProps({ ...h.boundary.props, leadId: 'synthetic-lead-b' }, h.boundary.state),
    { error: null, leadId: 'synthetic-lead-b' });
  assert.deepEqual(h.calls, []);
});
