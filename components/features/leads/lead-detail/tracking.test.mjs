import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCampaignTrackingDetails,
  getLeadSourceLabel,
  hasLeadTrackingData,
  safeExternalUrl,
} from './tracking.ts';

test('mantém a precedência do registro canônico sobre metadados do quadro', () => {
  const details = buildCampaignTrackingDetails(
    {
      lead_id: 'lead-1',
      campaign_name: 'Campanha canônica',
      campaign_id: 'campaign-1',
      raw_payload: { lead_details: { page_name: 'Página de origem' } },
    },
    {
      id: 'lead-1',
      source: 'meta_ads',
      lead_meta: [{ campaign_name: 'Campanha do quadro', platform: 'facebook' }],
    },
  );

  assert.equal(details?.campaign_name, 'Campanha canônica');
  assert.equal(details?.page_name, 'Página de origem');
  assert.equal(details?.platform, 'facebook');
  assert.equal(hasLeadTrackingData(details), true);
});

test('aceita somente links relativos locais, HTTP ou HTTPS', () => {
  assert.equal(safeExternalUrl('/criativos/1'), '/criativos/1');
  assert.equal(safeExternalUrl('//evil.example/path'), null);
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('https://example.com/creative'), 'https://example.com/creative');
});

test('preserva o rótulo exato de origem usado no detalhe', () => {
  assert.equal(getLeadSourceLabel('meta_ads'), 'Meta Ads');
  assert.equal(getLeadSourceLabel('Parceiro XPTO'), 'Parceiro XPTO');
});
