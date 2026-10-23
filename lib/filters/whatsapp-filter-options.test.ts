import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeWhatsAppFilterOptionPages } from './whatsapp-filter-options';
import { whatsAppConversationListQuerySchema, whatsAppConversationOptionsQuerySchema } from '@/lib/validation/whatsapp-conversation-filters';

test('a catalog remains searchable beyond the former 500-option limit', () => {
  const pages = Array.from({ length: 6 }, (_, page) => ({
    pipelines: [], teams: [], users: [], sources: [], tags: [{ id: 'tag', name: 'VIP', color: '#112233' }], pages: [],
    campaigns: Array.from({ length: 100 }, (_, index) => ({ id: String(page * 100 + index), name: `Campaign ${page * 100 + index}` })),
    hasMore: page < 5, nextOffset: page < 5 ? (page + 1) * 100 : null,
  }));
  const result = mergeWhatsAppFilterOptionPages(pages)!;
  assert.equal(result.campaigns.length, 600);
  assert.equal(result.campaigns[599].id, '599');
  assert.equal(result.tags.length, 1);
  assert.equal(result.tags[0].color, '#112233');
  assert.equal(result.hasMore, false);
});

test('conversation query validation keeps independent temporal criteria and unlinked safety', () => {
  assert.equal(whatsAppConversationListQuerySchema.safeParse({ leadCreatedFrom: '2026-10-12T00:00:00Z', lastMessageFrom: '2026-10-01T00:00:00Z', userId: 'unassigned' }).success, true);
  assert.equal(whatsAppConversationListQuerySchema.safeParse({ withoutLead: true, adSetId: 'set' }).success, false);
  assert.equal(whatsAppConversationListQuerySchema.safeParse({ leadCreatedFrom: '2026-10-13T00:00:00Z', leadCreatedTo: '2026-10-12T00:00:00Z' }).success, false);
  assert.equal(whatsAppConversationOptionsQuerySchema.safeParse({ expandedOptions: true, hideGroups: true, optionsOffset: 500, optionsLimit: 100 }).success, true);
});

test('opaque parent IDs cannot collide when catalog pages are merged', () => {
  const page = { pipelines: [], teams: [], users: [], sources: [], tags: [], pages: [], campaigns: [],
    adSets: [{ id: 'c', name: 'first', campaignId: 'a:b' }, { id: 'b:c', name: 'second', campaignId: 'a' }] };
  assert.equal(mergeWhatsAppFilterOptionPages([page])?.adSets?.length, 2);
  assert.equal(whatsAppConversationListQuerySchema.safeParse({ search: '😀'.repeat(180) }).success, true);
  assert.equal(whatsAppConversationListQuerySchema.safeParse({ search: '😀'.repeat(181) }).success, false);
  assert.equal(whatsAppConversationListQuerySchema.safeParse({ search: 'a\0b' }).success, false);
});
