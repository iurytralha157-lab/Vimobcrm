import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const document = yaml.load(readFileSync(new URL('./v1.yaml', import.meta.url), 'utf8'));

test('OpenAPI keeps a successful create receipt separate from visible Lead contents', () => {
  const response = document.components.schemas.CreateLeadResponse;
  assert.ok(response.required.includes('leadId'));
  assert.ok(response.required.includes('leadVisible'));
  assert.equal(response.properties.leadId.format, 'uuid');
  assert.equal(response.properties.leadVisible.type, 'boolean');
  assert.deepEqual(response.properties.data.oneOf, [
    { $ref: '#/components/schemas/Lead' },
    { type: 'null' },
  ]);
  assert.match(response.properties.leadVisible.description, /no assignedUserName/);
  assert.match(response.properties.assignedUserName.description, /only when.*readable/);
  assert.match(response.properties.reentry.description, /For importMode, the prior owner is preserved/);
  assert.match(response.properties.reentry.description, /Manual reentries.*may be redistributed/);
  assert.equal(document.paths['/v1/leads'].post.responses['201'].content['application/json'].schema.$ref, '#/components/schemas/CreateLeadResponse');
});
