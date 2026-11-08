import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import { captureLeadRequestIntent } from '@/lib/lead-request-intent';

const source = readFileSync(new URL('./ExportContactsDialog.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ExportContactsDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handle: ts.Expression | undefined;
let layout: ts.Expression | undefined;
let downloadHandle: ts.Expression | undefined;
let clearFeedback: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleExport') handle = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleDownload') downloadHandle = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'clearRunFeedback') clearFeedback = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect') layout = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
function compile(expression: ts.Expression | undefined, dependencies: Record<string, unknown>) {
  assert.ok(expression);
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

type ExportTask = { signal: AbortSignal; requestIntent: { expectedUserId: string; expectedSessionId: string }; shouldContinue: () => boolean; onProgress: (value: unknown) => void; onFileReady: (file: { blob: Blob; filename: string }) => void };
type PreparedDownload = { href: string; filename: string; dispose: () => void; isCurrent: () => boolean };
function harness() {
  const identity = { organization: 'org-a', actor: 'actor-a', session: 'session-a', token: 'token-a', open: true };
  const state = { exporting: false, completed: null as number | null, prepared: null as PreparedDownload | null, filesCreated: 0, filesDisposed: 0, errors: [] as string[], requests: [] as ExportTask[], progress: [] as unknown[] };
  const exportScope = createLeadImportScope();
  const abortControllerRef = { current: null as AbortController | null };
  const preparedDownloadRef = { current: null as PreparedDownload | null };
  let settle: (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  const dependencies = {
    exportScope, abortControllerRef, preparedDownloadRef, captureLeadRequestIntent,
    selectedColumns: new Set(['nome']), format: 'csv', totalCount: 1, filters: {}, includeDynamicFields: false,
    getVimobAPIAccessTokenUserId: () => identity.actor,
    getVimobAPIAccessTokenSessionId: () => identity.session,
    localDateStamp: () => 'synthetic', isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    setIsExporting: (value: boolean) => { state.exporting = value; }, onExportingChange: () => {},
    setCompletedCount: (value: number | null) => { state.completed = value; },
    setPreparedDownload: (value: PreparedDownload | null) => { state.prepared = value; },
    createContactExportDownload: (file: { filename: string }) => {
      state.filesCreated += 1;
      let active = true;
      return { href: `blob:synthetic-${state.filesCreated}`, filename: file.filename, dispose: () => {
        if (active) { active = false; state.filesDisposed += 1; }
      } };
    },
    setErrorMessage: (value: string | null) => { if (value) state.errors.push(value); },
    setProgress: (value: unknown) => { state.progress.push(value); },
    exportContactsFiltered: async (options: ExportTask) => {
      state.requests.push(options);
      await new Promise<void>(resolve => { settle = resolve; });
      if (options.signal.aborted || !options.shouldContinue()) throw new DOMException('Canceled', 'AbortError');
      options.onFileReady({ blob: new Blob(['synthetic']), filename: 'synthetic.csv' });
      options.onProgress({ phase: 'downloading', processed: 1, total: 1 });
      return 1;
    },
  };
  const clearRunFeedback = compile(clearFeedback, dependencies) as () => void;
  const render = () => {
    cleanup?.();
    const values = { ...dependencies, clearRunFeedback, organizationId: identity.organization, user: { id: identity.actor }, sessionId: identity.session,
      scopeKey: contactImportScopeKey(identity.organization, identity.actor, identity.session), open: identity.open };
    cleanup = compile(layout, values)();
    return compile(handle, values) as () => Promise<void>;
  };
  const clickDownload = () => {
    let prevented = false;
    const handler = compile(downloadHandle, { ...dependencies, clearRunFeedback, preparedDownload: state.prepared }) as (event: { preventDefault: () => void }) => void;
    handler({ preventDefault: () => { prevented = true; } });
    return { prevented };
  };
  return { identity, state, render, clickDownload, clearRunFeedback, resolve: () => settle?.(), unmount: () => cleanup?.() };
}

test('actual export handler pins actor/SID and permits token renewal within the same session', async () => {
  const f = harness();
  const task = f.render()();
  assert.deepEqual(f.state.requests[0].requestIntent, { expectedUserId: 'actor-a', expectedSessionId: 'session-a' });
  f.identity.token = 'renewed-token';
  assert.equal(f.state.requests[0].shouldContinue(), true);
  f.resolve(); await task;
  assert.equal(f.state.completed, 1);
  assert.equal(f.state.prepared?.filename, 'synthetic.csv');
  assert.equal(f.state.exporting, false);
  f.unmount();
});

test('a prepared file remains available for repeated explicit downloads without new API calls', async () => {
  const f = harness();
  const task = f.render()();
  f.resolve(); await task;
  assert.deepEqual(f.clickDownload(), { prevented: false });
  assert.deepEqual(f.clickDownload(), { prevented: false });
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.filesCreated, 1);
  assert.equal(f.state.filesDisposed, 0);
  f.unmount();
  assert.equal(f.state.filesDisposed, 1);
  assert.equal(f.state.prepared, null);
});

test('ready files are revoked when session, actor, organization, or dialog scope changes', async () => {
  for (const change of ['session', 'actor', 'organization', 'open'] as const) {
    const f = harness();
    const task = f.render()();
    f.resolve(); await task;
    if (change === 'open') f.identity.open = false;
    else f.identity[change] = 'changed';
    // Actor/SID changes are observable before React commits new scope props.
    assert.deepEqual(f.clickDownload(), { prevented: change === 'session' || change === 'actor' });
    f.render();
    assert.deepEqual(f.clickDownload(), { prevented: true });
    assert.equal(f.state.prepared, null);
    assert.equal(f.state.filesDisposed, 1);
    f.unmount();
    assert.equal(f.state.filesDisposed, 1);
  }
});

test('changing export options discards the prepared file and previous completion message', async () => {
  const f = harness();
  const task = f.render()();
  f.resolve(); await task;
  f.clearRunFeedback();
  assert.equal(f.state.filesDisposed, 1);
  assert.equal(f.state.prepared, null);
  assert.equal(f.state.completed, null);
  assert.deepEqual(f.clickDownload(), { prevented: true });
  f.unmount();
});

test('actual layout cleanup aborts a previous export for a new SID, org, actor or unmount', async () => {
  for (const change of ['session', 'organization', 'actor', 'unmount'] as const) {
    const f = harness();
    const task = f.render()();
    const request = f.state.requests[0];
    if (change === 'unmount') f.unmount();
    else { f.identity[change] = 'changed'; f.render(); }
    assert.equal(request.signal.aborted, true);
    assert.equal(request.shouldContinue(), false);
    f.resolve(); await task;
    assert.equal(f.state.completed, null);
    assert.equal(f.state.exporting, false);
    assert.deepEqual(f.state.errors, []);
  }
});

test('the running export cannot revive after A-B-A and detects identity changes before React cleanup', async () => {
  const f = harness();
  const task = f.render()();
  const request = f.state.requests[0];
  f.identity.session = 'session-b';
  assert.equal(request.shouldContinue(), false);
  f.render(); f.identity.session = 'session-a'; f.render();
  assert.equal(request.shouldContinue(), false);
  f.resolve(); await task;
  assert.equal(f.state.completed, null);
  f.unmount();
});
