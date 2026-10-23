import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as auxiliary from '../validation/auxiliary.ts'
import * as common from '../validation/common.ts'
import { getLeadAttachmentUploadReceipt } from '../lead-attachment-upload.ts'

const org = '10000000-0000-4000-8000-000000000001'
const lead = '30000000-0000-4000-8000-000000000001'
const attachment = { id: '40000000-0000-4000-8000-000000000001', lead_id: lead, file_name: 'fixture.pdf',
  file_url: null, availability: 'signing_unavailable', file_type: 'document', file_size: 10,
  created_at: '2026-10-12T20:00:00Z', created_by: '20000000-0000-4000-8000-000000000001', message_id: null }

function runtime(transport, identity) {
  const source = readFileSync(new URL('./lead-attachments.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
  assert.equal(output.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0)
  const compiledModule = { exports: {} }
  const require = name => {
    if (name === './vimob-client') return { vimobAPIRequest: transport, getVimobAPIAccessTokenUserId: () => identity.userId, getVimobAPIAccessTokenSessionId: () => identity.sessionId }
    if (name === '@/lib/lead-attachment-upload') return { getLeadAttachmentUploadReceipt }
    if (name === '@/lib/validation') return { ...common, ...auxiliary, entityIdSchema: common.uuidSchema }
    throw new Error(`Unexpected import ${name}`)
  }
  vm.runInNewContext(`(function(require,module,exports){${output.outputText}\n})`, { FormData, File, Error, crypto })(require, compiledModule, compiledModule.exports)
  return compiledModule.exports.leadAttachmentsAPI
}

test('actual upload adapter preserves key, actor, session and cancellation when a response is lost', async () => {
  const requests = []; const identity = { userId: 'user-a', sessionId: 'session-a' }
  const api = runtime(async (url, options) => { requests.push({ url, options }); if (requests.length === 1) throw new Error('synthetic response loss'); return { data: attachment } }, identity)
  const file = new File(['%PDF-fixture'], 'fixture.pdf'); const controller = new AbortController()
  await assert.rejects(api.upload(lead, file, org, { expectedUserId: identity.userId, expectedSessionId: identity.sessionId, signal: controller.signal }))
  const result = await api.upload(lead, file, org, { expectedUserId: identity.userId, expectedSessionId: identity.sessionId, signal: controller.signal })
  assert.equal(result.file_url, null)
  assert.equal(result.availability, 'signing_unavailable')
  assert.equal(requests[0].options.body.get('uploadRequestKey'), requests[1].options.body.get('uploadRequestKey'))
  for (const { url, options } of requests) {
    assert.equal(url, `/v1/leads/${lead}/attachment-uploads`)
    assert.equal(options.expectedUserId, 'user-a'); assert.equal(options.expectedSessionId, 'session-a')
    assert.equal(options.signal, controller.signal); assert.equal(options.organizationId, org)
  }
  identity.userId = 'user-b'
  await assert.rejects(api.upload(lead, file, org), error => error.code === 'request_identity_changed')
  assert.equal(requests.length, 2)
})

test('actual registration and read adapters preserve gesture identity and validate unavailable documents', async () => {
  const requests = []; const identity = { userId: 'user-a', sessionId: 'session-a' }
  const api = runtime(async (url, options) => { requests.push(options); return { data: options.method === 'POST' ? attachment : [attachment] } }, identity)
  const intent = { expectedUserId: 'user-a', expectedSessionId: 'session-a', signal: new AbortController().signal }
  await api.create({ lead_id: lead, file_name: 'fixture.pdf', file_url: 'https://example.invalid/server-mapped-message.pdf', message_id: '60000000-0000-4000-8000-000000000001' }, org, intent)
  await api.list(lead, org, intent)
  assert.ok(requests.every(options => options.expectedUserId === 'user-a' && options.expectedSessionId === 'session-a' && options.signal === intent.signal))
})

test('actual adapters reject contradictory ready/unavailable file URLs', async () => {
 for (const data of [{...attachment,availability:'ready',file_url:null},{...attachment,availability:'signing_unavailable',file_url:'https://example.invalid/private-stable-path'},{...attachment,availability:'not_requested',file_url:'https://example.invalid/never-signed-in-list'}]) {
  const api=runtime(async()=>({data:[data]}),{userId:'user-a',sessionId:'session-a'})
  await assert.rejects(api.list(lead,org))
 }
})

test('metadata-only list is opt-in and individual access preserves scope and validates returned identity', async () => {
 const requests=[]; const identity={userId:'user-a',sessionId:'session-a'};
 const ready={...attachment,availability:'ready',file_url:'https://example.invalid/signed-document'};
 let accessReply=ready;
 const api=runtime(async(url,options)=>{requests.push({url,options});return {data:url.endsWith('/access')?accessReply:[{...attachment,availability:'not_requested'}]}},identity);
 const intent={expectedUserId:'user-a',expectedSessionId:'session-a',signal:new AbortController().signal};
 await api.list(lead,org,intent,{metadataOnly:true}); assert.equal(requests[0].options.query.metadataOnly,true);
 await api.list(lead,org,intent); assert.equal(requests[1].options.query.metadataOnly,undefined);
 const result=await api.access(lead,attachment.id,org,intent); assert.equal(result.file_url,ready.file_url);
 assert.equal(requests[2].url,`/v1/leads/${lead}/attachments/${attachment.id}/access`);
 assert.equal(requests[2].options.signal,intent.signal); assert.equal(requests[2].options.organizationId,org);
 assert.equal(requests[2].options.expectedSessionId,'session-a');
 for(const bad of [{...ready,id:'40000000-0000-4000-8000-000000000002'},{...ready,lead_id:'30000000-0000-4000-8000-000000000002'},{...attachment,availability:'not_requested'}]) {
  accessReply=bad; await assert.rejects(api.access(lead,attachment.id,org,intent));
 }
})
