import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { parseDomainInput, validateDomainResponse } from '../validation/common.ts';
import { organizationIdSchema } from '../validation/auxiliary.ts';
import { notificationListFiltersSchema } from '../validation/notification-filters.ts';
import { apiNotificationListResponseSchema } from '../validation/crm-support.ts';

const source = ts.createSourceFile('notifications.ts', readFileSync(new URL('./notifications.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
  .find(node => node.name.getText(source) === 'notificationsAPI');
const method = declaration.initializer.properties.find(node => node.name?.getText(source) === 'list');
const compiled = ts.transpileModule(`const api = { ${method.getText(source)} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function api(transport) {
  const dependencies = { vimobAPIRequest: transport, parseDomainInput, validateDomainResponse,
    organizationIdSchema, notificationListFiltersSchema, apiNotificationListResponseSchema };
  return Function(...Object.keys(dependencies), `${compiled}; return api;`)(...Object.values(dependencies));
}
const organizationA = '11111111-1111-4111-8111-111111111111';
const organizationB = '22222222-2222-4222-8222-222222222222';
const recipient = '33333333-3333-4333-8333-333333333333';
const response = { data: [], next_cursor: null };

test('list pins recipient, tenant and cancellation intent across a pending request', async () => {
  const controller = new AbortController();
  const onRequestStart = () => {};
  let finish, request, activeOrganization = organizationA;
  const transport = async (path, options) => {
    request = { path, options };
    await new Promise(resolve => { finish = resolve; });
    return response;
  };
  const pending = api(transport).list({ userId: recipient, limit: 25 }, {
    signal: controller.signal, expectedUserId: recipient, expectedSessionId: 'session-a', onRequestStart, organizationId: activeOrganization,
  });
  activeOrganization = organizationB;
  assert.equal(request.path, '/v1/notifications');
  assert.equal(request.options.organizationId, organizationA);
  assert.notEqual(request.options.organizationId, activeOrganization);
  assert.equal(request.options.expectedUserId, recipient);
  assert.equal(request.options.expectedSessionId, 'session-a');
  assert.equal(request.options.onRequestStart, onRequestStart);
  assert.equal(request.options.query.userId, recipient);
  assert.equal(request.options.signal, controller.signal);
  controller.abort();
  assert.equal(request.options.signal.aborted, true);
  finish();
  assert.deepEqual(await pending, { notifications: [], nextCursor: null });
});

test('invalid explicit tenant is rejected before the transport runs', async () => {
  let requests = 0;
  await assert.rejects(api(async () => { requests++; return response; }).list({}, { organizationId: 'invalid' }));
  assert.equal(requests, 0);
});

test('existing callers without intent preserve list pagination and response validation', async () => {
  const client = api(async (_path, options) => {
    assert.equal(options.organizationId, undefined);
    assert.equal(options.query.cursor, 'cursor-a');
    return { data: [], next_cursor: 'cursor-b' };
  });
  assert.deepEqual(await client.list({ cursor: 'cursor-a' }), { notifications: [], nextCursor: 'cursor-b' });
  await assert.rejects(api(async () => ({ data: [{ id: 'malformed' }] })).list());
});
