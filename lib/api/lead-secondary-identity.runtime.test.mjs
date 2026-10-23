import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as leadSchemas from '../validation/leads.ts';
import * as auxiliarySchemas from '../validation/auxiliary.ts';
import * as crmSchemas from '../validation/crm-support.ts';
import { captureLeadRequestIntent } from '../lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../auth/global-sign-out.ts';
import { VimobAPIError, getTechnicalErrorMessage } from './vimob-error.ts';
import { deferred, evaluateProduction, productionDeclaration } from '../../hooks/leads/lead-request-runtime-fixture.mjs';

const userA = '10000000-0000-4000-8000-000000000001', userB = '10000000-0000-4000-8000-000000000002';
const sidA = '20000000-0000-4000-8000-000000000001', sidB = '20000000-0000-4000-8000-000000000002';
const lead = '30000000-0000-4000-8000-000000000001', tag = '40000000-0000-4000-8000-000000000001';
const organization = '50000000-0000-4000-8000-000000000001';
const token = (user, sid, version = 1) => `header.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, version })).toString('base64url')}.synthetic`;
function transport() {
  let offset = 0;
  const sessionRead = deferred(), entered = deferred(); const requests = [];
  const dependencies = {
    '@/lib/supabase/client': { supabase: { auth: { getSession: () => { entered.resolve(); return sessionRead.promise; }, refreshSession: async () => ({ data: { session: null }, error: null }) } } },
    '@/lib/auth/global-sign-out': { getGlobalSignOutSessionId },
    '@/lib/api/vimob-error': { VimobAPIError, getTechnicalErrorMessage },
    '@/lib/auth/password-recovery': { isPasswordRecoveryAccessToken: () => false },
    '@/lib/local-read-only': { shouldBlockLocalMutation: () => false },
    '@/lib/utils/json': { parseJSONOrNull: JSON.parse },
  };
  const compiledModule = { exports: {} };
  const code = ts.transpileModule(readFileSync('lib/api/vimob-client.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Date: class extends Date { static now() { return Date.now() + offset; } }, Error, Headers, FormData, AbortController, DOMException, URL, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_VIMOB_API_URL: 'https://api.invalid', NEXT_PUBLIC_DISABLE_ERROR_TELEMETRY: 'true' } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      // Response shape is synthetic: these tests verify the real request transport,
      // independently of the repository's response-schema/creation-contract tests.
      return { ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }),
        text: async () => JSON.stringify({ data: { id: lead }, success: true, leadId: lead, roundRobinUsed: false }) };
    },
  })(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiledModule, compiledModule.exports);
  const client = compiledModule.exports; client.setVimobAPIAccessToken(token(userA, sidA), userA); offset = 70_000;
  const captureCurrent = evaluateProduction(productionDeclaration('lib/api/lead-request-intent.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'captureCurrentLeadRequestIntent'), { ...client, captureLeadRequestIntent }, 'captureCurrentLeadRequestIntent');
  const nullableDecimal = evaluateProduction(productionDeclaration('lib/api/leads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'nullableDecimal'), {}, 'nullableDecimal');
  const toAPILeadUpdateBody = evaluateProduction(productionDeclaration('lib/api/leads.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'toAPILeadUpdateBody'), { nullableDecimal }, 'toAPILeadUpdateBody');
  const api = (path, name) => evaluateProduction(`const api = {${productionDeclaration(path, node => ts.isMethodDeclaration(node) && node.name.getText() === name)}}`, {
    ...leadSchemas, ...auxiliarySchemas, ...crmSchemas, captureCurrentLeadRequestIntent: captureCurrent, vimobAPIRequest: client.vimobAPIRequest,
    parseDomainInput: (schema, value) => schema.parse(value), validateDomainResponse() {}, toLegacyLead: value => value, toAPILeadUpdateBody,
  }, `api.${name}`);
  return {
    api, client, requests, entered: entered.promise,
    replace: (user = userB, sid = sidB, version = 1) => {
      client.setVimobAPIAccessToken(token(user, sid, version), user);
      sessionRead.resolve({ data: { session: { access_token: token(userA, sidA), user: { id: userA } } }, error: null });
    },
  };
}
const cases = [
  ['lib/api/leads.ts', 'updateLead', [lead, { name: 'Synthetic update' }, organization]],
  ['lib/api/leads.ts', 'addLeadTag', [lead, tag, organization]],
  ['lib/api/leads.ts', 'removeLeadTag', [lead, tag, organization]],
  ['lib/api/leads.ts', 'moveLeadStage', [lead, { stageId: tag, expectedStageId: null }, organization]],
  ['lib/api/leads.ts', 'assignLead', [lead, userA, organization]],
  ['lib/api/leads.ts', 'redistributeLeadRoundRobin', [lead, organization, { expectedUnassigned: true }]],
  ['lib/api/leads.ts', 'recordFirstResponse', [lead, { organizationId: organization, channel: 'phone', actorUserId: userA }]],
  ['lib/api/activities.ts', 'create', [{ lead_id: lead, type: 'note', content: 'Synthetic' }, organization]],
  ['lib/api/lead-tasks.ts', 'create', [{ lead_id: lead, type: 'call', title: 'Synthetic', day_offset: 0 }, organization]],
  ['lib/api/lead-tasks.ts', 'patch', [tag, { is_done: true, leadId: lead }, organization]],
  ['lib/api/lead-tasks.ts', 'completeCadence', [{ leadId: lead, taskId: tag, organizationId: organization }]],
];
for (const [path, name, args] of cases) test(`actual ${path}:${name} cannot inherit replacement actor during token resolution`, async () => {
  const fixture = transport(); const operation = fixture.api(path, name)(...args);
  await fixture.entered; fixture.replace(); await assert.rejects(operation, error => error.code === 'api_request_identity_changed');
  assert.equal(fixture.requests.length, 0);
});

test('actual transport allows new JWT for the same actor/SID, keeping the original organization', async () => {
  const fixture = transport(); const operation = fixture.api('lib/api/leads.ts', 'addLeadTag')(lead, tag, organization);
  await fixture.entered; fixture.replace(userA, sidA, 2); await operation;
  assert.equal(fixture.requests.length, 1); const { options } = fixture.requests[0];
  assert.equal(options.headers.get('X-Organization-ID'), organization);
  assert.equal(options.headers.get('Authorization'), `Bearer ${token(userA, sidA, 2)}`);
});

test('actual transport rejects a new SID under the same actor before any mutation request', async () => {
  const fixture = transport(); const operation = fixture.api('lib/api/leads.ts', 'removeLeadTag')(lead, tag, organization);
  await fixture.entered; fixture.replace(userA, sidB); await assert.rejects(operation, error => error.code === 'api_request_identity_changed');
  assert.equal(fixture.requests.length, 0);
});

test('actual direct update rejects replacement SID for the same actor before PATCH', async () => {
  const fixture = transport(); const operation = fixture.api('lib/api/leads.ts', 'updateLead')(lead, { name: 'Synthetic update' }, organization);
  await fixture.entered; fixture.replace(userA, sidB); await assert.rejects(operation, error => error.code === 'api_request_identity_changed');
  assert.equal(fixture.requests.length, 0);
});

test('actual direct update survives same-SID refresh and keeps the validated update body', async () => {
  const fixture = transport(); const operation = fixture.api('lib/api/leads.ts', 'updateLead')(lead,
    { name: 'Synthetic update', valor_interesse: 125000.50, expectedUpdatedAt: '2026-10-13T12:00:00.000001Z' }, organization);
  await fixture.entered; fixture.replace(userA, sidA, 2); await operation;
  assert.equal(fixture.requests.length, 1); const { options } = fixture.requests[0];
  assert.equal(options.method, 'PATCH'); assert.equal(options.headers.get('X-Organization-ID'), organization);
  assert.deepEqual(JSON.parse(options.body), { name: 'Synthetic update', interestValue: '125000.5', expectedUpdatedAt: '2026-10-13T12:00:00.000001Z' });
});

test('actual direct update preserves explicit original intent and AbortSignal instead of recapturing the replacement session', async () => {
  const fixture = transport(); const controller = new AbortController(); fixture.client.setVimobAPIAccessToken(token(userB, sidB), userB);
  const operation = fixture.api('lib/api/leads.ts', 'updateLead')(lead, { name: 'Synthetic' }, organization,
    { expectedUserId: userA, expectedSessionId: sidA, signal: controller.signal });
  await assert.rejects(operation, error => error.code === 'api_request_identity_changed');
  assert.equal(fixture.requests.length, 0); assert.equal(controller.signal.aborted, false);
});

test('actual direct update retains its explicit cancellation signal while asynchronous token resolution is pending', async () => {
  const fixture = transport(); const controller = new AbortController();
  const operation = fixture.api('lib/api/leads.ts', 'updateLead')(lead, { name: 'Synthetic' }, organization,
    { expectedUserId: userA, expectedSessionId: sidA, signal: controller.signal });
  await fixture.entered; controller.abort(); await assert.rejects(operation, error => error.name === 'AbortError');
  assert.equal(fixture.requests.length, 0);
});
