import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runLeadImportBatch } from '@/lib/lead-import-batch';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { countImportDistributionOutcome, createEmptyImportDistributionSummary, resolveImportDistributionOutcome } from '@/lib/lead-distribution-outcome';
import type { CreateLeadInput, ImportLeadsMutationInput, ImportLeadsResult } from '@/hooks/use-leads';

const source = readFileSync(new URL('../use-leads.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('use-leads.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useImportLeads');
assert.ok(declaration);
const code = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, '') + '\nreturn useImportLeads;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const session = (id: string) => ({ access_token: `header.${Buffer.from(JSON.stringify({ session_id: id })).toString('base64url')}.signature` });
const rows: CreateLeadInput[] = Array.from({ length: 8 }, (_, index) => ({ name: `Contato ${index}`, import_row_number: index + 2, import_request_key: `request-${index}` }));

function harness() {
  let organizationId = 'org-a';
  let actorId = 'actor-a';
  let sessionId = 'session-a';
  const scope = createLeadImportScope();
  let cleanup: (() => void) | undefined;
  let previousKey: unknown;
  const sent: Array<{ body: CreateLeadInput; org: string; intent: Record<string, string> }> = [];
  const settle: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const dependencies = {
    useQueryClient: () => ({ invalidateQueries: () => {} }),
    useAuth: () => ({ activeOrganization: { organizationId }, user: { id: actorId }, session: session(sessionId) }),
    useState: () => [scope],
    useLayoutEffect: (activate: () => () => void, deps: unknown[]) => { if (previousKey !== deps[1]) { cleanup?.(); cleanup = activate(); previousKey = deps[1]; } },
    getGlobalSignOutSessionId, contactImportScopeKey, createLeadImportScope,
    getVimobAPIAccessTokenUserId: () => actorId, getVimobAPIAccessTokenSessionId: () => sessionId,
    useMutation: (options: unknown) => options,
    createEmptyImportDistributionSummary, runLeadImportBatch,
    countImportDistributionOutcome, resolveImportDistributionOutcome,
    getErrorCode: (error: { code?: string }) => error.code,
    getErrorMessage: (error: Error) => error.message,
    invalidateLeadSourceOptions: () => {}, notifyLeadRealtimeChange: () => {},
    leadsAPI: { createLead: async (org: string, body: CreateLeadInput, intent: Record<string, string>) => {
      sent.push({ org, body, intent });
      await new Promise<void>((resolve, reject) => settle.push({ resolve: () => resolve(), reject }));
      return { reentry: false, distributionOutcome: 'skipped' };
    } },
  };
  const useImport = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as () => { mutationFn: (input: ImportLeadsMutationInput) => Promise<ImportLeadsResult> };
  return { sent, settle, render: useImport, unmount: () => cleanup?.(), switchTo: (org = organizationId, actor = actorId, identity = sessionId) => { organizationId = org; actorId = actor; sessionId = identity; } };
}

test('actual import mutation stops after an organization remount and preserves settled partial outcomes', async () => {
  const state = harness();
  const progress: Array<{ processed: number; remaining: number }> = [];
  const task = state.render().mutationFn({ rows, onProgress: value => progress.push(value) });
  assert.equal(state.sent.length, 4);
  state.switchTo('org-b');
  state.render();
  state.settle[0].resolve(); state.settle[1].resolve();
  state.settle[2].reject(Object.assign(new Error('Uncertain response'), { code: 'api_timeout' }));
  state.settle[3].reject(Object.assign(new Error('Invalid input'), { code: 'invalid_input' }));
  const result = await task;
  assert.equal(state.sent.length, 4);
  assert.ok(state.sent.every(request => request.org === 'org-a' && request.intent.expectedUserId === 'actor-a' && request.intent.expectedSessionId === 'session-a'));
  assert.deepEqual([result.success, result.failed, result.processed, result.remaining, result.stopped], [2, 2, 4, 4, true]);
  assert.deepEqual(result.failures.map(failure => failure.code), ['api_timeout', 'invalid_input']);
  assert.deepEqual(result.unstarted.map(row => row.index), [4, 5, 6, 7]);
  assert.deepEqual(progress.at(-1) && [progress.at(-1)?.processed, progress.at(-1)?.remaining], [4, 4]);
});

test('actual import mutation stops for live actor or session changes even before a React rerender', async () => {
  for (const change of ['actor', 'session']) {
    const state = harness();
    const task = state.render().mutationFn({ rows });
    state.switchTo('org-a', change === 'actor' ? 'actor-b' : 'actor-a', change === 'session' ? 'session-b' : 'session-a');
    state.settle.forEach(completion => completion.resolve());
    const result = await task;
    assert.equal(state.sent.length, 4);
    assert.equal(result.remaining, 4);
    assert.equal(result.success, 4);
  }
});

test('actual import mutation cannot revive after unmount or A-B-A scope changes', async () => {
  for (const change of ['unmount', 'return']) {
    const state = harness();
    const task = state.render().mutationFn({ rows });
    if (change === 'unmount') state.unmount();
    else { state.switchTo('org-b'); state.render(); state.switchTo('org-a'); state.render(); }
    state.settle.forEach(completion => completion.resolve());
    const result = await task;
    assert.equal(state.sent.length, 4);
    assert.equal(result.stopped, true);
    assert.deepEqual(result.unstarted.map(row => row.rowNumber), [6, 7, 8, 9]);
  }
});

test('an old mutation callback invoked after an organization switch sends nothing', async () => {
  const state = harness();
  const old = state.render();
  state.switchTo('org-b'); state.render();
  const result = await old.mutationFn({ rows });
  assert.equal(state.sent.length, 0);
  assert.equal(result.processed, 0);
  assert.equal(result.unstarted.length, rows.length);
});
