import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const document = yaml.load(readFileSync(new URL('./v1.yaml', import.meta.url), 'utf8'));

test('stage reorder exposes opt-in identity preservation and mixed-version fail-closed behavior', () => {
  const request = document.components.schemas.ReorderStagesRequest;
  assert.equal(request.additionalProperties, false);
  assert.deepEqual(request.required, ['stages']);
  assert.equal(request.properties.preserveStageKeys.type, 'boolean');
  assert.match(request.properties.preserveStageKeys.description, /exact stored key/);
  assert.match(request.properties.preserveStageKeys.description, /legacy keys longer than 80/);
  assert.match(request.properties.preserveStageKeys.description, /strict API rejects.*before mutation/);
  assert.match(request.properties.preserveStageKeys.description, /deploy the API before/);
});

test('stage reorder documents bounded aliases and the existing/new revision contract', () => {
  const item = document.components.schemas.ReorderStagesRequest.properties.stages.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ['id', 'name']);
  assert.equal(item.properties.stageKey.maxLength, 80);
  assert.match(item.properties.stageKey.description, /rejected, never truncated/);
  assert.match(item.properties.stageKey.description, /including archived stages/);
  assert.equal(item.properties.isNew.type, 'boolean');
  assert.equal(item.properties.expectedUpdatedAt.format, 'date-time');
  assert.match(item.properties.expectedUpdatedAt.description, /microseconds; required for existing stages and forbidden for new stages/);
});
