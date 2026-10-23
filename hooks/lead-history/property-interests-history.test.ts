import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLeadHistory } from './build-history';
import { buildContent, buildLabel } from './presentation';
import type { ActivityEventRow } from './types';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };

test('property-interest changes display counts without projecting private property identities', () => {
  const metadata = { added_count: 2, removed_count: 1, previous_count: 3, current_count: 4,
    added_ids: ['synthetic-private-id'], property_title: 'Synthetic private title', operation_id: 'synthetic-operation' };
  assert.equal(buildLabel('property_interests_changed', metadata), 'Imóveis de interesse atualizados');
  assert.equal(buildContent('property_interests_changed', metadata, formatters), '2 imóveis adicionados · 1 imóvel removido · Total: 4');
});

test('removing all properties remains readable and malformed counts are not invented', () => {
  assert.equal(buildContent('property_interests_changed', { removed_count: 1, current_count: 0 }, formatters), '1 imóvel removido · Total: 0');
  assert.equal(buildContent('property_interests_changed', { added_count: -1, removed_count: 'invalid', current_count: 0.5 }, formatters), undefined);
});

test('unified history preserves distinct interest changes and their authenticated actors', () => {
  const events: ActivityEventRow[] = [1, 2].map(index => ({ id: `activity-${index}`, type: 'property_interests_changed',
    created_at: '2026-10-18T12:00:00.000001Z', user_id: 'actor-a', content: 'Imóveis de interesse atualizados',
    metadata: { operation_id: `operation-${index}`, added_count: 1, removed_count: 0, previous_count: index, current_count: index + 1 } }));
  const history = buildLeadHistory({ activityEvents: events, users: [{ id: 'actor-a', name: 'Synthetic actor' }] }, 'lead-a', formatters);
  assert.equal(history.length, 2);
  assert.ok(history.every(event => event.actor?.name === 'Synthetic actor'));
  assert.deepEqual(history.map(event => event.content), ['1 imóvel adicionado · Total: 2', '1 imóvel adicionado · Total: 3']);
});
