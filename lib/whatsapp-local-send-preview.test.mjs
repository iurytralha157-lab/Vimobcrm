import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
const require = createRequire(import.meta.url), ts = require('typescript')
const testModule = { exports: {} }
Function('exports', ts.transpileModule(readFileSync(new URL('./whatsapp-local-send-preview.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(testModule.exports)
const { WhatsAppLocalSendPreviewStore, getWhatsAppLocalSendPreviewStore } = testModule.exports
const scope = { organizationId: 'org-a', userId: 'user-a', accessScope: 'auth-a:permissions' }
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const base = Object.freeze({ id: id(1), session_id: id(2), lead_id: id(3), last_message: 'Anterior',
  last_message_id: id(4), last_message_at: '2026-10-18T10:00:00Z', last_message_sent_at: '2026-10-18T10:00:00Z',
  last_message_from_me: false, last_message_status: 'received' })
const input = { clientId: id(5), sessionId: id(2), preview: 'Mensagem própria', sentAt: '2026-10-18T10:01:00Z' }
function fixture() { let now=0; const store = new WhatsAppLocalSendPreviewStore(()=>now), owner = store.createOwner(scope)
  const token=store.begin(owner,base,input); return {store,owner,token,project:cards=>store.project(cards,scope),tick:value=>now=value} }

test('a known own send projects the complete pending tuple immediately without mutating or ordering a canonical list',()=>{
  const f=fixture(), untouched={...base,id:id(10)}, cards=[base,untouched], projected=f.project(cards)
  assert.deepEqual(projected.map(card=>card.id),cards.map(card=>card.id));assert.equal(projected[1],untouched)
  assert.deepEqual([projected[0].last_message,projected[0].last_message_from_me,projected[0].last_message_status],['Mensagem própria',true,'pending'])
  assert.equal(projected[0].last_message_at,input.sentAt);assert.equal(base.last_message_at,'2026-10-18T10:00:00Z');assert.equal(base.last_message,'Anterior')
})
test('receipt high water survives older in-flight list responses and never changes another head text',()=>{
  const f=fixture();f.store.advance(f.token,{status:'sent',messageId:id(6),conversationId:base.id,sessionId:base.session_id})
  const read={...base,last_message_id:id(6),last_message:'Mensagem própria',last_message_from_me:true,last_message_status:'read'}
  f.store.reconcile([read],scope)
  assert.equal(f.project([base])[0].last_message_status,'read')
  assert.equal(f.project([{...read,last_message_status:'delivered'}])[0].last_message_status,'read')
  f.store.advance(f.token,{status:'queued'});assert.equal(f.project([base])[0].last_message_status,'read')
  const edited={...read,last_message:'Texto alterado pelo servidor'};assert.equal(f.project([edited])[0].last_message,edited.last_message)
})
test('a newer incoming head retires the intent and its late acknowledgement cannot resurrect it',()=>{
  const f=fixture(), incoming={...base,last_message_id:id(7),last_message:'Resposta do lead',last_message_at:input.sentAt,last_message_sent_at:input.sentAt}
  assert.equal(f.project([incoming])[0],incoming);f.store.reconcile([incoming],scope)
  f.store.advance(f.token,{status:'read',messageId:id(6)});assert.equal(f.project([base])[0],base)
})
test('two sends at the same timestamp have different intent tokens and an old acknowledgement never lends a receipt',()=>{
  const f=fixture(), newer=f.store.begin(f.owner,base,{...input,clientId:id(8),preview:'Outra mensagem'})
  f.store.advance(f.token,{status:'read',messageId:id(6)})
  assert.deepEqual([f.project([base])[0].last_message,f.project([base])[0].last_message_status],['Outra mensagem','pending'])
  f.store.advance(newer,{status:'sent',messageId:id(9)});assert.equal(f.project([base])[0].last_message_status,'sent')
})
test('a changed legacy head is never attributed an old own receipt by matching its text',()=>{
  const f=fixture(), legacy={...base,last_message_id:undefined,last_message_sent_at:undefined}
  f.store.discard(f.token);const token=f.store.begin(f.owner,legacy,input)
  f.store.advance(token,{status:'sent',messageId:id(6)})
  assert.equal(f.project([legacy])[0].last_message_status,'sent')
  const changed={...legacy,last_message:'Mensagem própria',last_message_at:input.sentAt,last_message_from_me:undefined,last_message_status:undefined}
  assert.equal(f.project([changed])[0],changed)
})
test('lead/session/organization/actor/access mismatches and history never receive the local tuple',()=>{
  const f=fixture()
  for(const change of [{lead_id:id(12)},{session_id:id(13)},{platform:'instagram'},{historical_lead_view:true},{is_group:true}]){
    const card={...base,...change};assert.equal(f.project([card])[0],card)
  }
  for(const change of [{organizationId:'org-b'},{userId:'user-b'},{accessScope:'auth-b:permissions'}])assert.equal(f.store.project([base],{...scope,...change})[0],base)
  f.store.advance(f.token,{status:'read',conversationId:id(20)});assert.equal(f.project([base])[0].last_message_status,'pending')
})
test('owner retirement fences Auth ABA and one consumer unsubscribing does not erase another consumer preview',()=>{
  const f=fixture(), unsubscribe=f.store.subscribe(()=>{});unsubscribe();assert.equal(f.project([base])[0].last_message_status,'pending')
  f.store.retireOwner(f.owner);const replacement=f.store.createOwner(scope), token=f.store.begin(replacement,base,{...input,preview:'Nova época'})
  f.store.advance(f.token,{status:'read'});assert.equal(f.project([base])[0].last_message_status,'pending')
  f.store.advance(token,{status:'sent'});assert.equal(f.project([base])[0].last_message_status,'sent')
  f.store.clear(scope,[base.id]);assert.equal(f.project([base])[0],base)
})
test('failure retry starts a fresh pending intent and a prior failure cannot overwrite its acceptance',()=>{
  const f=fixture();f.store.advance(f.token,{status:'failed'});assert.equal(f.project([base])[0].last_message_status,'failed')
  const retry=f.store.begin(f.owner,base,{...input,clientId:id(8)})
  f.store.advance(f.token,{status:'failed'});assert.equal(f.project([base])[0].last_message_status,'pending')
  f.store.advance(retry,{status:'sent'});f.store.advance(retry,{status:'failed'});assert.equal(f.project([base])[0].last_message_status,'sent')
})
test('expired previews disappear and stores never cross QueryClient instances',()=>{
  const f=fixture();f.tick(120001);assert.equal(f.project([base])[0],base);f.store.expire()
  assert.equal(f.store.nextExpiry(scope),Infinity)
  const client={};assert.equal(getWhatsAppLocalSendPreviewStore(client),getWhatsAppLocalSendPreviewStore(client))
  assert.notEqual(getWhatsAppLocalSendPreviewStore(client),getWhatsAppLocalSendPreviewStore({}))
})
test('closing a composer preserves its intent for other consumers, but a later scope ABA fences its response',()=>{
  const f=fixture();f.store.retireOwner(f.owner,true)
  assert.equal(f.project([base])[0].last_message_status,'pending')
  f.store.advance(f.token,{status:'sent',messageId:id(6)})
  assert.equal(f.project([base])[0].last_message_status,'sent')
  f.store.synchronizeScope({...scope,accessScope:'auth-b:permissions'});f.store.synchronizeScope(scope)
  f.store.advance(f.token,{status:'read'});assert.equal(f.project([base])[0],base)
})
for(const latePredecessorAck of [false,true])test(`a lagging own predecessor GET cannot retire a second send: late predecessor ACK=${latePredecessorAck}`,()=>{
  const f=fixture()
  if(!latePredecessorAck)f.store.advance(f.token,{status:'sent',messageId:id(6)})
  const newer=f.store.begin(f.owner,base,{...input,clientId:id(8),preview:'Envio C'})
  if(latePredecessorAck)f.store.advance(f.token,{status:'read',messageId:id(6)})
  const predecessor={...base,last_message_id:id(6),last_message:'Mensagem própria',last_message_from_me:true,last_message_status:'read',last_message_at:input.sentAt,last_message_sent_at:input.sentAt}
  const contradictoryDirection={...predecessor,last_message_from_me:false}
  assert.equal(f.project([contradictoryDirection])[0],contradictoryDirection,'an incoming direction never borrows even an exact predecessor identity')
  f.store.reconcile([predecessor],scope)
  assert.deepEqual([f.project([predecessor])[0].last_message,f.project([predecessor])[0].last_message_status],['Envio C','pending'])
  f.store.advance(newer,{status:'sent',messageId:id(9)});f.store.reconcile([predecessor],scope)
  assert.deepEqual([f.project([predecessor])[0].last_message,f.project([predecessor])[0].last_message_status],['Envio C','sent'])
  const incoming={...predecessor,last_message_id:id(10),last_message:'Resposta concorrente',last_message_from_me:false,last_message_status:'received'}
  f.store.reconcile([incoming],scope);f.store.advance(newer,{status:'read',messageId:id(9)})
  assert.equal(f.project([incoming])[0],incoming);assert.equal(f.project([base])[0],base)
})
for(const uncertain of ['confirming','unconfirmed','failed'])test(`a canonical same-ID queued receipt resolves ${uncertain} and rejects a late local error`,()=>{
  const f=fixture();f.store.advance(f.token,{status:uncertain,messageId:id(6)})
  const queued={...base,last_message_id:id(6),last_message:'Mensagem própria',last_message_from_me:true,last_message_status:'queued'}
  assert.equal(f.project([queued])[0].last_message_status,'queued');f.store.reconcile([queued],scope)
  f.store.advance(f.token,{status:'failed'});f.store.advance(f.token,{status:'confirming'})
  assert.equal(f.project([base])[0].last_message_status,'queued')
  f.store.advance(f.token,{status:'sent',messageId:id(6),canonical:true,clientId:input.clientId})
  assert.equal(f.project([queued])[0].last_message_status,'sent')
  f.store.reconcile([queued],scope);assert.equal(f.project([queued])[0].last_message_status,'sent')
})
test('an acknowledgement for a different client intent cannot be joined to the current preview',()=>{
  const f=fixture();f.store.advance(f.token,{status:'read',messageId:id(6),clientId:id(20),canonical:true})
  assert.equal(f.project([base])[0].last_message_status,'pending')
})
