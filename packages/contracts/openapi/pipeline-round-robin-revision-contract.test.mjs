import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const document = yaml.load(readFileSync(new URL('./v1.yaml', import.meta.url), 'utf8'));

test('fallback mutation documents aggregate revision, conflicts, busy queue and no automatic retry', () => {
  const operation = document.paths['/v1/pipelines/{id}/round-robin'].post;
  assert.equal(operation.requestBody.required, true);
  const reference = operation.requestBody.content['application/json'].schema.$ref;
  const schema = reference ? document.components.schemas[reference.split('/').at(-1)] : operation.requestBody.content['application/json'].schema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), ['expectedRevision', 'roundRobinId']);
  assert.equal(schema.properties.expectedRevision.pattern, '^[0-9a-f]{64}$');
  assert.deepEqual(schema.properties.roundRobinId.type, ['string', 'null']);
  for (const status of [400, 403, 404, 409]) assert.ok(operation.responses[status]);
  assert.match(operation.description, /pipeline_changed/); assert.match(operation.description, /round_robin_busy/);
  assert.match(operation.description, /retry/i); assert.match(operation.description, /original|displayed/i);
});
