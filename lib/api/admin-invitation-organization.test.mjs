import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import ts from 'typescript'

const ORGANIZATION_A = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_B = '10000000-0000-4000-8000-000000000002'

function loadAdminAPI() {
  const requests = []
  const source = readFileSync(new URL('./admin.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: 'admin.ts',
  }).outputText
  const moduleRecord = { exports: {} }

  vm.runInNewContext(compiled, {
    exports: moduleRecord.exports,
    module: moduleRecord,
    require: (specifier) => {
      if (specifier === '@/lib/validation') {
        return {
          parseDomainInput: (_schema, value) => value,
          validateDomainResponse: () => {},
        }
      }
      if (specifier === './vimob-client') {
        return {
          vimobAPIRequest: async (path, options) => {
            requests.push({ path, options })
            return { data: { id: 'invitation-id' } }
          },
        }
      }
      throw new Error(`Unexpected import: ${specifier}`)
    },
  }, { filename: 'admin.js' })

  return { adminAPI: moduleRecord.exports.adminAPI, requests }
}

test('convite sem organização própria envia a organização alvo no contexto da API', async () => {
  const { adminAPI, requests } = loadAdminAPI()
  await adminAPI.createInvitation({
    email: 'convidado@vimob.test',
    role: 'user',
    organizationId: ORGANIZATION_B,
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/v1/invitations')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.organizationId, ORGANIZATION_B)
  assert.equal(requests[0].options.body.organizationId, ORGANIZATION_B)
})

test('convite rejeita organizações diferentes no contexto e no corpo', async () => {
  const { adminAPI, requests } = loadAdminAPI()
  await assert.rejects(
    adminAPI.createInvitation({
      email: 'convidado@vimob.test',
      role: 'user',
      organizationId: ORGANIZATION_B,
    }, ORGANIZATION_A),
    /organização do convite difere/,
  )
  assert.equal(requests.length, 0)
})

test('convite legado sem organização no corpo preserva o contexto explícito', async () => {
  const { adminAPI, requests } = loadAdminAPI()
  await adminAPI.createInvitation({ email: 'convidado@vimob.test', role: 'user' }, ORGANIZATION_A)

  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.organizationId, ORGANIZATION_A)
  assert.equal(requests[0].options.body.organizationId, undefined)
})
