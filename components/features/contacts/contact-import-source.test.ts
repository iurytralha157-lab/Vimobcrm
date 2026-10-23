import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveContactImportSource } from './contact-import-source';
import { normalizeContactImportRows } from './contact-import-columns';

test('CSV and default sources share canonical aliases and preserve custom names', () => {
  for (const [input, expected] of [['Meta Ads', 'meta'], ['Importação', 'import'], ['GOOGLE ADS', 'google_ads'], [' Portal personalizado ', 'Portal personalizado']]) {
    const result = resolveContactImportSource(input);
    assert.equal(result.success && result.value, expected);
    assert.equal(normalizeContactImportRows([{ rowNumber: 2, values: { Nome: 'Ana', Origem: input } }])[0].fonte, expected);
  }
});

test('filter and picker control names cannot become import sources', () => {
  for (const value of ['all', '__all__', 'none', '__none__', 'null', 'undefined', 'custom', '__create_lead_source__', ' ALL ', '', 'x'.repeat(121)]) {
    assert.equal(resolveContactImportSource(value).success, false, value);
  }
  for (const value of ['automatic', 'any', 'Campanha local']) assert.equal(resolveContactImportSource(value).success, true, value);
});
