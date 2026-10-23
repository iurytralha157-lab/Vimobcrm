import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import yaml from 'js-yaml';

const document = yaml.load(readFileSync('packages/contracts/openapi/v1.yaml', 'utf8'));
const routes = readFileSync('apps/api/internal/app/routes.go', 'utf8');
const usersRepository = readFileSync('apps/api/internal/users/repository.go', 'utf8');
const adminRepository = readFileSync('apps/api/internal/admin/repository.go', 'utf8');

const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const identityPath = (path) =>
  /^\/v1\/(?:me(?:\/[^/]+)?|user-organizations|users(?:\/.*)?|invitations(?:\/.*)?|public\/invitations(?:\/.*)?|settings\/(?:password(?:\/status)?|roles(?:\/.*)?|permissions|users\/\{id\}\/permissions|user-roles|has-permission)|admin\/(?:organizations(?:\/\{id\}(?:\/(?:modules|payments|access))?)?|users(?:\/\{id\}(?:\/reset-password)?)?))$/.test(path);

const routerOperations = [...routes.matchAll(/mux\.Handle(?:Func)?\("(GET|POST|PUT|PATCH|DELETE) (\/v1\/[^\"]+)"/g)]
  .map(([, method, path]) => `${method} ${path}`)
  .filter((operation) => identityPath(operation.split(' ')[1]))
  .sort();

const contractOperations = Object.entries(document.paths)
  .filter(([path]) => identityPath(path))
  .flatMap(([path, item]) => Object.keys(item)
    .filter((method) => methods.has(method))
    .map((method) => `${method.toUpperCase()} ${path}`))
  .sort();

test('identity, membership, RBAC, invitation and core SuperAdmin routes match the router', () => {
  assert.deepEqual(contractOperations, routerOperations);
  assert.equal(routerOperations.filter((route) => route.startsWith('GET /v1/admin/organizations') || route.startsWith('POST /v1/admin/organizations') || route.startsWith('PATCH /v1/admin/organizations') || route.startsWith('DELETE /v1/admin/organizations') || route.startsWith('GET /v1/admin/users') || route.startsWith('POST /v1/admin/users') || route.startsWith('PATCH /v1/admin/users') || route.startsWith('DELETE /v1/admin/users')).length, 11);
  for (const required of [
    'GET /v1/me/account-status',
    'GET /v1/user-organizations',
    'GET /v1/settings/password/status',
    'POST /v1/settings/password',
    'POST /v1/users',
    'POST /v1/invitations',
    'POST /v1/admin/users/{id}/reset-password',
  ]) {
    assert.ok(routerOperations.includes(required), `${required} is a required identity operation`);
  }
});

test('all referenced schemas in identity operations resolve', () => {
  const visited = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      assert.match(node.$ref, /^#\//);
      const target = node.$ref.slice(2).split('/').reduce((value, part) => value?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], document);
      assert.ok(target, `unresolved ${node.$ref}`);
      if (!visited.has(node.$ref)) {
        visited.add(node.$ref);
        walk(target);
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const operationKey of contractOperations) {
    const [method, path] = operationKey.split(' ');
    walk(document.paths[path][method.toLowerCase()]);
  }
});

test('legacy direct member creation cannot be mistaken for a successful API operation', () => {
  const operation = document.paths['/v1/users'].post;
  assert.deepEqual(Object.keys(operation.responses).filter((code) => /^2\d\d$/.test(code)), []);
  assert.ok(operation.responses['409']);
  assert.match(operation.description, /invitation_required/);
  assert.match(usersRepository, /func \(repo Repository\) CreateOrganizationUser\([\s\S]*?return CreateUserResult\{\}, ErrInvitationRequired/);
  assert.ok(document.paths['/v1/invitations'].post.responses['201']);
});

test('success responses expose a body schema except the documented 204', () => {
  for (const operationKey of contractOperations) {
    const [method, path] = operationKey.split(' ');
    const operation = document.paths[path][method.toLowerCase()];
    for (const [status, response] of Object.entries(operation.responses)) {
      if (!/^2\d\d$/.test(status) || status === '204') continue;
      assert.ok(response.content?.['application/json']?.schema, `${operationKey} ${status} lacks a JSON schema`);
    }
  }
});

test('protected identity routes retain bearer authentication and tenant boundaries', () => {
  assert.deepEqual(document.security, [{ bearerAuth: [] }]);
  for (const operationKey of contractOperations) {
    const [method, path] = operationKey.split(' ');
    const operation = document.paths[path][method.toLowerCase()];
    if (path.startsWith('/v1/public/invitations/')) {
      assert.deepEqual(operation.security, [], `${operationKey} must be a public capability route`);
    } else {
      assert.notDeepEqual(operation.security, [], `${operationKey} must require bearer authentication`);
    }
  }
  for (const path of ['/v1/users', '/v1/users/{id}', '/v1/settings/roles', '/v1/settings/users/{id}/permissions', '/v1/invitations']) {
    const pathItem = document.paths[path];
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      assert.ok(operation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/OrganizationIdHeader'), `${method.toUpperCase()} ${path} needs tenant selection`);
    }
  }
  for (const path of ['/v1/me/account-status', '/v1/user-organizations', '/v1/admin/users', '/v1/admin/organizations']) {
    for (const operation of Object.values(document.paths[path])) {
      assert.ok(!operation.parameters?.some((parameter) => parameter.$ref === '#/components/parameters/OrganizationIdHeader'), `${path} must be available without a tenant header`);
    }
  }
});

test('password status and SuperAdmin recovery contract distinguish request acceptance from change and delivery', () => {
  assert.equal(document.paths['/v1/settings/password/status'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/PasswordStatusEnvelope');
  const recovery = document.paths['/v1/admin/users/{id}/reset-password'].post;
  assert.match(recovery.description, /does not\s+prove delivery or that the user changed the password/);
  const receipt = document.components.schemas.AdminPasswordRecoveryRequestEnvelope.properties.data;
  assert.ok(receipt.required.includes('request_accepted'));
  assert.equal(receipt.properties.request_accepted.const, true);
  assert.equal(receipt.properties.delivery_status.const, 'unverified');
  assert.equal(receipt.properties.email_sent.deprecated, true);
  assert.match(adminRepository, /"request_accepted": true/);
  assert.match(adminRepository, /"delivery_status":\s+"unverified"/);
});

test('permission introspection validates its key under an active session', () => {
  const operation = document.paths['/v1/settings/has-permission'].get;
  assert.equal(operation.parameters.find((parameter) => parameter.name === 'permissionKey').required, true);
  assert.ok(operation.responses['400']);
  assert.match(routes, /mux\.Handle\("GET \/v1\/settings\/has-permission", withActiveAuthTenant\(/);
});

test('access replacement requires explicit fields so omission cannot clear grants', () => {
  const access = document.paths['/v1/admin/organizations/{id}/access'].post.requestBody.content['application/json'].schema;
  assert.deepEqual(access.required, ['organizationUpdates', 'modules']);
  assert.equal(access.properties.modules.type, 'array');
  const grants = document.paths['/v1/settings/roles/{id}/permissions'].put.requestBody.content['application/json'].schema;
  assert.deepEqual(grants.required, ['permissions']);
  assert.equal(grants.properties.permissions.type, 'array');
});
