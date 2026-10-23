import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real hook/query function without a browser, server or CRM data.
// Transport serialization and the Go authorization boundary have separate tests.
function leadHistoryQuery() {
  const calls = [];
  let options;
  const mocks = {
    react: {
      useMemo: factory => factory(), useRef: current => ({ current }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useLayoutEffect: callback => { callback(); },
    },
    '@tanstack/react-query': {
      CancelledError: class extends Error {},
      useQueryClient: () => ({ getQueryData: () => undefined }),
      useInfiniteQuery: input => { options = input; return {}; },
    },
    '@/lib/api/whatsapp': { whatsappAPI: { getHistoryAccess: async input => {
      calls.push(input); return { messages: [], nextCursor: null };
    } } },
    '@/hooks/use-whatsapp-query-scope': { useWhatsAppQueryScope: () => ({ organizationId: 'org-fixture', userId: 'actor-fixture', accessScope: 'scope-fixture' }) },
    '@/lib/whatsapp-query-cache': {
      flattenWhatsAppMessagePages: () => [], mergeWhatsAppMessagesWithLocalState: messages => messages,
      whatsappQueryKeys: { leadMessages: (scope, id, size) => ['leadMessages', scope.organizationId, scope.userId, scope.accessScope, id, size] },
    },
    '@/lib/whatsapp-message-order': { isWhatsAppMessageCursorRebaseRequired: () => false },
    '@/lib/whatsapp-access-revocation': { clearUnavailableWhatsAppLeadCache: () => {}, isWhatsAppAccessUnavailable: () => false },
  };
  const file = fileURLToPath(new URL('./use-lead-messages.ts', import.meta.url));
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { console, AbortController }, { filename: file })(specifier => {
    assert.ok(specifier in mocks, `unreviewed hook dependency: ${specifier}`);
    return mocks[specifier];
  }, record, record.exports);
  record.exports.useLeadMessages('lead-fixture');
  return { calls, options };
}

test('the actual lead history query requests messages only on every page without changing actor, lead, cursor or signal', async () => {
  const { calls, options } = leadHistoryQuery();
  const controller = new AbortController();
  for (const pageParam of [null, 'cursor-fixture']) {
    await options.queryFn({ pageParam, signal: controller.signal });
  }
  assert.equal(calls.length, 2);
  for (const [index, input] of calls.entries()) {
    assert.equal(input.includeConversations, false);
    assert.equal(input.leadId, 'lead-fixture');
    assert.equal(input.organizationId, 'org-fixture');
    assert.equal(input.limit, 40);
    assert.equal(input.cursor, index === 0 ? null : 'cursor-fixture');
    assert.equal(input.signal, controller.signal);
  }
  assert.ok(options.queryKey.includes('actor-fixture'));
  assert.ok(options.queryKey.includes('scope-fixture'));
});
