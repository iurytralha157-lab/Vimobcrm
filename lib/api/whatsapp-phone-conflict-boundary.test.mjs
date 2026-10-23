import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Real domain API, transport, schema, decoder and getter; only auth and HTTP
// are synthetic. Nothing calls the real database, provider or telemetry.
const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const refs = { conversationId: '11111111-1111-4111-8111-111111111111', leadId: '22222222-2222-4222-8222-222222222222', sessionId: '33333333-3333-4333-8333-333333333333' };
const code = 'whatsapp_phone_change_confirmation_required';

function boundary(envelope) {
  const modules = new Map(), calls = [], bodies = [], postedBodies = [];
  const context = vm.createContext({ AbortController, DOMException, FormData, Headers, Request, Response, URL,
    clearTimeout, setTimeout, console, process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_VIMOB_API_URL: 'https://api.example.test' } },
    fetch: async (url, options) => {
      calls.push({ url: String(url), method: options.method, organizationId: options.headers.get('X-Organization-ID') });
      if (options.body) {
        const body = JSON.parse(options.body);
        bodies.push(body); postedBodies.push({ url: String(url), body });
      }
      if (String(url).endsWith('/v1/telemetry/errors')) return new Response('{"ok":true}', { status: 200 });
      return new Response(JSON.stringify(envelope), { status: 409, headers: { 'Content-Type': 'application/json' } });
    } });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const record = { exports: {} }; modules.set(file, record);
    const localRequire = (specifier) => {
      if (specifier === 'zod') return require('zod');
      if (specifier === '@/lib/supabase/client') return { supabase: { auth: {
        getSession: async () => ({ data: { session: { access_token: 'synthetic-local-fixture-only', user: { id: 'actor-fixture' } } }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: null }),
      } } };
      if (specifier === '@/lib/auth/password-recovery') return { isPasswordRecoveryAccessToken: () => false };
      if (specifier === '@/lib/local-read-only') return { shouldBlockLocalMutation: () => false };
      if (specifier === '@/lib/utils/json') return { parseJSONOrNull: (value) => { try { return JSON.parse(value); } catch { return null; } } };
      if (specifier === './telemetry') return { reportErrorEvent: async () => {} };
      if (specifier === '@/lib/validation') return { ...load(resolve(repository, 'lib/validation/whatsapp.ts')),
        ...load(resolve(repository, 'lib/validation/crm-support.ts')),
        parseDomainInput: (schema, value) => schema.parse(value), validateDomainResponse: (schema, value) => schema.parse(value) };
      const target = specifier.startsWith('@/') ? resolve(repository, `${specifier.slice(2)}.ts`) : resolve(dirname(file), `${specifier}.ts`);
      return load(target);
    };
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context, { filename: file })(localRequire, record, record.exports);
    return record.exports;
  }
  const client = load(resolve(repository, 'lib/api/vimob-client.ts'));
  client.setVimobAPIAccessToken('synthetic-local-fixture-only', 'actor-fixture');
  return { api: load(resolve(repository, 'lib/api/whatsapp.ts')).whatsappAPI,
    helper: load(resolve(repository, 'lib/whatsapp-phone-change.ts')), calls, bodies, postedBodies, client,
    notificationService: load(resolve(repository, 'services/NotificationService.ts')).notificationService };
}

test('authenticated domain API retains the exact reviewed409 references through transport and getter', async () => {
  const { api, helper, calls } = boundary({ error: { code, message: 'Confirm route change' }, data: refs });
  await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId, leadId: refs.leadId, expectedPreviousLeadId: refs.leadId }, 'organization-fixture'), error => {
    assert.equal(error.status, 409); assert.equal(error.code, code);
    assert.deepEqual(helper.getWhatsAppPhoneChangeConfirmation(error), refs);
    return true;
  });
  assert.deepEqual(calls.filter(call => call.url.endsWith('/v1/whatsapp/conversations/start')), [{ url: 'https://api.example.test/v1/whatsapp/conversations/start', method: 'POST', organizationId: 'organization-fixture' }]);
  assert.ok(calls.every(call => call.url.startsWith('https://api.example.test/') && call.organizationId === 'organization-fixture'));
});

test('owned start and link flags survive real schemas and authenticated HTTP serialization', async () => {
  const { api, postedBodies } = boundary({ error: { code, message: 'Confirm route change' }, data: refs });
  await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId,
    leadId: refs.leadId, expectedPreviousLeadId: 'unlinked', ownSessionOnly: true }, 'organization-fixture', {expectedUserId:'actor-fixture'}));
  await assert.rejects(api.linkConversationToLead(refs.conversationId, refs.leadId, 'unlinked', 'organization-fixture',
    {expectedUserId:'actor-fixture'}, true));
  const bodies = postedBodies.filter(item => item.url.endsWith('/conversations/start') || item.url.endsWith('/link-lead')).map(item => item.body);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].ownSessionOnly, true);
  assert.equal(bodies[1].ownSessionOnly, true);
  assert.equal(bodies[1].expectedPreviousLeadId, 'unlinked');
});

test('general shared callers preserve their existing HTTP body without an ownership restriction', async () => {
  const { api, postedBodies } = boundary({ error: { code, message: 'Confirm route change' }, data: refs });
  await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId,
    leadId: refs.leadId, expectedPreviousLeadId: refs.leadId }, 'organization-fixture'));
  await assert.rejects(api.linkConversationToLead(refs.conversationId, refs.leadId, 'unlinked', 'organization-fixture'));
  const bodies = postedBodies.filter(item => item.url.endsWith('/conversations/start') || item.url.endsWith('/link-lead')).map(item => item.body);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every(body => !Object.hasOwn(body, 'ownSessionOnly')));
});

test('a malformed own-only flag is rejected before authenticated HTTP', async () => {
  const { api, calls } = boundary({ error: { code: 'synthetic_conflict', message: 'Synthetic conflict' } });
  await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId,
    leadId: refs.leadId, expectedPreviousLeadId: 'unlinked', ownSessionOnly: 'true' }, 'organization-fixture'));
  await assert.rejects(api.linkConversationToLead(refs.conversationId, refs.leadId, 'unlinked', 'organization-fixture', undefined, 'true'));
  assert.equal(calls.length, 0);
});

test('transport discards unreviewed error data and malformed destination handshakes', async () => {
  for (const [errorCode, data] of [['other_conflict', refs], [code, { ...refs, phone: '+5511999999999' }],
    [code, { ...refs, destinationConversationId: '44444444-4444-4444-8444-444444444444' }]]) {
    const { api, helper } = boundary({ error: { code: errorCode, message: 'Synthetic conflict' }, data });
    await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId, leadId: refs.leadId, expectedPreviousLeadId: refs.leadId }, 'organization-fixture'), error => {
      assert.equal(error.responseData, undefined); assert.equal(helper.getWhatsAppPhoneChangeConfirmation(error), null); return true;
    });
  }
});

test('combined destination consent crosses the domain API boundary as IDs only', async () => {
  const data = { ...refs, destinationConversationId: '44444444-4444-4444-8444-444444444444', requiresDestinationHistoryConfirmation: true };
  const { api, helper } = boundary({ error: { code, message: 'Confirm destination history' }, data });
  await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId, leadId: refs.leadId, expectedPreviousLeadId: refs.leadId }, 'organization-fixture'), error => {
    assert.deepEqual(helper.getWhatsAppPhoneChangeConfirmation(error), data); return true;
  });
});

test('creating a session pins the actor at invocation even without an existing owned resource', async () => {
  const { api, client, calls } = boundary({ error: { code, message: 'Synthetic conflict' }, data: refs });
  const creation = api.createSession({ displayName: 'Synthetic WhatsApp' }, 'organization-fixture');
  client.setVimobAPIAccessToken('synthetic-other-actor-only', 'actor-other');
  await assert.rejects(creation, error => error.status === 409 && error.code === 'api_request_identity_changed');
  assert.equal(calls.length, 0);
});

test('an explicit old actor cannot execute a new WhatsApp action after login changes', async () => {
  const { api, client, calls } = boundary({ error: { code, message: 'Synthetic conflict' }, data: refs });
  client.setVimobAPIAccessToken('synthetic-other-actor-only', 'actor-other');
  let starts = 0;
  await assert.rejects(api.startConversation({ phone: '+5511999999999', sessionId: refs.sessionId,
    leadId: refs.leadId, expectedPreviousLeadId: refs.leadId }, 'organization-fixture', {
    expectedUserId: 'actor-fixture', onRequestStart: () => { starts += 1 },
  }), error => error.status === 409 && error.code === 'api_request_identity_changed');
  assert.equal(starts, 0);
  assert.equal(calls.length, 0);
});

test('the logout notification continuation preserves the actor through service and dispatch', async () => {
  const { notificationService, client, calls } = boundary({ error: { code: 'synthetic_conflict', message: 'Synthetic conflict' } });
  const pending = notificationService.send({ eventKey: 'whatsapp_disconnected', organizationId: refs.sessionId,
    userId: refs.leadId, variables: { session_id: refs.sessionId } }, { expectedUserId: 'actor-fixture' });
  client.setVimobAPIAccessToken('synthetic-other-actor-only', 'actor-other');
  const result = await pending;
  assert.equal(result.success, false);
  assert.match(result.error, /usuário da sessão mudou/i);
  assert.equal(calls.length, 0);
});

test('notification intent stays outside the dispatch body and unbound callers remain compatible', async () => {
  for (const bound of [true, false]) {
    const { notificationService, calls, bodies } = boundary({ error: { code: 'synthetic_conflict', message: 'Synthetic conflict' } });
    let starts = 0;
    await notificationService.send({ eventKey: 'whatsapp_disconnected', organizationId: refs.sessionId,
      userId: refs.leadId, variables: { session_id: refs.sessionId } }, bound ? {
      expectedUserId: 'actor-fixture', onRequestStart: () => { starts += 1 },
    } : undefined);
    assert.equal(calls.filter(call => call.url.endsWith('/v1/notifications/dispatch')).length, 1);
    assert.equal(starts, bound ? 1 : 0);
    assert.equal(bodies[0].expectedUserId, undefined);
    assert.equal(bodies[0].signal, undefined);
    assert.equal(bodies[0].onRequestStart, undefined);
    assert.deepEqual(bodies[0].variables, { session_id: refs.sessionId });
  }
});
