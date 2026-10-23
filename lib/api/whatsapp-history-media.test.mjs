import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const leadId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

function historyBoundary() {
  const modules = new Map(), calls = [];
  const context = vm.createContext({ AbortController, DOMException, FormData, Headers, Request, Response, URL,
    clearTimeout, setTimeout, console, process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_VIMOB_API_URL: 'https://api.example.test' } },
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), headers: options.headers, signal: options.signal });
      return Response.json({ data: { messages: [], nextCursor: null } });
    } });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const record = { exports: {} }; modules.set(file, record);
    const localRequire = specifier => {
      if (specifier === 'zod') return require('zod');
      if (specifier === '@/lib/supabase/client') return { supabase: { auth: {
        getSession: async () => ({ data: { session: { access_token: 'synthetic-local-only', user: { id: 'actor-fixture' } } }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: null }),
      } } };
      if (specifier === '@/lib/auth/password-recovery') return { isPasswordRecoveryAccessToken: () => false };
      if (specifier === '@/lib/local-read-only') return { shouldBlockLocalMutation: () => false };
      if (specifier === '@/lib/utils/json') return { parseJSONOrNull: value => { try { return JSON.parse(value); } catch { return null; } } };
      if (specifier === './telemetry') return { reportErrorEvent: async () => {} };
      if (specifier === '@/lib/validation') return { ...load(resolve(repository, 'lib/validation/whatsapp.ts')),
        ...load(resolve(repository, 'lib/validation/crm-support.ts')),
        parseDomainInput: (schema, value) => schema.parse(value), validateDomainResponse: (schema, value) => schema.parse(value) };
      return load(specifier.startsWith('@/') ? resolve(repository, `${specifier.slice(2)}.ts`) : resolve(dirname(file), `${specifier}.ts`));
    };
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename: file })(localRequire, record, record.exports);
    return record.exports;
  }
  load(resolve(repository, 'lib/api/vimob-client.ts')).setVimobAPIAccessToken('synthetic-local-only', 'actor-fixture');
  return { api: load(resolve(repository, 'lib/api/whatsapp.ts')).whatsappAPI, calls };
}

for (const includeMediaUrls of [undefined, false, true]) test(`history serializes includeMediaUrls=${includeMediaUrls} through the real authenticated transport`, async () => {
  const { api, calls } = historyBoundary();
  const result = await api.getHistoryAccess({ conversationId, leadId, organizationId: 'organization-fixture',
    limit: 30, includeMediaUrls }, { expectedUserId: 'actor-fixture' });
  assert.equal(result.messages.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/v1/whatsapp/history');
  assert.equal(calls[0].url.searchParams.get('includeMediaUrls'), includeMediaUrls === undefined ? null : String(includeMediaUrls));
  assert.equal(calls[0].url.searchParams.get('conversationId'), conversationId);
  assert.equal(calls[0].url.searchParams.get('leadId'), leadId);
  assert.equal(calls[0].headers.get('X-Organization-ID'), 'organization-fixture');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer synthetic-local-only');
});

for (const includeConversations of [undefined, false, true]) test(`history preserves explicit conversation-envelope preference ${includeConversations}`, async () => {
  const { api, calls } = historyBoundary();
  const result = await api.getHistoryAccess({ leadId, organizationId: 'organization-fixture',
    limit: 40, includeConversations }, { expectedUserId: 'actor-fixture' });
  assert.deepEqual(Array.from(result.messages), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('includeConversations'), includeConversations === undefined ? null : String(includeConversations));
  assert.equal(calls[0].url.searchParams.get('leadId'), leadId);
  assert.equal(calls[0].headers.get('X-Organization-ID'), 'organization-fixture');
});

test('an obsolete authenticated viewer cannot request history or mint media URLs', async () => {
  const { api, calls } = historyBoundary();
  await assert.rejects(api.getHistoryAccess({ conversationId, leadId, organizationId: 'organization-fixture', includeMediaUrls: false },
    { expectedUserId: 'different-actor' }));
  assert.equal(calls.length, 0);
});
