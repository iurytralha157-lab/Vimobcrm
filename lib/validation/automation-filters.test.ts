import assert from 'node:assert/strict'
import test from 'node:test'
import { automationExecutionListQuerySchema, automationMediaListQuerySchema } from './automation-filters'

test('execution search supports server status, civil-day boundaries as instants and pagination', () => {
  assert.equal(automationExecutionListQuerySchema.safeParse({status:'failed',offset:200,limit:100,dateFrom:'2026-10-01T00:00:00-03:00',dateTo:'2026-10-01T23:59:59-03:00'}).success,true)
  for (const query of [{status:'unknown'}, {offset:-1}, {limit:201}, {dateFrom:'2026-10-02T00:00:00Z',dateTo:'2026-10-01T00:00:00Z'}, {dateFrom:'wrong'}]) {
    assert.equal(automationExecutionListQuerySchema.safeParse(query).success,false)
  }
})
test('media search stays within a typed media family and bounded remote pages', () => {
  assert.deepEqual(automationMediaListQuerySchema.parse({mediaType:'image',search:' campanha ',limit:50,offset:100}),{mediaType:'image',search:'campanha',limit:50,offset:100})
  for (const query of [{mediaType:'document'}, {mediaType:'image',search:'a'.repeat(121)}, {mediaType:'image',offset:10001}]) {
    assert.equal(automationMediaListQuerySchema.safeParse(query).success,false)
  }
})
