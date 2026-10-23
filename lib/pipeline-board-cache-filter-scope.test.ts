import assert from 'node:assert/strict';
import test from 'node:test';
import { getPipelineLeadQueryScopeMatch, patchPipelineLeadInBoard, pipelineLeadMatchesQueryKeyScope } from './pipeline-board-cache';
import { stageWithLeadsQueryKey } from './pipeline-query-key';

const lead = { id: 'lead', stage_id: 'old', assigned_user_id: 'broker', team_id: 'queue-A', deal_status: 'open', name: 'Julia', source: 'meta', created_at: '2026-10-01T12:00:00Z', valor_interesse: 100, tags: [{ id: 'tag-A' }] };
const teamKey = stageWithLeadsQueryKey({ filters: { teamId: 'current-B' } });

test('cache membership matches formatted phone search while preserving normal text and exclusion rules', () => {
  const value = { ...lead, name: 'Júlia Allison', email: 'julia@example.com', phone: '5511900000000' };
  for (const searchQuery of ['+55 (11) 90000-0000', '(11) 90000-0000', '90000-0000', 'julia', 'all', 'example.com']) {
    assert.equal(getPipelineLeadQueryScopeMatch(stageWithLeadsQueryKey({ filters: { searchQuery } }), value), 'match', searchQuery);
  }
  for (const searchQuery of ['+55 (21) 90000-0000', 'lead 5511', 'other']) {
    assert.equal(getPipelineLeadQueryScopeMatch(stageWithLeadsQueryKey({ filters: { searchQuery } }), value), 'mismatch', searchQuery);
  }
  assert.equal(getPipelineLeadQueryScopeMatch(stageWithLeadsQueryKey({ filters: { searchQuery: '+55 (11) 90000-0000', filterDealStatus: 'won' } }), value), 'mismatch');
});

for (const item of [
  { name: 'Åsa', phone: null, query: 'Asa', matches: true },
  { name: 'Černý', phone: null, query: 'Cerny', matches: true },
  { name: 'ΟΣ', phone: null, query: 'ος', matches: true },
  { name: 'ος', phone: null, query: 'ΟΣ', matches: true },
  { name: 'ΟΣ', phone: null, query: 'Σ', matches: false },
  { name: 'Asa', phone: null, query: '\ufeffAsa\ufeff', matches: true },
  { name: 'Asa', phone: null, query: '\u0085Asa\u0085', matches: false },
  { name: 'Contato', phone: '+5511999998888', query: '（１１）９９９９９－８８８８', matches: true },
  { name: 'Contato', phone: '＋５５（１１）９９９９９－８８８８', query: '11999998888', matches: true },
  { name: 'Outro', phone: '+551112349999', query: 'Lote １２３４', matches: false },
  { name: 'Outro', phone: '+55 (11) 12-34-9999', query: '１２３', matches: false },
  { name: 'Ana_100%', phone: null, query: 'Ana_100%', matches: true },
  { name: 'AnaX100Y', phone: null, query: 'Ana_100%', matches: false },
]) {
  test(`cache search scope preserves Unicode membership: ${item.name}/${item.query}`, () => {
    const value = { ...lead, name: item.name, phone: item.phone, email: null };
    const key = stageWithLeadsQueryKey({ filters: { searchQuery: item.query } });
    assert.equal(getPipelineLeadQueryScopeMatch(key, value), item.matches ? 'match' : 'mismatch');
    assert.equal(getPipelineLeadQueryScopeMatch(stageWithLeadsQueryKey({ filters: { searchQuery: item.query, filterDealStatus: 'won' } }), value), 'mismatch');
  });
}

test('assigned team membership is unknown regardless of recorded queue or possible multiple memberships', () => {
  for (const team of ['current-B', 'current-C', 'queue-A']) {
    assert.equal(getPipelineLeadQueryScopeMatch(stageWithLeadsQueryKey({ filters: { teamId: team } }), lead), 'unknown');
  }
  assert.equal(getPipelineLeadQueryScopeMatch(teamKey, { ...lead, assigned_user_id: null }), 'mismatch');
  const unassignedKey = stageWithLeadsQueryKey({ filters: { teamId: 'queue-A', unassigned: true } });
  assert.equal(getPipelineLeadQueryScopeMatch(unassignedKey, { ...lead, assigned_user_id: null }), 'match');
  assert.equal(getPipelineLeadQueryScopeMatch(unassignedKey, { ...lead, assigned_user_id: null, team_id: 'other' }), 'mismatch');
  assert.equal(getPipelineLeadQueryScopeMatch(unassignedKey, lead), 'mismatch');
});

test('unknown historical and legacy attribution is not mistaken for either a match or an exclusion', () => {
  const key = stageWithLeadsQueryKey({ filters: { filterCampaigns: ['A', 'B'], filterAdSet: 'X' } });
  const legacy = { ...lead, meta_campaign_id: 'A', meta_adset_id: 'X', lead_meta: [] };
  const historic = { ...lead, lead_meta: [{ campaign_id: 'C', adset_id: 'X' }] };
  for (const value of [legacy, historic, { ...lead, lead_meta: [{ campaign_id: 'A', adset_id: 'Y' }, { campaign_id: 'C', adset_id: 'X' }] }]) {
    assert.equal(getPipelineLeadQueryScopeMatch(key, value), 'unknown');
    assert.equal(pipelineLeadMatchesQueryKeyScope(key, value), false);
  }
  assert.equal(getPipelineLeadQueryScopeMatch(key, { ...lead, lead_meta: [{ campaign_id: 'B', adset_id: 'X' }] }), 'match');
});

test('known mismatches still exclude a card even when team or historical attribution is unknown', () => {
  const cases = [
    stageWithLeadsQueryKey({ filterUserId: 'other', filters: { teamId: 'current-B' } }),
    ...[{ filterDealStatus: 'won' }, { filterTags: ['tag-B'] }, { searchQuery: 'other' }, { filterSource: 'site' }, { filterUserIds: [] }, { dateRange: { from: new Date('2025-01-01'), to: new Date('2025-12-31') }, dateMode: 'origin' as const }].map(filters => stageWithLeadsQueryKey({ filters: { ...filters, teamId: 'current-B', filterCampaigns: ['historic'] } })),
  ];
  for (const key of cases) assert.equal(getPipelineLeadQueryScopeMatch(key, lead), 'mismatch');
});

test('unknown membership preserves the entire authorized snapshot and never moves or inserts a card', () => {
  const board = [{ id: 'old', leads: [lead], total_lead_count: 4, total_value: 900, has_more: true }, { id: 'new', leads: [], total_lead_count: 0, total_value: 0, has_more: false }];
  const scopeMatch = getPipelineLeadQueryScopeMatch(teamKey, lead);
  assert.strictEqual(patchPipelineLeadInBoard(board, lead.id, { stage_id: 'new', valor_interesse: 500, name: 'changed' }, { scopeMatch, keepInDestination: true }), board);
  const otherBoard = [{ id: 'new', leads: [], total_lead_count: 0, total_value: 0, has_more: false }];
  assert.strictEqual(patchPipelineLeadInBoard(otherBoard, lead.id, lead, { scopeMatch, keepInDestination: true }), otherBoard);
  const excluded = patchPipelineLeadInBoard(board, lead.id, {}, { scopeMatch: 'mismatch', keepInDestination: true });
  assert.equal(excluded?.[0].leads.length, 0);
  assert.equal(excluded?.[0].total_lead_count, 3);
  assert.equal(excluded?.[0].total_value, 800);
});
