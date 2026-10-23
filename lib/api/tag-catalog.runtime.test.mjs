import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyTagResponse as tag, tagCatalogApiFixture as fixture, tagCatalogTestOrganization as org } from './tag-catalog-runtime-fixture.mjs';

const foreign = '50000000-0000-4000-8000-000000000002';
// Exact old Go Tag shape: HEAD support_tags_activities.go has no UpdatedAt.

test('repeated strict management reads reject the old Go DTO at updated_at', async () => {
  const f = fixture();
  for (let retry = 0; retry < 2; retry++) {
    await assert.rejects(f.api.list(org), error => error.code === 'domain_validation_error' && error.issues.includes('data.0.updated_at: Required'));
  }
  assert.equal(f.requests.length, 2); assert.equal(f.management.length, 0);
});

test('actual catalog reads legacy and narrow DTOs without inventing an editing revision', async () => {
  const f = fixture(), controller = new AbortController();
  const intent = { signal: controller.signal, expectedUserId: 'actor-a', expectedSessionId: 'sid-a' };
  const legacy = await f.api.catalog(org, intent);
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), [{ id: tag.id, name: tag.name, color: tag.color, organization_id: org }]);
  assert.equal('updated_at' in legacy[0], false); assert.equal('lead_count' in legacy[0], false);
  assert.equal(f.requests[0].options.query.view, 'catalog');
  assert.equal(f.requests[0].options.signal, controller.signal);
  assert.equal(f.requests[0].options.expectedUserId, 'actor-a'); assert.equal(f.requests[0].options.expectedSessionId, 'sid-a');
  f.setResponse({ data: legacy }); assert.equal((await f.api.catalog(org))[0].id, tag.id);
  assert.equal(f.management.length, 0);
});

test('actual catalog rejects foreign organization, invalid ID and malformed envelope', async () => {
  const f = fixture({ data: [{ ...tag, organization_id: foreign }] });
  await assert.rejects(f.api.catalog(org), /outra organização/);
  f.setResponse({ data: [{ ...tag, id: 'not-a-uuid' }] });
  await assert.rejects(f.api.catalog(org), error => error.code === 'domain_validation_error');
  f.setResponse({ data: null }); await assert.rejects(f.api.catalog(org), error => error.code === 'domain_validation_error');
  f.setResponse({ data: [] }); assert.equal((await f.api.catalog(org)).length, 0);
});

test('picker DTO cannot bypass management CAS input or full response validation', async () => {
  const f = fixture();
  await assert.rejects(f.api.update(tag.id, { name: tag.name, color: tag.color }, org), error => error.code === 'domain_validation_error' && error.direction === 'input');
  assert.equal(f.management.length, 0);
  await assert.rejects(f.api.update(tag.id, { name: tag.name, color: tag.color, expected_updated_at: tag.created_at }, org), error => error.code === 'domain_validation_error' && error.direction === 'response');
  assert.equal(f.management.length, 1);
  f.setResponse({ data: { ...tag, updated_at: tag.created_at } });
  const updated = await f.api.update(tag.id, { name: tag.name, color: tag.color, expected_updated_at: tag.created_at }, org);
  assert.equal(updated.updated_at, tag.created_at); assert.equal(f.management[1].options.body.expected_updated_at, tag.created_at);
});
