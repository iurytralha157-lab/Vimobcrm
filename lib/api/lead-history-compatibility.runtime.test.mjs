import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as schemas from '../validation/lead-history-pagination.ts';
import { parseDomainInput, validateDomainResponse } from '../validation/common.ts';
import { evaluateProduction, productionDeclaration } from '../../hooks/leads/lead-request-runtime-fixture.mjs';

const leadId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const timestamp = '2026-10-16T12:00:00.123456+00:00';

function legacy() {
  return { data: {
    timelineEvents: [{ id: eventId, event_type: 'lead_created', created_at: timestamp }],
    activityEvents: [{ id: eventId, type: 'note', created_at: timestamp, content: 'Synthetic note' }],
    entryEvents: [], distributionLogs: [], assignmentLogs: [], auditLogs: [], users: [],
    lead: { id: leadId, created_at: timestamp, source: 'manual' }, leadMeta: {},
  } };
}

function paged() {
  const response = legacy();
  response.data.historyCoverage = { complete: false,
    canonicalPresence: { leadCreated: true, firstResponse: false, assignment: false } };
  response.pagination = { nextCursor: null, hasOlder: false, snapshotAt: timestamp };
  return response;
}

function fixture(response, failure) {
  const requests = [];
  const method = productionDeclaration('lib/api/leads.ts', node => ts.isMethodDeclaration(node)
    && node.name.getText() === 'getLeadHistoryPage');
  const get = evaluateProduction(`const api={${method}}`, {
    ...schemas, parseDomainInput, validateDomainResponse,
    vimobAPIRequest: async (...args) => { requests.push(args); if (failure) throw failure; return response; },
  }, 'api.getLeadHistoryPage');
  return { requests, get };
}

test('strict mode continues rejecting the valid old envelope', async () => {
  const f = fixture(legacy());
  await assert.rejects(f.get(leadId, organizationId), /Contrato invalido/);
  await assert.rejects(f.get(leadId, organizationId, { allowLegacy: false }), /Contrato invalido/);
  assert.equal(f.requests.length, 2);
});

test('explicit first-page opt-in accepts and marks the full validated legacy response', async () => {
  const response = legacy(), before = structuredClone(response), f = fixture(response);
  const abort = new AbortController();
  const result = await f.get(leadId, organizationId, { allowLegacy: true, pageSize: 50, signal: abort.signal });
  assert.deepEqual(result, { data: response.data, legacy: true });
  assert.equal(result.pagination, undefined);
  assert.deepEqual(response, before);
  assert.equal(f.requests.length, 1);
  const [path, options] = f.requests[0];
  assert.equal(path, `/v1/leads/${leadId}/history-raw`);
  assert.equal(options.organizationId, organizationId);
  assert.equal(options.signal, abort.signal);
  assert.deepEqual(options.query, { pageSize: 50, cursor: undefined });
  assert.equal(Object.hasOwn(options.query, 'allowLegacy'), false);
});

test('valid pagination keeps the original shape with opt-in and cursor', async () => {
  for (const options of [{}, { allowLegacy: true }, { allowLegacy: true, cursor: 'synthetic-cursor' }]) {
    const response = paged(), f = fixture(response);
    const result = await f.get(leadId, organizationId, options);
    assert.deepEqual(result, response);
    assert.equal(result.legacy, undefined);
    assert.equal(f.requests.length, 1);
  }
});

test('a cursor can never accept the full old envelope as another page', async () => {
  const f = fixture(legacy());
  await assert.rejects(f.get(leadId, organizationId, { allowLegacy: true, cursor: 'synthetic-cursor' }), /Contrato invalido/);
  assert.equal(f.requests.length, 1);
});

test('legacy response for another lead cannot be accepted', async () => {
  const response = legacy(); response.data.lead.id = organizationId;
  const f = fixture(response);
  await assert.rejects(f.get(leadId, organizationId, { allowLegacy: true }), /Contrato invalido/);
});

for (const [label, mutate] of [
  ['pagination null', response => { response.pagination = null; }],
  ['pagination undefined', response => { response.pagination = undefined; }],
  ['pagination empty', response => { response.pagination = {}; }],
  ['coverage null', response => { response.data.historyCoverage = null; }],
  ['coverage undefined', response => { response.data.historyCoverage = undefined; }],
  ['coverage incomplete', response => { response.data.historyCoverage = {}; }],
]) test(`${label} is a broken paged response, never a legacy response`, async () => {
  const response = legacy(); mutate(response); const f = fixture(response);
  await assert.rejects(f.get(leadId, organizationId, { allowLegacy: true }), /Contrato invalido/);
  assert.equal(f.requests.length, 1);
});

for (const [label, mutate] of [
  ['missing timeline', response => { delete response.data.timelineEvents; }],
  ['missing assignments', response => { delete response.data.assignmentLogs; }],
  ['null activities', response => { response.data.activityEvents = null; }],
  ['invalid event ID', response => { response.data.activityEvents[0].id = 'bad'; }],
  ['invalid timestamp', response => { response.data.activityEvents[0].created_at = 'yesterday'; }],
  ['invalid activity type', response => { response.data.activityEvents[0].type = ''; }],
  ['invalid timeline type', response => { response.data.timelineEvents[0].event_type = ''; }],
  ['missing lead date', response => { delete response.data.lead.created_at; }],
  ['invalid user', response => { response.data.users = [{ id: eventId, name: 42 }]; }],
  ['invalid optional queue events', response => { response.data.queueRuntimeEvents = [{ id: eventId }]; }],
]) test(`legacy opt-in preserves validation: ${label}`, async () => {
  const response = legacy(); mutate(response); const f = fixture(response);
  await assert.rejects(f.get(leadId, organizationId, { allowLegacy: true }), /Contrato invalido/);
  assert.equal(f.requests.length, 1);
});

test('optional valid queue events and null row dates are preserved in legacy data', async () => {
  const response = legacy();
  response.data.queueRuntimeEvents = [{ id: eventId, event_type: 'assigned', created_at: null }];
  const result = await fixture(response).get(leadId, organizationId, { allowLegacy: true });
  assert.deepEqual(result.data, response.data);
  assert.equal(result.legacy, true);
});

for (const status of [401, 403, 404, 500, undefined]) {
  test(`transport failure ${status ?? 'network'} remains the same error with no fallback request`, async () => {
    const failure = Object.assign(new Error('Synthetic request failed'), { status });
    const f = fixture(legacy(), failure);
    await assert.rejects(f.get(leadId, organizationId, { allowLegacy: true }), error => error === failure);
    assert.equal(f.requests.length, 1);
  });
}

test('invalid input does not reach transport even when compatibility is enabled', async () => {
  const f = fixture(legacy());
  for (const options of [{ pageSize: 201 }, { cursor: '' }]) {
    await assert.rejects(f.get(leadId, organizationId, { ...options, allowLegacy: true }), /Contrato invalido/);
  }
  assert.equal(f.requests.length, 0);
});
