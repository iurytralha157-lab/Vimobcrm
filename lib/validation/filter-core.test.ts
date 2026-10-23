import assert from 'node:assert/strict';
import test from 'node:test';
import { contactListQuerySchema } from './crm-support';
import { campaignInsightsQuerySchema } from './marketing';
import { buildPipelineBoardQuery } from '../pipeline-board-query';
import { stageWithLeadsQueryKey } from '../pipeline-query-key';
import { pipelineLeadMatchesQueryKeyScope } from '../pipeline-board-cache';

test('contacts preserves accepted long filters and validates complete timestamp periods', () => {
  const parsed = contactListQuerySchema.parse({ search: 'x'.repeat(180), campaignIds: ['B, with comma', 'A', 'A'] });
  assert.equal(parsed.search?.length, 180);
  assert.deepEqual(parsed.campaignIds, ['A', 'B, with comma']);
  assert.equal(contactListQuerySchema.safeParse({ search: '🏠'.repeat(180), campaignId: '🏠'.repeat(255) }).success, true);
  assert.equal(contactListQuerySchema.safeParse({ search: '🏠'.repeat(181) }).success, false);
  assert.equal(contactListQuerySchema.safeParse({ search: 'null\0byte' }).success, false);
  for (const input of [
    { createdFrom: 'invalid', createdTo: '2026-10-12T00:00:00Z' },
    { createdFrom: '2026-10-12T00:00:00Z' },
    { createdFrom: '2026-10-12T00:00:00Z', createdTo: '2026-10-11T00:00:00Z' },
  ]) assert.equal(contactListQuerySchema.safeParse(input).success, false);
});

test('campaign arrays remain repeated values and separate pipeline caches', () => {
  const first = { filterCampaigns: ['B, with comma', 'A'] };
  assert.deepEqual(buildPipelineBoardQuery({ filters: first }).filterCampaigns, ['A', 'B, with comma']);
  assert.deepEqual(stageWithLeadsQueryKey({ filters: first }), stageWithLeadsQueryKey({ filters: { filterCampaigns: ['A', 'B, with comma'] } }));
  assert.notDeepEqual(stageWithLeadsQueryKey({ filters: first }), stageWithLeadsQueryKey({ filters: { filterCampaigns: ['A'] } }));
});

test('marketing accepts unassigned without treating the selection as a UUID', () => {
  const parsed = campaignInsightsQuerySchema.parse({ dateFrom: '2026-10-01', dateTo: '2026-10-12', pipelineId: '11111111-1111-4111-8111-111111111111', userId: 'unassigned', campaignIds: ['A', 'B, with comma'] });
  assert.equal(parsed.userId, 'unassigned');
  assert.deepEqual(parsed.campaignIds, ['A', 'B, with comma']);
  assert.equal(parsed.pipelineId, '11111111-1111-4111-8111-111111111111');
  assert.equal(campaignInsightsQuerySchema.safeParse({ dateFrom: '2026-10-01', dateTo: '2026-10-12', campaignIds: ['🏠'.repeat(255)] }).success, true);
  assert.equal(campaignInsightsQuerySchema.safeParse({ dateFrom: '2026-10-01', dateTo: '2026-10-12', userId: 'invalid' }).success, false);
});

test('optimistic pipeline updates respect campaign OR within one attribution row', () => {
  const key = stageWithLeadsQueryKey({ filters: { filterCampaigns: ['A', 'B'], filterAdSet: 'X' } });
  assert.equal(pipelineLeadMatchesQueryKeyScope(key, { id: 'lead', lead_meta: [{ campaign_id: 'B', adset_id: 'X' }] }), true);
  assert.equal(pipelineLeadMatchesQueryKeyScope(key, { id: 'lead', lead_meta: [{ campaign_id: 'C', adset_id: 'X' }] }), false);
  assert.equal(pipelineLeadMatchesQueryKeyScope(key, { id: 'lead', lead_meta: [{ campaign_id: 'A', adset_id: 'Y' }, { campaign_id: 'C', adset_id: 'X' }] }), false);
});
