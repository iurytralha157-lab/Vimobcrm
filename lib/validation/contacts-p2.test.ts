import assert from 'node:assert/strict'
import test from 'node:test'
import { apiContactPageResponseSchema, contactListQuerySchema } from './crm-support'
import { leadCreateInputSchema, leadUpdateInputSchema } from './leads'

const KEY = '11111111-1111-4111-8111-111111111111'
const VERSION = 'a'.repeat(64)

test('página vazia preserva total e versão; resposta incompleta não pode fingir exportação completa', () => {
  assert.equal(apiContactPageResponseSchema.parse({ data: [], total: 51, page: 3, limit: 25, exportVersion: VERSION }).total, 51)
  assert.equal(apiContactPageResponseSchema.safeParse({ data: [], page: 3, limit: 25 }).success, false)
  assert.equal(contactListQuerySchema.safeParse({ mode: 'export', responseMode: 'page', expectedExportVersion: VERSION }).success, true)
  assert.equal(contactListQuerySchema.safeParse({ mode: 'compact', responseMode: 'page', expectedExportVersion: VERSION }).success, false)
  assert.equal(contactListQuerySchema.safeParse({ mode: 'export', expectedExportVersion: VERSION }).success, false)
})

test('revisão é opcional para clientes antigos, mas sozinha não é uma alteração', () => {
  const revision = '2026-10-12T15:30:20.123456Z'
  assert.equal(leadUpdateInputSchema.safeParse({ name: 'Contato sintético' }).success, true)
  assert.equal(leadUpdateInputSchema.parse({ name: 'Contato sintético', expectedUpdatedAt: revision }).expectedUpdatedAt, revision)
  assert.equal(leadUpdateInputSchema.safeParse({ expectedUpdatedAt: revision }).success, false)
  assert.equal(leadUpdateInputSchema.safeParse({ name: 'Contato sintético', expectedUpdatedAt: 'agora' }).success, false)
})

test('chave por linha exige modo de importação e permanece opcional no contrato legado', () => {
  assert.equal(leadCreateInputSchema.safeParse({ name: 'Contato sintético', importMode: true }).success, true)
  assert.equal(leadCreateInputSchema.parse({ name: 'Contato sintético', importMode: true, importRequestKey: KEY }).importRequestKey, KEY)
  assert.equal(leadCreateInputSchema.safeParse({ name: 'Contato sintético', importRequestKey: KEY }).success, false)
  assert.equal(leadCreateInputSchema.safeParse({ name: 'Contato sintético', importMode: true, importRequestKey: 'chave inválida' }).success, false)
})
