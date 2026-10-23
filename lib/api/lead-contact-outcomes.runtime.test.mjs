import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { parseDomainInput, uuidSchema, validateDomainResponse } from '../validation/common.ts';
import { leadContactOutcomeCommandSchema, leadContactOutcomeReceiptSchema,
  leadContactOutcomeResponseSchema } from '../validation/lead-contact-outcomes.ts';

// Actual API method and Zod contracts; the HTTP boundary is synthetic and
// recorded. No auth module, environment, network or database is initialized.
const path = 'lib/api/lead-contact-outcomes.ts';
const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'];
const command = (channel = 'call') => ({ commandId: ids[0], channel, outcome: channel === 'call' ? 'answered' : 'replied', notes: 'Synthetic note' });
const receipt = (channel = 'call') => ({ commandId: ids[0], leadId: ids[1], channel, activityId: ids[3], recordedAt: '2026-10-20T01:02:03.123456789Z' });
function runtime(respond = async () => ({ data: receipt() })) {
  const requests = [], intents = [];
  const deps = { parseDomainInput, uuidSchema, validateDomainResponse, leadContactOutcomeCommandSchema, leadContactOutcomeResponseSchema,
    captureCurrentLeadRequestIntent: intent => { intents.push(intent); return { ...intent, expectedUserId: 'actor-a', expectedSessionId: 'sid-a' }; },
    vimobAPIRequest: async (url, options) => { requests.push({ url, options }); return await respond(url, options); } };
  const exports = {};
  const api = Function(...Object.keys(deps), 'exports', `${code};return exports.leadContactOutcomesAPI;`)(...Object.values(deps), exports);
  return { api, requests, intents };
}

for (const channel of ['call', 'email']) test(`valid ${channel} sends one immutable intent and validates receipt`, async () => {
  const r = runtime(async () => ({ data: receipt(channel) })), controller = new AbortController(), onRequestStart = () => {};
  const intent = { signal: controller.signal, onRequestStart, expectedUserId: 'actor-a', expectedSessionId: 'sid-a' };
  assert.deepEqual(await r.api.record(ids[1], command(channel), ids[2], intent), receipt(channel));
  assert.equal(r.requests.length, 1);
  const { url, options } = r.requests[0]; assert.equal(url, `/v1/leads/${ids[1]}/contact-outcomes`);
  assert.equal(options.method, 'POST'); assert.equal(options.retry, false); assert.equal(options.organizationId, ids[2]);
  assert.equal(options.signal, controller.signal); assert.equal(options.onRequestStart, onRequestStart);
  assert.deepEqual(options.body, command(channel)); assert.deepEqual(r.intents, [intent]);
});

for (const outcome of ['answered', 'not_answered', 'invalid_number', 'busy', 'scheduled']) test(`call outcome ${outcome} is accepted`, () => {
  assert.equal(leadContactOutcomeCommandSchema.parse({ ...command(), outcome }).outcome, outcome);
});
for (const outcome of ['replied', 'not_replied', 'bounced']) test(`email outcome ${outcome} is accepted`, () => {
  assert.equal(leadContactOutcomeCommandSchema.parse({ ...command('email'), outcome }).outcome, outcome);
});
for (const input of [
  { ...command(), outcome: 'replied' }, { ...command('email'), outcome: 'answered' },
  { ...command(), channel: 'whatsapp' }, { ...command(), commandId: 'bad-id' },
  { ...command(), notes: 'NUL\u0000value' }, { ...command(), notes: '🧡'.repeat(2001) },
  { ...command(), extra: 'discarded silently is unsafe' },
]) test(`invalid command rejected before HTTP: ${JSON.stringify(input).slice(0, 120)}`, async () => {
  const r = runtime(); await assert.rejects(r.api.record(ids[1], input, ids[2])); assert.equal(r.requests.length, 0);
});
test('notes trim without truncation and count Unicode codepoints', () => {
  assert.equal(leadContactOutcomeCommandSchema.parse({ ...command(), notes: `  ${'🧡'.repeat(2000)}  ` }).notes, '🧡'.repeat(2000));
  assert.equal(leadContactOutcomeCommandSchema.parse({ ...command(), notes: '  ' }).notes, '');
});

for (const patch of [
  { commandId: ids[2] }, { leadId: ids[2] }, { channel: 'email' },
  { activityId: 'bad-id' }, { recordedAt: 'not-a-date' }, { recordedAt: '2026-10-20' },
  { recordedAt: '2026-13-99T99:99:99Z' }, { recordedAt: '2026-02-31T01:02:03Z' },
  { recordedAt: '2026-10-20T24:00:00Z' }, { recordedAt: '2026-10-20T01:02:03+99:99' }, { recordedAt: null },
]) test(`mismatched or malformed receipt cannot acknowledge draft: ${JSON.stringify(patch)}`, async () => {
  const r = runtime(async () => ({ data: { ...receipt(), ...patch } }));
  await assert.rejects(r.api.record(ids[1], command(), ids[2])); assert.equal(r.requests.length, 1);
});
for (const response of [null, {}, { data: null }, { data: [] }]) test(`invalid envelope is rejected: ${JSON.stringify(response)}`, async () => {
  const r = runtime(async () => response); await assert.rejects(r.api.record(ids[1], command(), ids[2])); assert.equal(r.requests.length, 1);
});
for (const status of [400, 401, 403, 404, 409, 422, 500, 503]) test(`HTTP ${status} never retries or falls back to generic activities`, async () => {
  const error = Object.assign(new Error('Synthetic transport failure'), { status });
  const r = runtime(async () => { throw error; });
  await assert.rejects(r.api.record(ids[1], command(), ids[2]), thrown => thrown === error);
  assert.equal(r.requests.length, 1); assert.match(r.requests[0].url, /\/contact-outcomes$/);
});
for (const [lead, org] of [['not-a-lead', ids[2]], [ids[1], 'not-an-org']]) test(`invalid ${lead === ids[1] ? 'organization' : 'lead'} UUID rejects without transport`, async () => {
  const r = runtime(); await assert.rejects(r.api.record(lead, command(), org)); assert.equal(r.requests.length, 0);
});
test('receipt accepts Go RFC3339Nano plus offset time, and does not mutate input', () => {
  const original = receipt(), before = structuredClone(original);
  assert.deepEqual(leadContactOutcomeReceiptSchema.parse(original), before); assert.deepEqual(original, before);
  assert.equal(leadContactOutcomeReceiptSchema.parse({ ...original, recordedAt: '2026-10-20T01:02:03-03:00' }).recordedAt, '2026-10-20T01:02:03-03:00');
});
