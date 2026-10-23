import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function runtime() {
  const source = readFileSync(new URL('./use-lead-attachments.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const calls = []; const cleanups = []; const refs = []; let cursor = 0; const compiledModule = { exports: {} }
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'user-a' }, session: { sessionId: 'session-a' } }
  const require = name => {
    if (name === 'react') return { useRef: current => { const slot = cursor++; return refs[slot] ??= { current } }, useEffect: setup => cleanups.push(setup()) }
    if (name === '@tanstack/react-query') return { useMutation: options => options, useQuery: options => options, useQueryClient: () => ({}) }
    if (name === '@/contexts/AuthContext') return { useAuth: () => auth }
    if (name === '@/lib/auth/global-sign-out') return { getGlobalSignOutSessionId: session => session?.sessionId || null }
    if (name === '@/lib/client-action-rate-limit') return { enforceClientActionRateLimit: () => {}, getClientRateLimitMessage: () => null }
    if (name === 'sonner') return { toast: { success() {}, warning() {}, error() {} } }
    if (name === '@/lib/api/lead-attachments') return { leadAttachmentsAPI: Object.fromEntries(['create','upload','list'].map(method => [method, async (...args) => { calls.push({ method, args }); return method === 'list' ? [] : { id: 'synthetic', lead_id: 'lead-a' } }])) }
    throw new Error(`Unexpected dependency ${name}`)
  }
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { AbortController, Error, console })(require, compiledModule, compiledModule.exports)
  return { ...compiledModule.exports, calls, cleanups, auth, beginRender: () => { cursor = 0 } }
}

test('actual upload hook pins actor/session and cancels a pending gesture on unmount', async () => {
  const fixture = runtime(); const mutation = fixture.useUploadLeadAttachment(); const file = new File(['fixture'], 'fixture.pdf')
  await mutation.mutationFn({ leadId: 'lead-a', file })
  const request = fixture.calls[0].args
  assert.equal(request[2], 'org-a'); assert.equal(request[3].expectedUserId, 'user-a'); assert.equal(request[3].expectedSessionId, 'session-a')
  fixture.cleanups.forEach(cleanup => cleanup?.())
  assert.equal(request[3].signal.aborted, true)
  await assert.rejects(mutation.mutationFn({ leadId: 'lead-a', file }))
  assert.equal(fixture.calls.length, 1)
})

test('actual registration and read hooks pass the identity and read cancellation to the transport', async () => {
  const fixture = runtime(); const create = fixture.useCreateLeadAttachment()
  await create.mutationFn({ lead_id: 'lead-a', file_name: 'fixture.pdf', file_url: 'https://example.invalid/synthetic', message_id: 'message-a' })
  assert.equal(fixture.calls[0].args[2].expectedSessionId, 'session-a')
  const read = fixture.useLeadAttachments('lead-a'); const controller = new AbortController()
  await read.queryFn({ signal: controller.signal })
  assert.equal(fixture.calls[1].args[2].signal, controller.signal)
  assert.equal(fixture.calls[1].args[2].expectedUserId, 'user-a')
  assert.equal(fixture.calls[1].args[2].expectedSessionId, 'session-a')
})

test('an old upload closure cannot use the replacement organization controller under the same actor/session', async () => {
 const fixture=runtime(); const old=fixture.useUploadLeadAttachment();fixture.auth.activeOrganization.organizationId='org-b';fixture.beginRender(); const current=fixture.useUploadLeadAttachment();
 await assert.rejects(old.mutationFn({leadId:'lead-a',file:new File(['fixture'],'fixture.pdf')})); assert.equal(fixture.calls.length,0);
 await current.mutationFn({leadId:'lead-b',file:new File(['fixture'],'fixture.pdf')}); assert.equal(fixture.calls[0].args[2],'org-b');
})
