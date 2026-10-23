import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedLeadFiltersForConversations, sharedLeadConversationFilterCount, type SharedLeadConversationScope } from './whatsapp-shared-filters';

const scope: SharedLeadConversationScope = {
  pipelineId: 'pipeline', teamId: 'team', userId: 'unassigned', source: 'meta',
  pageId: 'page', campaignIds: ['a', 'b'], adSetId: 'adset', adId: 'ad',
  tagIds: ['tag'], dealStatus: 'open',
  activeDateRange: { from: new Date('2026-10-01T03:00:00Z'), to: new Date('2026-10-13T02:59:59.999Z') },
};

test('shared campaigns and the lead period reach conversations with their original meaning', () => {
  const mapped = sharedLeadFiltersForConversations(scope, false);
  assert.deepEqual(mapped.campaignIds, ['a', 'b']);
  assert.equal(mapped.userId, 'unassigned');
  assert.equal(mapped.adSetId, 'adset');
  assert.equal(mapped.leadCreatedFrom, '2026-10-01T03:00:00.000Z');
  assert.equal(mapped.leadCreatedTo, '2026-10-13T02:59:59.999Z');
  assert.equal('lastMessageFrom' in mapped, false);
});

test('the unlinked view pauses lead restrictions and preserves global selections', () => {
  const before = JSON.stringify(scope);
  assert.deepEqual(sharedLeadFiltersForConversations(scope, true), {});
  assert.equal(sharedLeadConversationFilterCount(scope, true), 0);
  assert.equal(sharedLeadConversationFilterCount(scope, false), 11);
  assert.equal(JSON.stringify(scope), before);
  assert.deepEqual(sharedLeadFiltersForConversations(scope, false).campaignIds, ['a', 'b']);
});
