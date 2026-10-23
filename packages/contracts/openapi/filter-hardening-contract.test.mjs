import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const document = yaml.load(readFileSync(new URL('./v1.yaml', import.meta.url), 'utf8'));
const parameter = (path, name) => document.paths[path].get.parameters.find((entry) => entry.name === name);

test('contact and pipeline contracts preserve repeated campaign values and bounds', () => {
  assert.equal(parameter('/v1/contacts', 'search').schema.maxLength, 180);
  assert.equal(parameter('/v1/contacts', 'source').schema.maxLength, 4096);
  assert.equal(parameter('/v1/contacts', 'campaignIds').explode, true);
  assert.equal(parameter('/v1/contacts', 'campaignIds').schema.maxItems, 50);
  for (const path of ['/v1/pipeline-board', '/v1/pipeline-stage-leads', '/v1/pipeline-stage-counts']) {
    assert.equal(parameter(path, 'filterSource').schema.maxLength, 4096);
    assert.equal(parameter(path, 'filterCampaigns').schema.type, 'array');
    assert.equal(parameter(path, 'filterCampaigns').explode, true);
  }
  assert.equal(document.components.parameters.AnalyticsUserId.schema.oneOf[1].const, 'unassigned');
});

test('WhatsApp contract separates lead creation and last message periods and keeps opt in options', () => {
  const path = '/v1/whatsapp/conversations';
  for (const name of ['leadCreatedFrom', 'leadCreatedTo', 'lastMessageFrom', 'lastMessageTo']) {
    assert.equal(parameter(path, name).schema.format, 'date-time');
  }
  assert.equal(parameter(path, 'search').schema.maxLength, 180);
  assert.equal(parameter('/v1/whatsapp/conversations/filter-options', 'expandedOptions').schema.default, false);
  const options = document.components.schemas.WhatsAppConversationFilterOptionsResponse.properties.data;
  assert.equal(options.required.includes('adSets'), false);
  assert.deepEqual(options.properties.ads.items.allOf[1].required, ['campaignId', 'adsetId']);
});

test('locality identity and automation filters are represented in the contract', () => {
  for (const path of ['/v1/properties', '/v1/properties/stats']) {
    assert.equal(parameter(path, 'city_id').schema.format, 'uuid');
    assert.equal(parameter(path, 'neighborhood_id').schema.format, 'uuid');
  }
  assert.equal(parameter('/v1/automation-media', 'limit').schema.maximum, 100);
  assert.equal(parameter('/v1/automation-media', 'search').schema.maxLength, 120);
  assert.equal(parameter('/v1/automation-executions', 'status').schema.enum.includes('waiting'), true);
});

test('notifications filter before cursor pagination and admin keeps both response shapes', () => {
  assert.equal(parameter('/v1/notifications', 'unreadOnly').schema.type, 'boolean');
  assert.equal(parameter('/v1/notifications', 'categories').explode, true);
  assert.deepEqual(parameter('/v1/notifications', 'categories').schema.items.enum, ['leads', 'whatsapp', 'tasks', 'system']);
  assert.equal(parameter('/v1/admin/tables/{table}', 'search').schema.maxLength, 180);
  assert.equal(parameter('/v1/admin/tables/{table}', 'offset').schema.maximum, 1000000);
  assert.equal(parameter('/v1/admin/tables/{table}', 'limit').schema.maximum, 200);
  const schemas = document.components.schemas;
  assert.equal(schemas.AdminTableLegacyResponse.additionalProperties, false);
  assert.deepEqual(schemas.AdminTableLegacyResponse.required, ['data']);
  assert.deepEqual(schemas.AdminTablePageResponse.required, ['data', 'meta']);
  assert.deepEqual(schemas.AdminTablePageResponse.properties.meta.properties.nextOffset.type, ['integer', 'null']);
  assert.equal(schemas.AdminTablePageResponse.properties.meta.properties.hasMore, undefined);
});
