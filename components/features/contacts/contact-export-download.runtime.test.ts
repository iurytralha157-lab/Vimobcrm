import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { readAccessTokenClaims } from '@/lib/auth/password-recovery';

const source = readFileSync(new URL('./ExportContactsDialog.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ExportContactsDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = new Map<string, ts.Expression>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.initializer) expressions.set(node.name.getText(ast), node.initializer);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect') expressions.set('layout', node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
function compile(name: string, dependencies: Record<string, unknown>) {
  const expression = expressions.get(name);
  assert.ok(expression, name);
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

type Prepared = { href: string; filename: string; dispose: () => void; isCurrent: () => boolean };
type ExportTask = { signal: AbortSignal; onProgress: (value: unknown) => void; onFileReady: (file: { blob: Blob; filename: string }) => void };
function harness() {
  const identity = { organization: 'org-a', actor: 'actor-a', sid: 'sid-a', tokenVersion: 1, open: true, filters: '{}' };
  const state = { exporting: false, prepared: null as Prepared | null, count: null as number | null,
    calls: [] as ExportTask[], created: 0, disposed: 0, errors: [] as string[], progress: [] as unknown[] };
  const scopeRef = { current: { generation: 0, ownerKey: null as string | null, active: false } };
  const abortControllerRef = { current: null as AbortController | null };
  const preparedDownloadRef = { current: null as Prepared | null };
  let resolve: ((count: number) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  let currentTask: ExportTask | undefined;
  let cleanup: (() => void) | undefined;
  let previousEffectKey: string | undefined;
  const dependencies = {
    scopeRef, abortControllerRef, preparedDownloadRef,
    selectedColumns: new Set(['nome']), format: 'csv', totalCount: 1, filters: {}, includeDynamicFields: false,
    localDateStamp: () => 'synthetic',
    isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    setIsExporting: (value: boolean) => { state.exporting = value; },
    onExportingChange: () => {},
    setCompletedCount: (value: number | null) => { state.count = value; },
    setPreparedDownload: (value: Prepared | null) => { state.prepared = value; },
    setErrorMessage: (value: string | null) => { if (value) state.errors.push(value); },
    setProgress: (value: unknown) => { state.progress.push(value); },
    onOpenChange: (value: boolean) => { identity.open = value; },
    createContactExportDownload: (file: { filename: string }) => {
      state.created += 1;
      let active = true;
      return { href: `blob:synthetic-${state.created}`, filename: file.filename,
        dispose: () => { if (active) { active = false; state.disposed += 1; } } };
    },
    exportContactsFiltered: (options: ExportTask) => {
      state.calls.push(options); currentTask = options;
      return new Promise<number>((done, fail) => { resolve = done; reject = fail; });
    },
  };
  const clearRunFeedback = compile('clearRunFeedback', dependencies) as () => void;
  const render = () => {
    const token = `synthetic.${Buffer.from(JSON.stringify({ session_id: identity.sid, version: identity.tokenVersion })).toString('base64url')}.synthetic`;
    const claims = readAccessTokenClaims(token);
    const values = { ...dependencies, clearRunFeedback, organizationId: identity.organization,
      user: { id: identity.actor }, sessionId: claims?.session_id, open: identity.open, isExporting: state.exporting };
    const ownerKey = compile('ownerKey', values) as string | null;
    const effectKey = JSON.stringify([ownerKey, identity.filters]);
    if (effectKey !== previousEffectKey) {
      cleanup?.(); cleanup = compile('layout', { ...values, ownerKey })(); previousEffectKey = effectKey;
    }
    return compile('handleExport', { ...values, ownerKey }) as () => Promise<void>;
  };
  return {
    identity, state, render, clearRunFeedback,
    ready() {
      try { currentTask?.onFileReady({ blob: new Blob(['synthetic']), filename: 'synthetic.csv' }); resolve?.(1); }
      catch (error) { reject?.(error as Error); }
    },
    fail(error: Error) { reject?.(error); },
    missingFile() { resolve?.(1); },
    close() { compile('handleOpenChange', { ...dependencies, clearRunFeedback, isExporting: state.exporting })(false); },
    click() {
      let prevented = false;
      compile('handleDownload', { ...dependencies, clearRunFeedback, preparedDownload: state.prepared })({ preventDefault: () => { prevented = true; } });
      return prevented;
    },
    unmount() { cleanup?.(); },
  };
}

test('actual legacy dialog prepares a reusable link and only one export for repeated clicks', async () => {
  const f = harness();
  const start = f.render();
  const task = start();
  await start();
  assert.equal(f.state.calls.length, 1);
  f.ready(); await task;
  assert.equal(f.state.prepared?.filename, 'synthetic.csv');
  assert.equal(f.state.count, 1);
  assert.equal(f.click(), false); assert.equal(f.click(), false);
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.disposed, 0);
  assert.match(source, /<a href=\{preparedDownload.href\} download=\{preparedDownload.filename\} onClick=\{handleDownload\}>Baixar arquivo<\/a>/);
  assert.doesNotMatch(source, /\.click\(/);
  f.close();
  assert.equal(f.state.prepared, null); assert.equal(f.state.disposed, 1);
  f.unmount(); assert.equal(f.state.disposed, 1);
});

test('token renewal within one SID and ordinary renders retain the prepared file', async () => {
  const f = harness(); const task = f.render()(); f.ready(); await task;
  const href = f.state.prepared?.href;
  f.identity.tokenVersion += 1; f.render(); f.render();
  assert.equal(f.state.prepared?.href, href); assert.equal(f.click(), false);
  assert.equal(f.state.disposed, 0); f.unmount();
});

test('changed actor, SID, organization, filters, close and unmount revoke ready files', async () => {
  for (const change of ['actor', 'sid', 'organization', 'filters', 'open', 'unmount'] as const) {
    const f = harness(); const task = f.render()(); f.ready(); await task;
    if (change === 'unmount') f.unmount();
    else { if (change === 'open') f.identity.open = false; else f.identity[change] = 'changed'; f.render(); }
    assert.equal(f.state.prepared, null, change); assert.equal(f.state.count, null, change);
    assert.equal(f.state.disposed, 1, change); assert.equal(f.click(), true, change);
    f.unmount(); assert.equal(f.state.disposed, 1, change);
  }
});

test('configuration changes discard a previous artifact before it can be downloaded', async () => {
  const f = harness(); const task = f.render()(); f.ready(); await task;
  f.clearRunFeedback();
  assert.equal(f.state.prepared, null); assert.equal(f.state.count, null);
  assert.equal(f.click(), true); assert.equal(f.state.disposed, 1); f.unmount();
});

test('late file callbacks cannot revive an old run after A-B-A or unmount', async () => {
  for (const change of ['actor', 'sid', 'organization', 'filters', 'open', 'unmount'] as const) {
    const f = harness(); const task = f.render()(); const previous = { ...f.identity };
    if (change === 'unmount') f.unmount();
    else {
      if (change === 'open') f.identity.open = false; else f.identity[change] = 'changed';
      f.render(); Object.assign(f.identity, previous); f.render();
    }
    f.ready(); await task;
    assert.equal(f.state.created, 0, change); assert.equal(f.state.prepared, null, change);
    assert.equal(f.state.count, null, change); assert.deepEqual(f.state.errors, [], change); f.unmount();
  }
});

test('failure, cancellation or absent file callback cannot announce a ready file', async () => {
  for (const kind of ['error', 'abort', 'missing'] as const) {
    const f = harness(); const task = f.render()();
    if (kind === 'missing') f.missingFile();
    else f.fail(kind === 'abort' ? new DOMException('Canceled', 'AbortError') : new Error('Synthetic failure'));
    await task;
    assert.equal(f.state.prepared, null); assert.equal(f.state.count, null);
    assert.equal(f.state.exporting, false); assert.equal(f.state.errors.length, 1); f.unmount();
  }
});
