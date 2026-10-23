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
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleExport') handle = node.initializer;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect') layout = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
function compile(expression: ts.Expression | undefined, dependencies: Record<string, unknown>) {
  assert.ok(expression);
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

type ExportTask = { signal: AbortSignal; requestIntent: { expectedUserId: string; expectedSessionId: string }; shouldContinue: () => boolean; onProgress: (value: unknown) => void };
function harness() {
  const identity = { organization: 'org-a', actor: 'actor-a', session: 'session-a', token: 'token-a', open: true };
  const state = { exporting: false, completed: null as number | null, errors: [] as string[], requests: [] as ExportTask[], progress: [] as unknown[] };
  const exportScope = createLeadImportScope();
  const abortControllerRef = { current: null as AbortController | null };
  let settle: (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  const dependencies = {
    exportScope, abortControllerRef, captureLeadRequestIntent,
    selectedColumns: new Set(['nome']), format: 'csv', totalCount: 1, filters: {}, includeDynamicFields: false,
    getVimobAPIAccessTokenUserId: () => identity.actor,
    getVimobAPIAccessTokenSessionId: () => identity.session,
    localDateStamp: () => 'synthetic', isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
    setIsExporting: (value: boolean) => { state.exporting = value; }, onExportingChange: () => {},
    setCompletedCount: (value: number | null) => { state.completed = value; },
    setErrorMessage: (value: string | null) => { if (value) state.errors.push(value); },
    setProgress: (value: unknown) => { state.progress.push(value); },
    exportContactsFiltered: async (options: ExportTask) => {
      state.requests.push(options);
      await new Promise<void>(resolve => { settle = resolve; });
      options.onProgress({ phase: 'downloading', processed: 1, total: 1 });
      return 1;
    },
  };
  const render = () => {
    cleanup?.();
    const values = { ...dependencies, organizationId: identity.organization, user: { id: identity.actor }, sessionId: identity.session,
      scopeKey: contactImportScopeKey(identity.organization, identity.actor, identity.session), open: identity.open };
    cleanup = compile(layout, values)();
    return compile(handle, values) as () => Promise<void>;
  };
  return { identity, state, render, resolve: () => settle?.(), unmount: () => cleanup?.() };
}

test('actual export handler pins actor/SID and permits token renewal within the same session', async () => {
  const f = harness();
  const task = f.render()();
  assert.deepEqual(f.state.requests[0].requestIntent, { expectedUserId: 'actor-a', expectedSessionId: 'session-a' });
  f.identity.token = 'renewed-token';
  assert.equal(f.state.requests[0].shouldContinue(), true);
  f.resolve(); await task;
  assert.equal(f.state.completed, 1);
  assert.equal(f.state.exporting, false);
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
