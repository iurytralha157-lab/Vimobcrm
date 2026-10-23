import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedFilterSnapshotSchema } from './shared-filter-presets';
import { contactListQuerySchema } from './crm-support';
import { campaignInsightsQuerySchema } from './marketing';
import { whatsAppConversationListQuerySchema } from './whatsapp-conversation-filters';
import { dashboardFiltersSchema } from './final-domains';
import { MAX_LEAD_SOURCE_FILTER_LENGTH } from './filter-text';
import { buildPipelineBoardQuery } from '@/lib/pipeline-board-query';

const acceptsSource = (source: string) => ({
  snapshot: sharedFilterSnapshotSchema.safeParse({ version: 2, source }),
  contacts: contactListQuerySchema.safeParse({ source }),
  dashboard: dashboardFiltersSchema.safeParse({ source }),
  marketing: campaignInsightsQuerySchema.safeParse({ dateFrom: '2026-10-01', dateTo: '2026-10-12', source }),
  whatsapp: whatsAppConversationListQuerySchema.safeParse({ leadSource: source }),
});

test('a persisted legacy source remains usable across every shared lead surface', () => {
  for (const source of ['x'.repeat(121), 'Histórico São Paulo '.repeat(40).trim(), '🏠'.repeat(MAX_LEAD_SOURCE_FILTER_LENGTH)]) {
    const parsed = acceptsSource(source);
    for (const [consumer, result] of Object.entries(parsed)) assert.equal(result.success, true, consumer);
    assert.equal(parsed.snapshot.success && parsed.snapshot.data.source, source);
    assert.equal(parsed.contacts.success && parsed.contacts.data.source, source);
    assert.equal(parsed.marketing.success && parsed.marketing.data.source, source);
    assert.equal(parsed.whatsapp.success && parsed.whatsapp.data.leadSource, source);
    assert.equal(buildPipelineBoardQuery({ filters: { filterSource: source } }).filterSource, source);
  }
});

test('all shared source contracts reject the same over-limit or NUL values', () => {
  for (const source of ['🏠'.repeat(MAX_LEAD_SOURCE_FILTER_LENGTH + 1), 'legado\0origem']) {
    for (const [consumer, result] of Object.entries(acceptsSource(source))) assert.equal(result.success, false, consumer);
  }
});
