import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MutationObserver, QueryClient } from '@tanstack/query-core';
import { captureQueryClientAccess } from '../../../../lib/access/query-client-access.ts';

// Actual UI callbacks, mutation hooks and access-intent helpers. Only auth and
// transport are synthetic. No browser, app server, filesystem writes or DB.
const require = createRequire(import.meta.url), ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const beforeDirectory = process.env.VIMOB_DELETE_CONFIRMATION_BEFORE_DIR;
const r1 = '2026-10-16T12:00:00.123456Z', r2 = '2026-10-16T12:00:00.123457Z';
const id = '11111111-1111-4111-8111-111111111111';
const org = '33333333-3333-4333-8333-333333333333';

function transpile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
}
function evaluate(source, environment, exports = []) {
  return new Function(...Object.keys(environment), `${transpile(source)}\nreturn {${exports.join(',')}};`)(...Object.values(environment));
}
function declarations(source, names, kind = 'variable') {
  const tree = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names.map(name => {
    let found;
    const visit = node => {
      if ((kind === 'variable' ? ts.isVariableDeclaration(node) : ts.isFunctionDeclaration(node)) && node.name?.getText(tree) === name) found = node;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert(found, `Actual source declaration exists: ${name}`);
    return kind === 'variable' ? `const ${found.getText(tree)};` : found.getText(tree).replace(/^export\s+/, '');
  }).join('\n');
}
async function moduleFromFile(relative, imports) {
  const moduleRecord = { exports: {} };
  evaluate(await readFile(path.join(root, relative), 'utf8'), {
    module: moduleRecord, exports: moduleRecord.exports,
    require: name => { assert(name in imports, `Explicit import stub: ${name}`); return imports[name]; },
  });
  return moduleRecord.exports;
}
async function createHarness(kind) {
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity },
  } });
  const cleanups = [], observers = [], requests = [], pending = [];
  const notices = [], state = { target: null, blocked: false, error: null, refresh: false, reads: 0 };
  const react = { useRef: value => ({ current: value }), useMemo: factory => factory(),
    useLayoutEffect: effect => cleanups.push(effect()), useCallback: fn => fn };
  const errors = await moduleFromFile('lib/api/vimob-error.ts', {});
  const imports = {
    react, '@tanstack/react-query': { useQueryClient: () => client },
    '@/contexts/AuthContext': { useAuth: () => ({ activeOrganization: { organizationId: org },
      user: { id: '44444444-4444-4444-8444-444444444444' }, session: {},
      tenantContext: { status: 'ready' }, impersonating: null }) },
    '@/lib/auth/global-sign-out': { getGlobalSignOutSessionId: () => 'synthetic-sid' },
    '@/lib/api/vimob-error': errors,
    '@/lib/access/query-client-access': { captureQueryClientAccess },
  };
  const helperPath = kind === 'stage' ? 'hooks/pipelines/use-stage-delete-intent.ts' : 'hooks/automations/use-stage-automation-mutation-scope.ts';
  const helper = await moduleFromFile(helperPath, imports);
  const toast = Object.fromEntries(['success', 'error', 'info'].map(type => [type, message => notices.push({ type, message })]));
  const transport = async (rowId, revision, organizationId, intent) => {
    assert.equal(rowId, id); assert.equal(organizationId, org); assert.equal(intent.expectedSessionId, 'synthetic-sid');
    assert.equal(intent.signal.aborted, false);
    requests.push(revision);
    if (revision === r1) throw new errors.VimobAPIError('Synthetic concurrent change', {
      status: 409, code: kind === 'stage' ? 'pipeline_stages_changed' : 'stage_automation_changed',
    });
    assert.equal(revision, r2);
  };
  const useMutation = options => {
    const observer = new MutationObserver(client, options); observers.push(observer);
    return { isPending: false, mutateAsync: variables => {
      const promise = observer.mutate(variables); pending.push(promise); return promise;
    } };
  };
  const hookPath = kind === 'stage' ? 'hooks/use-stages.ts' : 'hooks/use-stage-automations.ts';
  const hookName = kind === 'stage' ? 'useDeleteStage' : 'useDeleteStageAutomation';
  const hookSource = declarations(await readFile(path.join(root, hookPath), 'utf8'), [hookName], 'function');
  const hook = evaluate(hookSource, { ...helper, ...errors, useMutation, toast,
    pipelinesAPI: { deleteStage: transport }, stageConfigAPI: { deleteStageAutomation: transport },
  }, [hookName])[hookName]();
  const uiFile = kind === 'stage' ? 'StagesEditorDialog.tsx' : 'AutomationsList.tsx';
  const uiPath = beforeDirectory ? path.join(beforeDirectory, uiFile.replace('.tsx', '.before-conflict-retire.tsx'))
    : path.join(root, 'components/features', kind === 'stage' ? 'pipelines' : 'automations', uiFile);
  const ui = await readFile(uiPath, 'utf8');
  const names = kind === 'stage' ? ['closeDeletion', 'handleDeleteStage', 'requestDeleteStage']
    : ['runMutation', 'closeDeletion', 'openDeletion', 'confirmDeletion', 'refreshVersion'];
  const uiSource = declarations(ui, names);
  const deletion = { current: null }, inFlight = { current: false };
  let row = { id, name: 'Synthetic item', updated_at: r1 };
  const render = () => {
    const shared = {
      ...react, ...errors, toast, deletion, deleteConflict: state.blocked,
      setDeleteConflict: value => { state.blocked = value; },
      getErrorMessage: error => error.message,
    };
    return evaluate(uiSource, kind === 'stage' ? { ...shared,
      open: true, deleteStageMutation: hook, deleteStage: state.target,
      deleteInFlightRef: inFlight, stages: [row], sortedInitialStages: [row],
      isMutating: false, canSave: false, editingId: null, isAdding: false,
      setDeleteStage: value => { state.target = value; }, setDeleteError: value => { state.error = value; },
      setDraftStages: stages => { state.draft = stages; },
    } : { ...shared,
      deleteAutomation: hook, deletingAutomation: state.target, canEdit: true, isSaving: false,
      needsVersionRefresh: state.refresh, mutationInFlight: inFlight, mounted: { current: true },
      query: { isError: false, refetch: async () => { state.reads++; return {}; } },
      onSavingChange: () => {}, setPendingAutomationId: () => {},
      setNeedsVersionRefresh: value => { state.refresh = value; },
      setMutationError: value => { state.error = value; },
      setDeletingAutomation: value => { state.target = value; },
    }, names);
  };
  return { state, requests, hook, deletion, notices,
    render, row: () => row, updateRow: () => { row = { ...row, updated_at: r2 }; },
    // Wait for the real MutationObserver plus the async UI catch/finally.
    drain: async () => { await Promise.allSettled(pending.splice(0)); await new Promise(setImmediate); },
    cleanup: () => { for (const cleanup of cleanups) cleanup?.(); for (const observer of observers) observer.reset(); client.clear(); },
  };
}

for (const kind of ['stage', 'automation']) {
  test(`${kind}: 409 retires the retained confirm callback; cancel and explicit reopen use R2${beforeDirectory ? ' (before-fix proof)' : ''}`, async () => {
    const h = await createHarness(kind);
    try {
      let ui = h.render();
      if (kind === 'stage') ui.requestDeleteStage(h.row()); else ui.openDeletion(h.row());
      const original = h.state.target; assert(original);
      const input = kind === 'stage' ? original.input : original;
      assert.equal(h.hook.isCurrent(input), true);
      const retained = h.render();
      const confirm = () => kind === 'stage' ? retained.handleDeleteStage() : retained.confirmDeletion(original);
      h.updateRow(); // Simulated refetch updates the row while confirmation still owns R1.
      await confirm(); await h.drain();
      assert.equal(h.state.blocked, true);
      assert.match(h.state.error, /Feche esta confirmação/);
      assert.equal(h.state.target, original, 'Conflict preserves the visible confirmation context');
      assert.deepEqual(h.requests, [r1], 'First request keeps the revision captured when opening');
      assert.equal(h.hook.isCurrent(input), Boolean(beforeDirectory), 'Conflict invalidates the executable token');
      await confirm(); await h.drain();
      assert.deepEqual(h.requests, beforeDirectory ? [r1, r1] : [r1], 'A pre-conflict callback cannot resend after the current render is blocked');
      retained.closeDeletion(original);
      assert.equal(h.state.target, null); assert.equal(h.deletion.current, null);
      assert.equal(h.state.blocked, false, 'Cancel works even when the original token was retired');
      ui = h.render();
      if (kind === 'automation') { await ui.refreshVersion(); ui = h.render(); }
      if (kind === 'stage') ui.requestDeleteStage(h.row()); else ui.openDeletion(h.row());
      assert(h.state.target); assert.notEqual(h.state.target, original);
      const reopened = h.render(), target = h.state.target;
      await confirm(); await h.drain();
      assert.equal(h.state.target, target, 'The old callback cannot erase or send the new confirmation');
      if (kind === 'stage') await reopened.handleDeleteStage(); else reopened.confirmDeletion(target);
      await h.drain();
      assert.deepEqual(h.requests, beforeDirectory ? [r1, r1, r2] : [r1, r2]);
      assert.equal(h.state.target, null); assert.equal(h.deletion.current, null);
      assert.equal(h.state.blocked, false);
      if (kind === 'stage') assert.deepEqual(h.state.draft, []);
      assert(h.notices.some(notice => notice.type === 'success'));
    } finally { h.cleanup(); }
  });
}
