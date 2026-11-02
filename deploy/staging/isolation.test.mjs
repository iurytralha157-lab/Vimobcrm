import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const load = (filename) => yaml.load(readFileSync(new URL(filename, import.meta.url), 'utf8'));
const networks = (service) => Array.isArray(service.networks)
  ? Object.fromEntries(service.networks.map((name) => [name, {}]))
  : service.networks;

function assertSafeRequiredInterpolation(model) {
  // docker/cli#7313: Swarm can treat a hyphen in a required-value message
  // as a default operator, replacing even a configured value with its suffix.
  const visit = (value) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\$\{[A-Za-z_][A-Za-z0-9_]*:\?([^{}]*)\}/g)) {
        assert.ok(!match[1].includes('-'), 'Required interpolation messages must not contain hyphens (docker/cli#7313).');
      }
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  };
  for (const service of ['web', 'api']) {
    assert.match(model.services[service].environment.SUPABASE_SECRET_KEY,
      /^\$\{STAGING_SUPABASE_SECRET_KEY:\?[^{}]+\}$/,
      `${service} must retain the required server secret guard, without a fallback.`);
  }
  visit(model);
}

function assertPrivateApiRoute(model) {
  const web = model.services.web;
  const api = model.services.api;
  const target = new URL(web.environment.VIMOB_API_URL);
  assert.equal(target.protocol, 'http:');
  assert.equal(target.port, '8081');
  assert.equal(target.hostname, 'vimob-staging-api', 'The web must not resolve the generic api alias.');
  const webNetworks = networks(web);
  const apiNetworks = networks(api);
  const sharedPrivateNetwork = Object.entries(apiNetworks).find(([name, settings]) =>
    !model.networks[name].external &&
    !model.networks[name].name &&
    Object.hasOwn(webNetworks, name) &&
    settings.aliases?.includes(target.hostname));
  assert.ok(sharedPrivateNetwork, 'The API alias must be available on a stack-scoped private network.');
  for (const [name, settings] of Object.entries(apiNetworks)) {
    if (model.networks[name].external) {
      assert.ok(!settings.aliases?.includes(target.hostname), 'The private API alias must not be advertised on the proxy network.');
    }
  }
}

test('Swarm and Compose web requests use only the isolated private API alias', () => {
  assertPrivateApiRoute(load('portainer-stack.yml'));
  assertPrivateApiRoute(load('compose.yml'));
});

test('a generic API alias on the shared proxy cannot pass the isolation contract', () => {
  const model = load('portainer-stack.yml');
  model.services.web.environment.VIMOB_API_URL = 'http://api:8081';
  assert.throws(() => assertPrivateApiRoute(model), /generic api alias/);
});

test('removing the private alias or publishing it on the proxy fails closed', () => {
  const missing = load('portainer-stack.yml');
  delete missing.services.api.networks['staging-internal'].aliases;
  assert.throws(() => assertPrivateApiRoute(missing), /stack-scoped private network/);
  const exposed = load('portainer-stack.yml');
  exposed.services.api.networks['staging-proxy'].aliases = ['vimob-staging-api'];
  assert.throws(() => assertPrivateApiRoute(exposed), /must not be advertised/);
});

test('Swarm and Compose retain required server secrets with Swarm-safe diagnostic messages', () => {
  for (const filename of ['portainer-stack.yml', 'compose.yml']) {
    assertSafeRequiredInterpolation(load(filename));
  }
});

test('the original server-only message cannot regress into a Swarm literal secret', () => {
  const model = load('portainer-stack.yml');
  model.services.api.environment.SUPABASE_SECRET_KEY = '${STAGING_SUPABASE_SECRET_KEY:?Set the staging server-only Supabase key}';
  assert.throws(() => assertSafeRequiredInterpolation(model), /must not contain hyphens/);
});

test('removing the required secret guard or adding a fallback fails closed', () => {
  for (const expression of ['${STAGING_SUPABASE_SECRET_KEY}', '${STAGING_SUPABASE_SECRET_KEY:-fallback}']) {
    const model = load('portainer-stack.yml');
    model.services.web.environment.SUPABASE_SECRET_KEY = expression;
    assert.throws(() => assertSafeRequiredInterpolation(model), /required server secret guard/);
  }
});
