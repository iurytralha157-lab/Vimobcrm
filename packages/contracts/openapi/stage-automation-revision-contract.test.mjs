import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import yaml from 'js-yaml'

const document = yaml.load(readFileSync('packages/contracts/openapi/v1.yaml', 'utf8'))

test('column automation edit and status require original revisions and expose conflicts', () => {
  for (const [path, name] of [
    ['/v1/stage-automations/{id}', 'UpdateStageAutomationRequest'],
    ['/v1/stage-automations/{id}/status', 'StageAutomationStatusRequest'],
  ]) {
    const operation = document.paths[path].patch
    assert.equal(operation.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${name}`)
    const schema = document.components.schemas[name]
    assert.ok(schema.required.includes('expected_updated_at'))
    assert.equal(schema.additionalProperties, false)
    assert.equal(schema.properties.expected_updated_at.format, 'date-time')
    assert.match(schema.properties.expected_updated_at.description, /fractional precision/)
    assert.match(operation.description, /stage_automation_changed/)
    assert.match(operation.description, /do not retry/i)
    assert.ok(operation.responses['400'])
    assert.ok(operation.responses['403'])
    assert.ok(operation.responses['404'])
    assert.match(operation.responses['409'].description, /stage_automation_changed/)
    const conflictRef = operation.responses['409'].content['application/json'].schema.$ref
    assert.ok(document.components.schemas[conflictRef.split('/').at(-1)])
    assert.equal(operation.parameters[0].$ref, '#/components/parameters/OrganizationIdHeader')
  }
  assert.equal(document.components.schemas.UpdateStageAutomationRequest.minProperties, 2)
  assert.deepEqual(document.components.schemas.StageAutomationStatusRequest.required, ['is_active', 'expected_updated_at'])
})

test('successful automation mutations return the exact reusable canonical revision', () => {
  const schema = document.components.schemas.StageAutomationEnvelope.properties.data
  assert.ok(schema.required.includes('updated_at'))
  assert.equal(schema.properties.updated_at.format, 'date-time')
  assert.match(schema.properties.updated_at.description, /microseconds/)
  assert.match(document.paths['/v1/stage-automations/{id}'].patch.description, /Creation.*separate POST without a revision/)
  assert.match(document.paths['/v1/stage-automations/{id}/status'].patch.description, /Inactivity.*dedicated endpoint/)
})
