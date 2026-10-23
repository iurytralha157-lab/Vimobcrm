import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { QueryClient, QueryClientProvider, QueryObserver } = require('@tanstack/react-query');
const compiledModules = new Map();
let onPersistedLeadSignal;
// Compile the actual consumer and cache code entirely in memory. The notification
// bus is inert; QueryClient, React contexts and observed refetches are real.
function loadSource(relativePath) {
  const filename = path.join(root, relativePath);
  if (compiledModules.has(filename)) return compiledModules.get(filename).exports;
  const compiled = new Module(filename);
  compiledModules.set(filename, compiled);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(root);
  compiled.require = (specifier) => {
    if (specifier === '@/contexts/AuthContext') return { useAuth: () => ({ activeOrganization: { organizationId: 'org' } }) };
    if (specifier === '@/contexts/LeadRealtimeBus') return { notifyLeadRealtimeChange(event) { onPersistedLeadSignal?.(event); } };
    if (!specifier.startsWith('@/')) return require(specifier);
    const sourcePath = `${specifier.slice(2)}.ts`;
    if (!existsSync(path.join(root, sourcePath))) throw new Error(`Unexpected runtime dependency: ${specifier}`);
    return loadSource(sourcePath);
  };
  compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return compiled.exports;
}
const { useLeadDetailPipelineCache } = loadSource('components/features/leads/lead-detail/use-lead-detail-pipeline-cache.ts');

function key({ team = 'current-B', user } = {}) {
  const parts = ['stages-with-leads', 'org', 'pipeline'];
  parts[3] = user;
  parts[16] = team;
  return parts;
}
const lead = { id: 'lead', name: 'Original', stage_id: 'old', assigned_user_id: 'broker', team_id: 'queue-A', deal_status: 'open', valor_interesse: 100, can_operate: true };
function board(value = lead) {
  return [{ id: 'old', leads: [value], total_lead_count: 1, total_value: 100, has_more: false }, { id: 'new', leads: [], total_lead_count: 0, total_value: 0, has_more: false }];
}
function operations(client) {
  let captured;
  function Capture() { captured = useLeadDetailPipelineCache(); return null; }
  renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(Capture)));
  return captured;
}

for (const mode of ['assignee', 'stage-and-fields']) {
  test(`unknown ${mode} criteria wait for persistence before refetch and never admit another board`, async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const selectedKey = key();
    const otherKey = key({ team: 'other-C' });
    const original = board();
    const otherBoard = [{ id: 'new', leads: [], total_lead_count: 0, total_value: 0, has_more: false }];
    client.setQueryData(selectedKey, original);
    client.setQueryData(otherKey, otherBoard);
    let completeServerRead;
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: selectedKey, staleTime: Infinity,
      queryFn: () => { reads += 1; return new Promise(resolve => { completeServerRead = resolve; }); },
    });
    const unsubscribe = observer.subscribe(() => {});
    const invalidations = [];
    const invalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (...args) => {
      const promise = invalidate(...args);
      invalidations.push({ args, promise });
      return promise;
    };
    // Simulate the notification boundary's existing post-write coordinator.
    // The actual consumer determines when this completion signal is emitted.
    onPersistedLeadSignal = (event) => {
      assert.equal(event.organizationId, 'org');
      assert.equal(event.leadId, lead.id);
      void client.invalidateQueries({ queryKey: selectedKey, exact: true, refetchType: 'active' }, { cancelRefetch: false });
    };
    try {
      const api = operations(client);
      if (mode === 'assignee') api.updatePipelineAssigneeCache({ ...lead, assigned_user_id: 'new-broker' });
      else api.updatePipelineLeadCache(lead.id, { stage_id: 'new', name: 'Changed', valor_interesse: 500 });
      assert.strictEqual(client.getQueryData(selectedKey), original);
      assert.strictEqual(client.getQueryData(otherKey), otherBoard);
      assert.equal(reads, 0);
      assert.equal(invalidations.length, 1);
      assert.equal(invalidations[0].args[0].exact, true);
      assert.equal(invalidations[0].args[0].refetchType, 'none');
      assert.equal(client.getQueryState(selectedKey).isInvalidated, true);
      api.refreshPipelineInBackground('org', lead.id, 'lead.updated');
      assert.equal(reads, 1);
      assert.equal(invalidations.length, 2);
      assert.equal(invalidations[1].args[1].cancelRefetch, false);
      // Only the authoritative observed response may exclude or move a card.
      const authoritative = [{ id: 'old', leads: [], total_lead_count: 0, total_value: 0, has_more: false }];
      completeServerRead(authoritative);
      await invalidations[1].promise;
      assert.deepEqual(client.getQueryData(selectedKey), authoritative);
      assert.strictEqual(client.getQueryData(otherKey), otherBoard);
    } finally {
      unsubscribe();
      onPersistedLeadSignal = undefined;
      client.clear();
    }
  });
}

test('a known responsible-user mismatch still removes the card rather than retaining uncertain team membership', () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const selectedKey = key({ user: 'broker' });
  client.setQueryData(selectedKey, board());
  try {
    operations(client).updatePipelineAssigneeCache({ ...lead, assigned_user_id: 'other' });
    const updated = client.getQueryData(selectedKey);
    assert.equal(updated[0].leads.length, 0);
    assert.equal(updated[0].total_lead_count, 0);
    assert.equal(updated[0].total_value, 0);
  } finally { client.clear(); }
});

test('a rejection preserves authorized snapshots and reconciles only after the write boundary', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const selectedKey = key();
  const otherKey = key({ team: 'other-C' });
  const original = board();
  const otherBoard = [{ id: 'new', leads: [], total_lead_count: 0, total_value: 0, has_more: false }];
  client.setQueryData(selectedKey, original);
  client.setQueryData(otherKey, otherBoard);
  let reads = 0;
  let completeRead;
  const observer = new QueryObserver(client, { queryKey: selectedKey, staleTime: Infinity,
    queryFn: () => { reads += 1; return new Promise(resolve => { completeRead = resolve; }); } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const api = operations(client);
    const snapshots = api.updatePipelineLeadCache(lead.id, { stage_id: 'new' });
    assert.strictEqual(client.getQueryData(selectedKey), original);
    assert.equal(client.getQueryState(selectedKey).isInvalidated, true);
    assert.equal(reads, 0);
    assert.strictEqual(client.getQueryData(otherKey), otherBoard);
    api.restorePipelineCache(snapshots);
    assert.strictEqual(client.getQueryData(selectedKey), original);
    assert.equal(client.getQueryState(selectedKey).isInvalidated, true);
    assert.equal(reads, 1);
    assert.strictEqual(client.getQueryData(otherKey), otherBoard);
    completeRead(original);
    await observer.refetch({ cancelRefetch: false });
    assert.equal(client.getQueryState(selectedKey).isInvalidated, false);
    assert.strictEqual(client.getQueryData(otherKey), otherBoard);
  } finally { unsubscribe(); client.clear(); }
});

test('all lead mutations used by the detail trigger the existing coordinator after persistence succeeds', () => {
  const source = readFileSync(path.join(root, 'hooks/use-leads.ts'), 'utf8');
  for (const name of ['useUpdateLead', 'useAddLeadTag', 'useRemoveLeadTag']) {
    const start = source.indexOf(`export function ${name}(`);
    const end = source.indexOf('\nexport function ', start + 1);
    const mutation = source.slice(start, end < 0 ? undefined : end);
    if (name === 'useUpdateLead') {
      // lead-update-session.runtime.test.mjs executes this delegate with the real
      // MutationObserver/cache and checks zero signals before persistence, one after.
      assert.match(source, /import \{ useLeadUpdateCache \} from '@\/hooks\/leads\/use-lead-update-cache'/);
      assert.match(mutation, /const updateCache = useLeadUpdateCache\(queryClient, organizationId, user\?\.id\)/);
      assert.match(mutation, /onSuccess: updateCache\.onSuccess/);
      const delegated = readFileSync(path.join(root, 'hooks/leads/use-lead-update-cache.ts'), 'utf8');
      const onSuccess = delegated.indexOf('onSuccess:');
      assert.ok(onSuccess >= 0 && delegated.indexOf('notifyLeadRealtimeChange(', onSuccess) > onSuccess, 'update cache must publish after canonical success');
      continue;
    }
    const onSuccess = mutation.indexOf('onSuccess:');
    assert.ok(onSuccess >= 0 && mutation.indexOf('notifyLeadRealtimeChange(', onSuccess) > onSuccess, `${name} must publish after server success`);
  }
});
