import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

const require = createRequire(import.meta.url);
const repository = resolve(import.meta.dirname, '..');

// Compile the real key/matcher modules in RAM; no copied implementation or HTTP.
function productionCache() {
  const modules = new Map();
  const load = path => {
    if (modules.has(path)) return modules.get(path).exports;
    const compiledModule = { exports: {} };
    modules.set(path, compiledModule);
    const output = ts.transpileModule(readFileSync(resolve(repository, path), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    Function('require', 'module', 'exports', output)(name => name.startsWith('@/')
      ? load(name.slice(2) + '.ts') : require(name), compiledModule, compiledModule.exports);
    return compiledModule.exports;
  };
  return { ...load('lib/whatsapp-query-cache.ts'), ...load('lib/realtime/whatsapp-query-refresh.ts') };
}

const cache = productionCache();

// Extract the actual helpers, retaining their predicates, dispatch and timer keys.
function productionReconciliation() {
  const path = process.env.WHATSAPP_RECONCILIATION_BASELINE || resolve(repository, 'hooks/use-whatsapp-conversations.ts');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['reconcileWhatsAppMessageQueries', 'scheduleWhatsAppMessageReconciliation',
    'dispatchWhatsAppMessagesReconcile', 'matchesWhatsAppMessagesQuery', 'scheduledMessageReconciliations',
    'WHATSAPP_SEND_RECONCILE_DELAYS_MS']);
  const statements = source.statements.filter(node => ts.isFunctionDeclaration(node)
    ? names.has(node.name?.text) : ts.isVariableStatement(node)
      && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(source))));
  assert.equal(statements.length, names.size, 'all production helpers must be present');
  const code = ts.transpileModule(statements.map(node => node.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const timers = [];
  const helpers = Function(...Object.keys(cache), 'setTimeout', `${code}; return {
    reconcile:reconcileWhatsAppMessageQueries, schedule:scheduleWhatsAppMessageReconciliation,
    delays:WHATSAPP_SEND_RECONCILE_DELAYS_MS
  };`)(...Object.values(cache), (run, delay) => {
    const timer = { run, delay }; timers.push(timer); return timer;
  });
  return { ...helpers, timers };
}

const scope = { organizationId: 'org-a', userId: 'actor-a', accessScope: JSON.stringify(['base-permissions', 'sid-a']) };
const foreignScopes = [
  { ...scope, organizationId: 'org-b' },
  { ...scope, userId: 'actor-b' },
  { ...scope, accessScope: JSON.stringify(['base-permissions', 'sid-b']) },
];
const listKey = (value, search = '') => cache.whatsappQueryKeys.conversations(value, {
  hideGroups: false, showArchived: false, onlyLeads: false, withoutLead: false,
  pendingReply: false, accessibleSessionKey: 'backend-visibility', limit: 80, search,
});

function fixture(t) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  const entries = [];
  let status = 'sent';
  const observe = (key, active = true) => {
    const entry = { key, calls: 0, before: { marker: 'cached', status: 'queued' } };
    client.setQueryData(key, entry.before);
    if (active) {
      entry.observer = new QueryObserver(client, { queryKey: key, queryFn: () => {
        entry.calls++; return Promise.resolve({ marker: 'canonical', status });
      } });
      entry.unsubscribe = entry.observer.subscribe(() => {});
    }
    entries.push(entry);
    return entry;
  };
  const lists = [observe(listKey(scope)), observe(listKey(scope, 'filtered'))];
  const messages = observe(cache.whatsappQueryKeys.messages(scope, {
    conversationId: 'conversation-a', leadId: 'lead-a', limit: 50, includeLeadHistory: false,
  }));
  const history = observe(cache.whatsappQueryKeys.leadMessages(scope, 'lead-a', 50));
  const paginated = observe(cache.whatsappQueryKeys.paginatedMessages(scope, 'conversation-a', 50, 'lead-a'));
  const attendance = observe(cache.whatsappQueryKeys.attendance(scope, 'conversation-a', 'lead-a', 'session-a'));
  const inactiveList = observe(listKey(scope, 'unmounted-filter'), false);
  const foreign = foreignScopes.flatMap(value => [observe(listKey(value)), observe(cache.whatsappQueryKeys.messages(value, {
    conversationId: 'conversation-a', leadId: 'lead-a', limit: 50, includeLeadHistory: false,
  }))]);
  const unrelated = observe(cache.whatsappQueryKeys.messages(scope, {
    conversationId: 'other-conversation', leadId: 'other-lead', limit: 50, includeLeadHistory: false,
  }));
  t.after(() => { entries.forEach(entry => { entry.unsubscribe?.(); entry.observer?.destroy(); }); client.clear(); });
  return { client, lists, messages, history, paginated, attendance, inactiveList, foreign, unrelated,
    setStatus(value) { status = value; } };
}

async function settle() {
  // QueryClient invalidation is fire-and-forget in the real helper.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

function assertForeignUntouched(f) {
  for (const entry of [...f.foreign, f.unrelated]) {
    assert.equal(entry.calls, 0, 'another org, UID, SID or unrelated message query must not be read');
    assert.strictEqual(f.client.getQueryData(entry.key), entry.before);
    assert.equal(f.client.getQueryState(entry.key).isInvalidated, false);
  }
}

test('actual reconciliation refreshes active card and message queries in one scope, preserving foreign caches', async t => {
  const f = fixture(t), helpers = productionReconciliation();
  helpers.reconcile(f.client, scope, ['conversation-a', 'conversation-a', ''], 'lead-a');
  await settle();
  assertForeignUntouched(f);
  for (const entry of [f.messages, f.history, f.paginated, f.attendance, ...f.lists]) {
    // Without Window the existing fallback also invalidates message pages.
    assert.ok(entry.calls >= 1, String(entry.key[0]));
    assert.equal(f.client.getQueryData(entry.key).status, 'sent');
  }
  assert.equal(f.inactiveList.calls, 0);
  assert.strictEqual(f.client.getQueryData(f.inactiveList.key), f.inactiveList.before);
  assert.equal(f.client.getQueryState(f.inactiveList.key).isInvalidated, true, 'inactive lists are stale without an HTTP read');
  assertForeignUntouched(f);
});

test('real 4s and 15s callbacks reconcile later canonical receipt changes and retain timer coalescing', async t => {
  const f = fixture(t), helpers = productionReconciliation();
  helpers.schedule(f.client, scope, ['conversation-a'], 'lead-a', helpers.delays);
  helpers.schedule(f.client, scope, ['conversation-a'], 'lead-a', helpers.delays);
  assert.deepEqual(helpers.timers.map(timer => timer.delay), [4_000, 15_000]);
  assert.equal(f.messages.calls, 0, 'the real schedule does not request before its callbacks');
  for (const [index, status] of ['delivered', 'read'].entries()) {
    f.setStatus(status); helpers.timers[index].run(); await settle();
    assertForeignUntouched(f);
    for (const entry of [f.messages, f.history, f.paginated, f.attendance, ...f.lists]) {
      assert.ok(entry.calls >= index + 1, String(entry.key[0]));
      assert.equal(f.client.getQueryData(entry.key).status, status);
    }
    assertForeignUntouched(f);
  }
});
