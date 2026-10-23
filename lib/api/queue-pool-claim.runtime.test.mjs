import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseDomainInput, validateDomainResponse, uuidSchema } from '../validation/common.ts';
import { apiLeadResponseSchema } from '../validation/leads.ts';
import { queuePoolClaimInputSchema } from '../validation/queue-runtime.ts';
import { toQueuePool } from '../queue-pool.ts';

const source = ts.createSourceFile('leads.ts', readFileSync(new URL('./leads.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
let method, mapper;
function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name?.getText(source) === 'claimQueuePool') method = node.getText(source);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'toLegacyLead') mapper = node.getText(source).replace(/^export /, '');
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(method); assert.ok(mapper);
function clientFor(transport) {
  const code = ts.transpileModule(`${mapper}\nconst client = {${method}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const deps = { parseDomainInput, validateDomainResponse, uuidSchema, apiLeadResponseSchema, queuePoolClaimInputSchema, toQueuePool, vimobAPIRequest: transport, captureCurrentLeadRequestIntent: (intent) => intent };
  return Function(...Object.keys(deps), `${code};return client;`)(...Object.values(deps));
}
const id = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222', actor = '33333333-3333-4333-8333-333333333333';
const canonical = { id, organizationId: org, name: 'Synthetic lead', source: 'manual', status: 'new', dealStatus: 'open', priority: 'normal', reentryCount: 0, assignedUserId: actor, createdAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-14T12:01:00Z' };
const input = { roundRobinId: id, episodeId: org, expectedRevision: 4 };

test('actual claim client sends exact CAS, idempotency header and captured intent; claimed read clears pool', async () => {
  const calls = [];
  const client = clientFor(async (...args) => { calls.push(args); return { data: canonical }; });
  const intent = { expectedUserId: actor, expectedSessionId: id };
  const result = await client.claimQueuePool(id, input, id, org, intent);
  assert.equal(calls[0][0], `/v1/leads/${id}/claim-queue-pool`);
  assert.deepEqual(calls[0][1].body, input);
  assert.deepEqual(calls[0][1].headers, { 'Idempotency-Key': id });
  assert.equal(calls[0][1].expectedSessionId, id); assert.equal(calls[0][1].retry, false);
  assert.equal(result.data.assigned_user_id, actor); assert.equal(result.data.queue_pool, null);
});

test('invalid CAS does not start transport and foreign canonical response is rejected', async () => {
  let called = 0;
  const client = clientFor(async () => { called++; return { data: { ...canonical, organizationId: id } }; });
  await assert.rejects(client.claimQueuePool(id, { ...input, expectedRevision: 0 }, id, org, {}));
  assert.equal(called, 0);
  await assert.rejects(client.claimQueuePool(id, input, id, org, {}), /confirmar o lead/);
  assert.equal(called, 1);
});
