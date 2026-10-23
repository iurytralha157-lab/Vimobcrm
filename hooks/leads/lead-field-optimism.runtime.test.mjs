import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { leadFieldOptimismRuntime } from './lead-field-optimism-runtime-fixture.mjs';

const rejection = (status = 403) => Object.assign(Error('Synthetic rejected write'), { status });
const assignment = () => ({ assigned_user_id: 'owner-b', assignee: { id: 'owner-b', name: 'Selected' }, can_operate: undefined });
const movement = () => ({ stage_id: 'stage-b', stage: { id: 'stage-b', name: 'Selected' } });

for (const [kind, makePatch] of [['assignment', assignment], ['movement', movement]]) {
  test(`${kind} applies over the latest local state and restores only its fields`, () => {
    const f = leadFieldOptimismRuntime();
    try {
      const api = f.render(), before = f.read(), patch = makePatch(), receipt = api.begin(before, patch, f.operation());
      f.patch({ tags: [{ id: 'restored-tag' }], name: 'New name', deal_status: 'won', whatsapp_avatar_url: 'fresh', valor_interesse: 42 });
      api.apply(receipt);
      assert.deepEqual(f.read().tags, [{ id: 'restored-tag' }]);
      api.reject(receipt, rejection());
      for (const key of Object.keys(patch)) assert.equal(f.read()[key], before[key], key);
      assert.deepEqual(f.read().tags, [{ id: 'restored-tag' }]);
      assert.equal(f.read().name, 'New name'); assert.equal(f.read().deal_status, 'won');
      assert.equal(f.read().whatsapp_avatar_url, 'fresh'); assert.equal(f.read().valor_interesse, 42);
    } finally { f.close(); }
  });

  for (const family of ['lead', 'pipeline-selected-lead-access', 'stages-with-leads']) test(`${kind} identical canonical ${family} read retires rollback`, async () => {
    const f = leadFieldOptimismRuntime();
    try {
      const api = f.render(), receipt = api.begin(f.read(), makePatch(), f.operation()); api.apply(receipt);
      const before = f.read(); assert.equal(await f.canonical(family), true);
      assert.equal(api.isCurrent(receipt), false); api.reject(receipt, rejection()); assert.equal(f.read(), before);
    } finally { f.close(); }
  });

  for (const status of [undefined, 0, 408, 429, 500, 503]) test(`${kind} uncertain ${status} result preserves provisional fields and reconciles`, () => {
    const f = leadFieldOptimismRuntime();
    try {
      const api = f.render(), receipt = api.begin(f.read(), makePatch(), f.operation()); api.apply(receipt); const before = f.read();
      api.reject(receipt, status === undefined ? new TypeError('Connection lost') : rejection(status));
      assert.equal(f.read(), before); assert(f.invalidations.some(value => value.queryKey[0] === 'lead'));
      assert(f.invalidations.some(value => value.queryKey[0] === 'stages-with-leads'));
    } finally { f.close(); }
  });
}

for (const patch of [{ updated_at: '2026-10-16T10:00:00.000002Z' }, { updated_at: undefined }, { updated_at: 'unparseable' }]) test('changed revision is not owned: ' + JSON.stringify(patch), () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), receipt = api.begin(f.read(), assignment(), f.operation()); api.apply(receipt); f.patch(patch);
    const before = f.read(); api.reject(receipt, rejection()); assert.equal(f.read(), before);
  } finally { f.close(); }
});

for (const changedField of ['assigned_user_id', 'assignee', 'can_operate']) test('changing one assignment field retires rollback of the whole relation: ' + changedField, () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), receipt = api.begin(f.read(), assignment(), f.operation()); api.apply(receipt);
    f.patch({ [changedField]: changedField === 'assignee' ? { id: 'owner-c' } : changedField === 'can_operate' ? false : 'owner-c' });
    const before = f.read(); api.reject(receipt, rejection()); assert.equal(f.read(), before);
  } finally { f.close(); }
});

for (const replacement of [{ organizationId: 'org-b' }, { actorId: 'actor-b' }, { sessionId: 'sid-b' }, { leadId: 'lead-b' }]) test('retired context never rolls back replacement state: ' + JSON.stringify(replacement), () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), receipt = api.begin(f.read(), assignment(), f.operation()); api.apply(receipt); f.render(replacement);
    f.patch({ name: 'Replacement' }); const before = f.read(); api.reject(receipt, rejection()); assert.equal(f.read(), before);
    assert(f.invalidations.every(value => value.refetchType === 'none'));
  } finally { f.close(); }
});

test('SID A to B to A cannot revive old receipt or initiating API', () => {
  const f = leadFieldOptimismRuntime();
  try {
    const old = f.render(), receipt = old.begin(f.read(), assignment(), f.operation()); old.apply(receipt);
    f.render({ sessionId: 'sid-b' }); f.render({ sessionId: 'sid-a' }); const before = f.read(); old.reject(receipt, rejection());
    assert.equal(f.read(), before); assert.equal(old.isCurrent(receipt), false);
  } finally { f.close(); }
});

test('queued rollback rechecks context when React executes the updater', () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), receipt = api.begin(f.read(), movement(), f.operation()); api.apply(receipt);
    f.deferUpdaters(); api.reject(receipt, rejection()); f.render({ sessionId: 'sid-b' }); const before = f.read(); f.flush();
    assert.equal(f.read(), before);
  } finally { f.close(); }
});

test('queued apply rechecks canonical epoch when React executes the updater', async () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), receipt = api.begin(f.read(), movement(), f.operation()); f.deferUpdaters(); api.apply(receipt);
    await f.canonical(); const before = f.read(); f.flush(); assert.equal(f.read(), before);
  } finally { f.close(); }
});

test('overlapping operation on the same group cannot restore an earlier provisional snapshot', () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), first = api.begin(f.read(), assignment(), f.operation()); api.apply(first);
    const second = api.begin(f.read(), { ...assignment(), assigned_user_id: 'owner-c' }, f.operation()); api.apply(second);
    api.reject(first, rejection()); const before = f.read(); api.reject(second, rejection()); assert.equal(f.read(), before);
  } finally { f.close(); }
});

test('completion and discard retire receipts without changing unrelated fields', () => {
  const f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), first = api.begin(f.read(), movement(), f.operation()); api.apply(first); api.complete(first);
    const before = f.read(); api.reject(first, rejection()); assert.equal(f.read(), before);
    const second = api.begin(f.read(), assignment(), f.operation()); api.discard(second); api.apply(second); assert.equal(f.read(), before);
  } finally { f.close(); }
});

test('rollback preserves absence instead of creating an explicit undefined relation property', () => {
  const f = leadFieldOptimismRuntime({ lead: { id: 'lead-a', organization_id: 'org-a', updated_at: '2026-10-16T10:00:00.000001Z' } });
  try {
    const api = f.render(), receipt = api.begin(f.read(), assignment(), f.operation()); api.apply(receipt);
    assert.equal(Object.hasOwn(f.read(), 'assignee'), true); api.reject(receipt, rejection());
    for (const key of Object.keys(assignment())) assert.equal(Object.hasOwn(f.read(), key), false, key);
  } finally { f.close(); }
});

test('client replacement retires old ownership and reconciles the original cache without refetch', () => {
  const replacement = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), f = leadFieldOptimismRuntime();
  try {
    const api = f.render(), receipt = api.begin(f.read(), assignment(), f.operation()); api.apply(receipt);
    f.render({ client: replacement }); const before = f.read(); api.reject(receipt, rejection());
    assert.equal(f.read(), before); assert(f.invalidations.length > 0); assert(f.invalidations.every(value => value.refetchType === 'none'));
  } finally { f.close(); replacement.clear(); }
});

test('unmount retires pending rollback even if the operation incorrectly remains current', () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), f = leadFieldOptimismRuntime({ client });
  try {
    const api = f.render(), receipt = api.begin(f.read(), movement(), { isCurrent: () => true }); api.apply(receipt);
    const before = f.read(); f.close(); api.reject(receipt, rejection()); assert.equal(f.read(), before);
    assert.equal(api.isCurrent(receipt), false);
  } finally { client.clear(); }
});

test('old initiating API cannot begin after scope ABA', () => {
  const f = leadFieldOptimismRuntime();
  try {
    const old = f.render(); f.render({ actorId: 'actor-b' }); f.render({ actorId: 'actor-a' });
    assert.equal(old.begin(f.read(), assignment(), { isCurrent: () => true }), null);
  } finally { f.close(); }
});
