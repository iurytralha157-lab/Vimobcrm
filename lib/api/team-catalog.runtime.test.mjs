import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyTeamResponse as team, teamCatalogApiFixture as fixture, teamCatalogOrganization as org } from './team-catalog-runtime-fixture.mjs';

test('team filter catalog accepts legacy and current DTOs without exposing revision or member management fields', async () => {
  for (const dto of [team, { ...team, revision: 4 }]) {
    const f = fixture({ data: [dto] }), signal = new AbortController().signal;
    const data = await f.api.catalog(org, { signal, expectedUserId: 'actor-a', expectedSessionId: 'sid-a' });
    assert.deepEqual(JSON.parse(JSON.stringify(data)), [{ id: team.id, name: team.name, organization_id: org,
      is_active: true, members: [{ user_id: team.members[0].user_id, is_leader: true }] }]);
    assert.equal('revision' in data[0], false); assert.equal('email' in data[0].members[0], false);
    assert.equal(f.requests[0].path, '/v1/teams'); assert.equal(f.requests[0].options.query.includeInactive, false);
    assert.equal(f.requests[0].options.signal, signal); assert.equal(f.requests[0].options.expectedUserId, 'actor-a');
    assert.equal(f.requests[0].options.expectedSessionId, 'sid-a'); assert.equal(f.requests[0].options.retry, false);
    assert.equal(f.management.length, 0);
  }
});

test('team catalog rejects wrong organization, invalid roster IDs and malformed responses', async () => {
  const f = fixture({ data: [{ ...team, organization_id: '50000000-0000-4000-8000-000000000002' }] });
  await assert.rejects(f.api.catalog(org), /outra organização/);
  f.setResponse({ data: [{ ...team, members: [{ user_id: 'invalid-id' }] }] });
  await assert.rejects(f.api.catalog(org), error => error.code === 'domain_validation_error');
  f.setResponse({ data: null }); await assert.rejects(f.api.catalog(org), error => error.code === 'domain_validation_error');
  f.setResponse({ data: [] }); assert.equal((await f.api.catalog(org)).length, 0);
});

test('management list and writes keep mandatory revision and never accept the catalog as a write DTO', async () => {
  const f = fixture();
  await assert.rejects(f.api.listTeams({ organizationId: org }), error => error.issues.includes('data.0.revision: Required'));
  await assert.rejects(f.api.updateTeam({ id: team.id, name: 'Nome' }, org), error => error.direction === 'input');
  assert.equal(f.management.length, 0);
  await assert.rejects(f.api.updateTeam({ id: team.id, name: 'Nome', expected_revision: 1 }, org), error => error.direction === 'response');
  f.setResponse({ data: { ...team, revision: 2 } });
  const updated = await f.api.updateTeam({ id: team.id, name: 'Nome', expected_revision: 1 }, org);
  assert.equal(updated.revision, 2); assert.equal(f.management[1].options.body.expected_revision, 1);
});
