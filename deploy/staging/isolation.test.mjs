import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const load = (filename) => yaml.load(readFileSync(new URL(filename, import.meta.url), 'utf8'));
const networks = (service) => Array.isArray(service.networks)
  ? Object.fromEntries(service.networks.map((name) => [name, {}]))
  : service.networks;

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
