import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { whatsappQueryKeys, isWhatsAppQueryKeyForScope } from '../lib/whatsapp-query-cache.ts';
import { isWhatsAppArchiveInvocation, matchesWhatsAppArchiveQuery, runExclusiveWhatsAppArchive } from '../lib/whatsapp-archive.ts';
import { VimobAPIError } from '../lib/api/vimob-error.ts';

const scope = { organizationId: 'org-a', userId: 'actor-a', accessScope: 'allowed' };
const conv = { id: '30000000-0000-4000-8000-000000000001', lead_id: '40000000-0000-4000-8000-000000000001', session_id: 'session-a', archived_at: null };
function declaration(path, name) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (node.name?.text === name && (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))) found = node.getText(source); ts.forEachChild(node, visit); }
  visit(source); assert.ok(found, name); return found.replace(/^export /, '');
}
function evaluate(code, dependencies, expression) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(dependencies), `${compiled};return ${expression}`)(...Object.values(dependencies));
}
const hookPath = process.env.WHATSAPP_ARCHIVE_HOOK_BASELINE || 'hooks/use-whatsapp-conversations.ts';
const floatPath = process.env.WHATSAPP_ARCHIVE_FLOAT_BASELINE || 'components/features/chat/FloatingChat.tsx';

test('archive invalidates original list, physical detail, snapshot and lead projection only', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const own = [whatsappQueryKeys.conversationsScope(scope), whatsappQueryKeys.conversation(scope, conv.id, conv.lead_id),
    whatsappQueryKeys.conversationSnapshot(scope, conv.id), whatsappQueryKeys.conversationForLead(scope, conv.lead_id)];
  const untouched = [whatsappQueryKeys.conversation(scope, 'other-chat', 'other-lead'),
    whatsappQueryKeys.conversationSnapshot({ ...scope, userId: 'actor-b' }, conv.id)];
  [...own, ...untouched].forEach(key => client.setQueryData(key, conv));
  const dependencies = { useQueryClient: () => client, useWhatsAppQueryScope: () => scope,
    useWhatsAppIntentMutation: value => value, useIsMutating: () => 0,
    requireConversationBindingSnapshot: c => c.lead_id, whatsappAPI: { archiveConversation: async () => {} },
    whatsappQueryKeys, isWhatsAppQueryKeyForScope, toast: () => {},
  };
  if (!process.env.WHATSAPP_ARCHIVE_HOOK_BASELINE) Object.assign(dependencies, await import('../lib/whatsapp-archive.ts'));
  const hook = evaluate(declaration(hookPath, 'useArchiveConversation'), dependencies, 'useArchiveConversation')();
  const intent = { scope, isCurrent: () => true, assertCurrent() {} };
  try {
    await hook.mutationFn({ conversation: conv, archive: true }, intent);
    await hook.onSuccess(undefined, { conversation: conv, archive: true }, undefined, intent);
    assert.deepEqual(own.map(key => client.getQueryState(key).isInvalidated), [true, true, true, true]);
    assert.deepEqual(untouched.map(key => client.getQueryState(key).isInvalidated), [false, false]);
  } finally { client.clear(); }
});

test('real floating archive completion cannot close a later A to B to A visit', () => {
  let callbacks, closed = 0;
  const visit = { current: 1 };
  const physical = { current: conv };
  const deps = { canOperateWhatsApp: true, intentTenantKey: 'org-a|actor-a', intentGeneration: 1,
    startupScope: 'tenant-a', startupScopeRef: { current: 'tenant-a' }, isIntentCurrent: () => true,
    activeConversationRef: physical, conversationVisitGenerationRef: visit,
    archiveConversation: { mutate: (_variables, options) => { callbacks = options; }, isPendingFor: () => false },
    clearActiveConversation: () => closed++, getWhatsAppConversationMessageScope: c => ({ expectedLeadId: c.lead_id }),
  };
  const handler = evaluate(`const ${declaration(floatPath, 'handleArchiveConversation')}`, deps, 'handleArchiveConversation');
  handler(conv);
  physical.current = { ...conv, id: 'chat-b' }; visit.current++;
  physical.current = conv; visit.current++;
  callbacks.onSuccess(); assert.equal(closed, 0);
});

test('real floating archive completion cannot close same CID rebound to another lead', () => {
  let callbacks, closed = 0;
  const physical = { current: conv }, visit = { current: 1 };
  const deps = { canOperateWhatsApp: true, intentTenantKey: 'org-a|actor-a', intentGeneration: 1,
    startupScope: 'tenant-a', startupScopeRef: { current: 'tenant-a' }, isIntentCurrent: () => true,
    activeConversationRef: physical, conversationVisitGenerationRef: visit,
    archiveConversation: { mutate: (_variables, options) => { callbacks = options; }, isPendingFor: () => false },
    clearActiveConversation: () => closed++, getWhatsAppConversationMessageScope: c => ({ expectedLeadId: c.lead_id }),
  };
  const handler = evaluate(`const ${declaration(floatPath, 'handleArchiveConversation')}`, deps, 'handleArchiveConversation');
  handler(conv); physical.current = { ...conv, lead_id: 'another-lead' }; visit.current++;
  callbacks.onSuccess(); assert.equal(closed, 0);
});

test('exclusive archive blocks overlapping widgets only for the same physical owner and releases after failure', async () => {
  const client = new QueryClient(); let finish, requests = 0;
  const first = runExclusiveWhatsAppArchive(client, scope, conv.id, () => { requests++; return new Promise(resolve => { finish = resolve; }); });
  await assert.rejects(runExclusiveWhatsAppArchive(client, scope, conv.id, async () => { requests++; }), error => error.code === 'whatsapp_archive_pending');
  await runExclusiveWhatsAppArchive(client, scope, 'other-chat', async () => { requests++; });
  await runExclusiveWhatsAppArchive(client, { ...scope, userId: 'actor-b' }, conv.id, async () => { requests++; });
  assert.equal(requests, 3); finish(); await first;
  await assert.rejects(runExclusiveWhatsAppArchive(client, scope, conv.id, async () => { throw Error('offline'); }), /offline/);
  await runExclusiveWhatsAppArchive(client, scope, conv.id, async () => { requests++; }); assert.equal(requests, 4); client.clear();
});

test('busy matcher and cache predicate never cross UID, organization, permission epoch or CID', () => {
  const invocation = { variables: { conversation: conv, archive: true }, intent: { scope } };
  assert.equal(isWhatsAppArchiveInvocation(invocation, scope, conv.id), true);
  assert.equal(isWhatsAppArchiveInvocation(invocation, scope, 'other'), false);
  for (const foreign of [{ ...scope, userId: 'actor-b' }, { ...scope, organizationId: 'org-b' }, { ...scope, accessScope: 'revoked' }]) {
    assert.equal(isWhatsAppArchiveInvocation(invocation, foreign, conv.id), false);
    assert.equal(matchesWhatsAppArchiveQuery(whatsappQueryKeys.conversationSnapshot(foreign, conv.id), scope, conv.id, conv.lead_id), false);
  }
  assert.equal(isWhatsAppArchiveInvocation({ variables: { conversation: conv, archive: 'true' }, intent: { scope } }, scope), false);
});

test('actual archive API requires positive acknowledgement and preserves the binding snapshot', async () => {
  const path = 'lib/api/whatsapp.ts', source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  let method; const visit = node => { if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'archiveConversation') method = node.getText(source); ts.forEachChild(node, visit); }; visit(source); assert.ok(method);
  let response = { ok: false }; const requests = [];
  const api = evaluate(`const api={${method}}`, { VimobAPIError, requestWhatsAppAPI: async (...args) => { requests.push(args); return response; } }, 'api');
  await assert.rejects(api.archiveConversation(conv.id, true, conv.lead_id, scope.organizationId), error => error.code === 'whatsapp_archive_not_confirmed');
  response = {}; await assert.rejects(api.archiveConversation(conv.id, true, conv.lead_id, scope.organizationId), error => error.code === 'whatsapp_archive_not_confirmed');
  response = { ok: true }; await api.archiveConversation(conv.id, false, conv.lead_id, scope.organizationId);
  assert.deepEqual(requests[2][1].body, { archive: false, expectedLeadId: conv.lead_id }); assert.equal(requests[2][1].organizationId, scope.organizationId);
});

test('an aborted archive marks old physical snapshots stale without refreshing a replacement scope', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = whatsappQueryKeys.conversationSnapshot(scope, conv.id), other = whatsappQueryKeys.conversationSnapshot({ ...scope, userId: 'actor-b' }, conv.id);
  client.setQueryData(key, conv); client.setQueryData(other, conv);
  const hook = evaluate(declaration('hooks/use-whatsapp-conversations.ts', 'useArchiveConversation'), {
    useQueryClient: () => client, useWhatsAppQueryScope: () => scope, useWhatsAppIntentMutation: value => value, useIsMutating: () => 0,
    requireConversationBindingSnapshot: c => c.lead_id, whatsappAPI: { archiveConversation: async () => { throw new DOMException('Aborted', 'AbortError'); } },
    whatsappQueryKeys, isWhatsAppQueryKeyForScope, isWhatsAppArchiveInvocation, matchesWhatsAppArchiveQuery, runExclusiveWhatsAppArchive, toast: () => {},
  }, 'useArchiveConversation')();
  try {
    await assert.rejects(hook.mutationFn({ conversation: conv, archive: true }, { scope }), error => error.name === 'AbortError');
    assert.equal(client.getQueryState(key).isInvalidated, true); assert.equal(client.getQueryState(other).isInvalidated, false);
  } finally { client.clear(); }
});
