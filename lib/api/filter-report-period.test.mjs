import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as finalDomains from '../validation/final-domains.ts';
import * as crmSupport from '../validation/crm-support.ts';
import * as common from '../validation/common.ts';
import { readContactPageResponse } from './contact-page-response.ts';
import { z } from 'zod';

// Execute the real API functions and Zod contracts. Only the HTTP boundary is
// replaced; accepted inputs stop there, and invalid inputs must never reach it.
const requests = [];
const transportBoundary = new Error('synthetic transport boundary');
function loadApi(filename) {
  const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(compiled, {
    Date, exports: record.exports, module: record,
    require: specifier => {
      if (specifier === '@/lib/validation') return { ...finalDomains, ...crmSupport, ...common };
      if (specifier === '@/lib/api/contact-page-response') return { readContactPageResponse };
      if (specifier === 'zod') return { z };
      if (specifier === './vimob-client') return {
        vimobAPIRequest: async (path, options) => {
          requests.push({ path, options });
          throw transportBoundary;
        },
      };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  }, { filename });
  return record.exports;
}
const dashboard = loadApi('./dashboard.ts');
const { contactsAPI } = loadApi('./contacts.ts');
const organizationId = '10000000-0000-4000-8000-000000000001';
const brokerId = '20000000-0000-4000-8000-000000000001';
const from = new Date('2020-01-01T00:00:00Z');
const atLimit = { from, to: new Date(from.getTime() + 1830 * 86400000) };
const overLimit = { from, to: new Date(atLimit.to.getTime() + 1) };
const filteredDashboardCalls = [
  'getDashboardStats', 'getDashboardFunnel', 'getDashboardSources',
  'getDashboardTopBrokers', 'getDashboardLeadDistribution', 'getDashboardCampaigns',
  'getDashboardCreatives', 'getDashboardCreativeMedia', 'getDashboardFirstContact',
  'getDashboardFirstContactLeadPage', 'getDashboardDealsEvolution', 'getDashboardExtraCounts',
];

async function rejectsBeforeTransport(call) {
  const count = requests.length;
  await assert.rejects(call, error => error instanceof common.DomainValidationError && error.direction === 'input');
  assert.equal(requests.length, count);
}
async function reachesTransport(call) {
  const count = requests.length;
  await assert.rejects(call, error => error === transportBoundary);
  assert.equal(requests.length, count + 1);
  return requests.at(-1);
}

test('manual Dashboard refetches reject excessive or empty periods before HTTP and accept all-time', async () => {
  for (const name of filteredDashboardCalls) {
    const call = dateRange => () => dashboard[name]({ organizationId, brokerId, key: 'creative:fixture', filters: { dateRange } });
    await rejectsBeforeTransport(call(overLimit));
    await rejectsBeforeTransport(call({ from, to: from }));
    const request = await reachesTransport(call(atLimit));
    assert.equal(request.options.query.dateFrom, atLimit.from.toISOString(), name);
    assert.equal(request.options.query.dateTo, atLimit.to.toISOString(), name);
    const allTime = await reachesTransport(call(null));
    assert.equal(allTime.options.query.dateFrom, undefined, name);
    assert.equal(allTime.options.query.dateTo, undefined, name);
  }
  await rejectsBeforeTransport(() => dashboard.getDashboardTeamLeadIds({ organizationId, teamId: brokerId, dateRange: overLimit }));
});

test('Contacts list and export preserve the API period limit before HTTP', async () => {
  for (const mode of ['compact', 'export']) {
    await rejectsBeforeTransport(() => contactsAPI.list({ mode, createdFrom: from.toISOString(), createdTo: overLimit.to.toISOString() }, organizationId));
    const request = await reachesTransport(() => contactsAPI.list({ mode, createdFrom: from.toISOString(), createdTo: atLimit.to.toISOString() }, organizationId));
    assert.equal(request.options.query.createdTo, atLimit.to.toISOString());
    const allTime = await reachesTransport(() => contactsAPI.list({ mode }, organizationId));
    assert.equal(allTime.options.query.createdFrom, undefined);
    assert.equal(allTime.options.query.createdTo, undefined);
  }
});

test('accepted report filters retain legacy source and search alongside the period', async () => {
  const source = '🏠'.repeat(4096);
  const request = await reachesTransport(() => dashboard.getDashboardExtraCounts({ organizationId, filters: { dateRange: atLimit, source, searchQuery: 'Ana' } }));
  assert.equal(request.options.query.source, source);
  assert.equal(request.options.query.searchQuery, 'Ana');
  const contactRequest = await reachesTransport(() => contactsAPI.list({ createdFrom: from.toISOString(), createdTo: atLimit.to.toISOString(), source, search: 'Ana' }, organizationId));
  assert.equal(contactRequest.options.query.source, source);
  assert.equal(contactRequest.options.query.search, 'Ana');
});
