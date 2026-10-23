import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const ts = require('typescript');
const root = process.cwd();
const org = '22222222-2222-4222-8222-222222222222';
const lead = '11111111-1111-4111-8111-111111111111';
let activeOrg = org, readPage, requests;
const modules = new Map();
function source(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const compiled = new Module(filename);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  modules.set(filename, compiled);
  compiled.require = (specifier) => {
    if (specifier === '@/contexts/AuthContext') return { useAuth: () => ({ activeOrganization: { organizationId: activeOrg } }) };
    if (specifier === './vimob-client') return { vimobAPIRequest: async (url, options) => { requests.push({ url, ...options }); return readPage(options); } };
    if (specifier === '@/lib/validation') return { ...source('lib/validation/common.ts'), ...source('lib/validation/schedule.ts') };
    if (specifier.startsWith('@/')) return source(`${specifier.slice(2)}.ts`);
    if (specifier.startsWith('./')) return source(path.relative(root, path.resolve(path.dirname(filename), `${specifier}.ts`)));
    return require(specifier);
  };
  compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return compiled.exports;
}
const { useLeadSchedulePreview } = source('hooks/leads/use-lead-schedule-preview.ts');
const { scheduleAPI } = source('lib/api/schedule.ts');
function event(index) {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, organization_id: org, lead_id: lead,
    user_id: org, property_id: null, title: 'Synthetic appointment', description: null,
    event_type: 'task', start_time: '2026-10-12T12:00:00Z', end_time: '2026-10-12T13:00:00Z',
    is_all_day: false, location: null, status: 'scheduled', reminder_minutes: null, google_event_id: null,
    completed_by: null, completed_at: null, created_at: null, updated_at: null };
}
function capture(client) {
  let query;
  function Capture() { query = useLeadSchedulePreview(lead, true); return null; }
  renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(Capture)));
  return query;
}
test('popup loads one page first, then explicitly loads more through the actual hook and API', async () => {
  requests = []; activeOrg = org;
  readPage = ({ query }) => ({ data: Array.from({ length: query.offset === 0 ? 50 : 5 }, (_, i) => event(query.offset + i)),
    pagination: { offset: query.offset, limit: 50, has_more: query.offset === 0 } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await capture(client).fetchNextPage();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].query.leadId, lead);
  assert.equal(requests[0].organizationId, org);
  assert.equal(requests[0].query.limit, 50);
  assert.equal(requests[0].query.leadPreview, true);
  assert.equal(capture(client).events.length, 50);
  assert.equal(capture(client).hasNextPage, true);
  await capture(client).fetchNextPage();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].query.offset, 50);
  assert.equal(capture(client).events.length, 55);
  assert.equal(capture(client).hasNextPage, false);
  client.clear();
});
test('next-page failure preserves the first page and another organization has a separate cache', async () => {
  requests = []; activeOrg = org;
  readPage = ({ query }) => {
    if (query.offset > 0) throw new Error('Synthetic unavailable');
    return { data: [event(0)], pagination: { offset: 0, limit: 50, has_more: true } };
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await capture(client).fetchNextPage();
  await capture(client).fetchNextPage();
  assert.equal(capture(client).events.length, 1);
  assert.equal(capture(client).isFetchNextPageError, true);
  activeOrg = '33333333-3333-4333-8333-333333333333';
  assert.equal(capture(client).events.length, 0);
  client.clear();
});
test('API rejects inconsistent or stalled page metadata, while retaining legacy full-array compatibility', async () => {
  requests = [];
  await assert.rejects(scheduleAPI.getLeadSchedulePage({ organizationId: org, leadId: lead, offset: -1 }));
  assert.equal(requests.length, 0);
  readPage = () => ({ data: [event(0)], pagination: { offset: 50, limit: 50, has_more: false } });
  await assert.rejects(scheduleAPI.getLeadSchedulePage({ organizationId: org, leadId: lead, offset: 0 }));
  readPage = () => ({ data: [], pagination: { offset: 0, limit: 50, has_more: true } });
  await assert.rejects(scheduleAPI.getLeadSchedulePage({ organizationId: org, leadId: lead, offset: 0 }));
  readPage = () => ({ data: [event(0)] });
  assert.equal((await scheduleAPI.getLeadSchedulePage({ organizationId: org, leadId: lead, offset: 0 })).data.length, 1);
});
