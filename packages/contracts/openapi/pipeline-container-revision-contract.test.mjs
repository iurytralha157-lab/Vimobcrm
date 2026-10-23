import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const document = yaml.load(readFileSync(new URL('./v1.yaml', import.meta.url), 'utf8'));

test('pipeline PATCH and DELETE require original revisions and document review after conflict', () => {
  const path = document.paths['/v1/pipelines/{id}'];
  for (const [verb, name] of [['patch', 'UpdatePipelineRequest'], ['delete', 'DeletePipelineRequest']]) {
    const operation = path[verb];
    assert.equal(operation.requestBody.required, true);
    assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${name}`);
    for (const status of [400, 403, 404, 409]) assert.ok(operation.responses[status]);
    assert.match(operation.description, /pipeline_changed \(409\)/);
    assert.match(operation.description, /original|captured when opening/);
    assert.match(operation.description, /retry/);
    const schema = document.components.schemas[name];
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['expectedRevision']);
    assert.equal(schema.properties.expectedRevision.pattern, '^[0-9a-f]{64}$');
  }
});

test('pipeline response returns its aggregate revision and edits require a changed field', () => {
  const schemas = document.components.schemas;
  assert.ok(schemas.Pipeline.required.includes('revision'));
  assert.equal(schemas.Pipeline.properties.revision.pattern, '^[0-9a-f]{64}$');
  assert.match(schemas.Pipeline.properties.revision.description, /complete stage structure/);
  assert.equal(schemas.UpdatePipelineRequest.minProperties, 2);
  assert.deepEqual(schemas.UpdatePipelineRequest.anyOf, [{ required: ['name'] }, { required: ['isDefault'] }]);
  assert.equal(schemas.CreatePipelineRequest.required.includes('expectedRevision'), false);
});
