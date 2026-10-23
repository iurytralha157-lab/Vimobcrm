import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineLead, StageWithLeads } from '@/hooks/use-stages';
import { filterPipelineStages } from './stage-view';

const lead = { id: 'lead-a', stage_id: 'stage-a', name: 'Márcia Silva', phone: '5511999999999', email: 'sintetico@example.invalid' } as PipelineLead;
const stage = { id: 'stage-a', leads: [lead], total_lead_count: 1 } as StageWithLeads;

for (const query of ['+55 (11) 99999-9999', '55 11 99999 9999', '5511999999999', '99999-9999', '551', 'Marcia', 'SINTETICO@EXAMPLE.INVALID']) {
  test(`local and supplemental server results retain the same matching lead for ${query}`, () => {
    const loaded = filterPipelineStages({ stages: [stage], searchQuery: query, deferredSearch: query, serverSearchResults: [lead] });
    const supplemental = filterPipelineStages({ stages: [{ ...stage, leads: [] }], searchQuery: query, deferredSearch: query, serverSearchResults: [lead] });
    assert.deepEqual(loaded[0].leads.map(value => value.id), ['lead-a']);
    assert.deepEqual(supplemental[0].leads.map(value => value.id), ['lead-a']);
    assert.equal(loaded[0].total_lead_count, 1);
  });
}

test('an unrelated query, punctuation without digits, and a stale server result stay hidden', () => {
  for (const query of ['+()', '777777', 'Outro nome', 'Ana99999', '99-9']) {
    assert.equal(filterPipelineStages({ stages: [stage], searchQuery: query, deferredSearch: 'old', serverSearchResults: [lead] })[0].leads.length, 0);
  }
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
  test(`Unicode search keeps loaded and supplemental cards coherent: ${item.name}/${item.query}`, () => {
    const value = { ...lead, name: item.name, phone: item.phone, email: null } as PipelineLead;
    for (const existing of [[value], []]) {
      const result = filterPipelineStages({
        stages: [{ ...stage, leads: existing }],
        searchQuery: item.query,
        deferredSearch: item.query,
        serverSearchResults: [value, { ...value, id: 'outside-stage', stage_id: 'outside' }],
      });
      assert.deepEqual(result[0].leads.map(entry => entry.id), item.matches ? [value.id] : []);
      assert.equal(result[0].total_lead_count, stage.total_lead_count);
    }
  });
}
