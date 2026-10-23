import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const document = yaml.load(readFileSync('packages/contracts/openapi/v1.yaml', 'utf8'));

for (const [path, schemaName, field, conflict] of [
  ['/v1/stages/{id}', 'DeleteStageRequest', 'expectedUpdatedAt', 'pipeline_stages_changed'],
  ['/v1/stage-automations/{id}', 'DeleteStageAutomationRequest', 'expected_updated_at', 'stage_automation_changed'],
]) {
  test(`${path} deletion requires the original confirmation revision without implicit retries`, () => {
    const operation = document.paths[path].delete;
    assert.equal(operation.requestBody.required, true);
    assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${schemaName}`);
    const schema = document.components.schemas[schemaName];
    assert.deepEqual(schema.required, [field]);
    assert.deepEqual(Object.keys(schema.properties), [field]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties[field].format, 'date-time');
    assert.match(schema.properties[field].description, /original confirmation snapshot/);
    assert.match(schema.properties[field].description, /fractional precision/);
    assert.match(operation.description, new RegExp(conflict));
    assert.match(operation.description, /Do not retry or rebase automatically/);
    assert.equal(operation.parameters[0].$ref, '#/components/parameters/OrganizationIdHeader');
    for (const status of ['204', '400', '403', '404', '409']) assert.ok(operation.responses[status]);
  });
}
