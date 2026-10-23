import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { canConfirmTagDeletion, invalidateTagConsumers, invalidateTagCounts, isCurrentManagementMutation, shouldRefreshTagCounts } from './management';
import { createTagFormState, tagFormReducer } from './tag-form-state';

const tag = { id: 'tag-a', name: 'Quente', color: '#fff', description: 'Classificação existente', updated_at: '2026-10-12T10:00:00Z' };

test('canceling edit then opening create discards the old identifier, revision and values', () => {
  let state = tagFormReducer(createTagFormState(), { type: 'edit', tag });
  state = tagFormReducer(state, { type: 'values', values: { name: 'Rascunho', color: '#ef4444' } });
  state = tagFormReducer(state, { type: 'visibility', open: false });
  state = tagFormReducer(state, { type: 'visibility', open: true });
  assert.equal(state.open, true);
  assert.equal(state.editingTag, null);
  assert.equal(state.values.name, '');
  assert.equal(state.values.description, undefined);
});

test('association invalidation refreshes only tag counters and deletion snapshots in its tenant', async () => {
  const client = new QueryClient();
  const affected = [['tags', 'org-a'], ['tag-usage', 'org-a', 'tag-a']];
  const preserved = [['tags', 'org-b'], ['tag-usage', 'org-b', 'tag-b'], ['lead', 'org-a', 'lead-a']];
  for (const key of [...affected, ...preserved]) client.setQueryData(key, { count: 2 });
  await invalidateTagCounts(client, 'org-a');
  for (const key of affected) assert.equal(client.getQueryState(key)?.isInvalidated, true);
  for (const key of preserved) assert.equal(client.getQueryState(key)?.isInvalidated, false);
  client.clear();
});

test('tag count batches distinguish association/intake/deletion from WhatsApp message traffic', () => {
  for (const reason of ['lead.tagged', 'lead.untagged', 'lead.created', 'lead.deleted', 'lead.reentered', 'lead.meta_webhook_received', 'lead.webhook_received']) {
    assert.equal(shouldRefreshTagCounts([reason]), true, reason);
  }
  assert.equal(shouldRefreshTagCounts(['lead.whatsapp_activity', 'whatsapp.message.created']), false);
  assert.equal(shouldRefreshTagCounts(['whatsapp.message.created', ' LEAD.TAGGED ']), true);
});

test('failed tag edits preserve the original revision and entered values until an explicit reload', () => {
  let state = tagFormReducer(createTagFormState(), { type: 'edit', tag });
  state = tagFormReducer(state, { type: 'values', values: { ...state.values, name: 'Investidor' } });
  state = tagFormReducer(state, { type: 'error', error: 'Esta tag mudou' });
  assert.equal(state.values.name, 'Investidor');
  assert.equal(state.editingTag?.updated_at, tag.updated_at);
  const current = { ...tag, name: 'Outro gestor', updated_at: '2026-10-12T11:00:00Z' };
  state = tagFormReducer(state, { type: 'edit', tag: current });
  assert.equal(state.values.name, 'Outro gestor');
  assert.equal(state.editingTag?.updated_at, current.updated_at);
  assert.equal(state.error, null);
});

test('legacy short hex colors can be edited without choosing a different color', () => {
  const state = tagFormReducer(createTagFormState(), { type: 'edit', tag });
  assert.equal(state.values.color, '#ffffff');
  assert.equal(state.values.description, tag.description);
});

test('deletion requires a verified unchanged tag without configuration references', () => {
  assert.equal(canConfirmTagDeletion(undefined, tag.updated_at), false);
  assert.equal(canConfirmTagDeletion({ updated_at: tag.updated_at, usages: [] }, tag.updated_at), true);
  assert.equal(canConfirmTagDeletion({ updated_at: 'changed', usages: [] }, tag.updated_at), false);
  assert.equal(canConfirmTagDeletion({ updated_at: tag.updated_at, usages: [{ kind: 'distribution_rule', count: 1 }] }, tag.updated_at), false);
});

test('a completion from an old organization or an unmounted dialog cannot notify the new scope', () => {
  assert.equal(isCurrentManagementMutation('org-b', 'org-a'), false);
  assert.equal(isCurrentManagementMutation(null, 'org-a'), false);
  assert.equal(isCurrentManagementMutation('org-a', 'org-a'), true);
});

test('tag changes invalidate embedded consumer snapshots only in the originating tenant', async () => {
  const client = new QueryClient();
  const affected = [
    ['tags', 'org-a'], ['lead', 'org-a', 'lead-a'], ['contacts-list', 'org-a', 'viewer'],
    ['stages-with-leads', 'org-a', 'pipeline'], ['dashboard-stats', 'org-a'],
    ['whatsapp-conversation', 'tenant-scope', 'org-a', 'viewer', 'scope', 'conversation'],
    ['conversation-lead-detail', 'org-a', 'lead-a'],
  ];
  const preserved = [
    ['tags', 'org-b'], ['lead', 'org-b', 'lead-b'], ['contacts-list', 'org-b'],
    ['whatsapp-conversation', 'tenant-scope', 'org-b', 'viewer'],
    ['conversation-lead-detail', 'org-b', 'lead-b'],
    ['lead-history-v2', 'lead-a'], ['properties', 'org-a'],
  ];
  for (const key of [...affected, ...preserved]) client.setQueryData(key, { snapshot: true });
  await invalidateTagConsumers(client, 'org-a');
  for (const key of affected) assert.equal(client.getQueryState(key)?.isInvalidated, true, JSON.stringify(key));
  for (const key of preserved) assert.equal(client.getQueryState(key)?.isInvalidated, false, JSON.stringify(key));
  client.clear();
});
