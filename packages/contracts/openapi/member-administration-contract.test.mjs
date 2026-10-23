import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import yaml from 'js-yaml';

const document = yaml.load(readFileSync('packages/contracts/openapi/v1.yaml', 'utf8'));
const routes = readFileSync('apps/api/internal/app/routes.go', 'utf8');

test('member administration router operations are documented', () => {
  const operations = [...routes.matchAll(
    /mux\.Handle(?:Func)?\("(GET|POST|PUT|PATCH|DELETE) (\/v1\/(?:me\/account-status|user-organizations|users(?:\/[^\"]*)?|settings\/(?:roles|permissions|users|user-roles|has-permission)(?:\/[^\"]*)?))"/g,
  )];
  assert.equal(operations.length, 20);
  for (const [, method, path] of operations) {
    assert.ok(document.paths[path]?.[method.toLowerCase()], `${method} ${path} is missing from OpenAPI`);
  }
});

test('member removal advertises all seven impact counts', () => {
  const impact = document.components.schemas.DeleteMemberImpact;
  assert.deepEqual(impact.required, [
    'leads',
    'properties',
    'whatsapp_sessions',
    'teams',
    'custom_roles',
    'permission_overrides',
    'round_robin_entries',
  ]);
  assert.equal(
    document.paths['/v1/users/{id}/delete-impact'].get.responses['200'].content['application/json'].schema.properties.data.$ref,
    '#/components/schemas/DeleteMemberImpact',
  );
  const removalConflict = document.paths['/v1/users/{id}'].delete.responses['409'];
  assert.match(removalConflict.description, /user_team_membership_changed/);
  assert.equal(
    removalConflict.content['application/json'].schema.$ref,
    '#/components/schemas/APIErrorEnvelope',
  );
});

test('account status is documented without a tenant header', () => {
  const status = document.paths['/v1/me/account-status'].get;
  assert.equal(status.parameters, undefined);
  assert.deepEqual(document.components.schemas.AccountStatus.required, [
    'profileExists',
    'globallyActive',
    'isSuperAdmin',
  ]);
  for (const route of [
    'GET /v1/me/account-status',
    'GET /v1/user-organizations',
  ]) {
    assert.match(routes, new RegExp(`mux\\.Handle\\("${route}", withActiveAuth\\(`));
  }
});
