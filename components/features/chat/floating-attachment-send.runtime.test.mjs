import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('FloatingChat.tsx', readFileSync(new URL('./FloatingChat.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleFileSelect') handler = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source); assert.ok(handler);
const js = ts.transpileModule(`return (${handler});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const helper = { exports: {} };
Function('exports', ts.transpileModule(readFileSync(new URL('../../../lib/whatsapp-send-intent.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(helper.exports);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const canonical = (code) => ({ conversationId: 'chat-a', clientMessageId: 'original-file', status: code ? 'failed' : 'queued',
  message: { id: 'canonical-file', conversation_id: 'chat-a', client_message_id: 'original-file', from_me: true, status: code ? 'failed' : 'queued', delivery_error_code: code } });
function fixture(overrides = {}) {
  const attendance = deferred(), delivery = deferred(), sends = [], notices = [];
  const file = { name: 'ficha.pdf', type: 'application/pdf', size: 32 };
  const dependencies = {
    audioGenerationRef: { current: 1 }, audioContextRef: { current: 'A' }, audioContextKey: 'A',
    canMutateActiveConversation: true, activeConversation: { id: 'chat-a', lead_id: 'lead-a', session_id: 'session-a' },
    sendMediaMessage: { isPending: false, mutateAsync: params => { sends.push(params); return delivery.promise; } },
    MAX_OUTBOUND_MESSAGE_MEDIA_BYTES: 5*1024*1024, whatsappMessageInputState: { disabled: false, sendSessionId: 'session-a' },
    isReadOnlyMode: false, fileInputRef: { current: { value: 'selection-a' } },
    attendanceGate: { ensureJoined: () => attendance.promise }, compressOutboundImageFile: async value => value,
    OUTBOUND_IMAGE_COMPRESSION_PROFILES: { preservePngEncoding: {} }, blobToBase64: async () => 'synthetic',
    getOutboundMessageMediaKind: () => 'document', replyTarget: { id: 'quote-a' }, toWhatsAppQuote: value => value,
    setReplySelection: () => {}, getWhatsAppFileSendFeedback: helper.exports.getWhatsAppFileSendFeedback,
    getWhatsAppSendFailureStatus: () => 'confirming', toast: notice => notices.push(notice), ...overrides,
  };
  const run = Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
  return { run, attendance, delivery, dependencies, sends, notices, file };
}
test('actual floating handler accepts the original File and caption without synthesizing a DOM event', async () => {
  const f=fixture();f.attendance.resolve(true);const pending=f.run(f.file,'Informações do imóvel');
  await new Promise(done=>setImmediate(done));assert.equal(f.sends.length,1);
  assert.equal(f.sends[0].fileIntentSource,f.file);assert.equal(f.sends[0].text,'Informações do imóvel');
  f.delivery.resolve(canonical());assert.equal(await pending,'queued');
});
for(const [code,outcome] of [['outcome_unknown','unconfirmed'],['recipient_not_registered','failed']]) {
  test(`actual floating handler returns canonical ${outcome} for attachment review`,async()=>{
    const f=fixture();f.attendance.resolve(true);f.delivery.resolve(canonical(code));
    assert.equal(await f.run(f.file,''),outcome);assert.equal(f.sends.length,1);
    assert.equal(f.sends[0].text,'');assert.equal(f.sends[0].fileIntentSource,f.file);
  });
}
test('actual floating direct-file send cancels preparation after permission or conversation ABA',async()=>{
  const f=fixture();const pending=f.run(f.file,'caption');
  f.dependencies.audioContextRef.current='B';f.dependencies.audioGenerationRef.current+=2;
  f.dependencies.audioContextRef.current='A';f.attendance.resolve(true);
  assert.equal(await pending,'cancelled');assert.deepEqual(f.sends,[]);assert.deepEqual(f.notices,[]);
});
test('actual floating old file completion cannot clear a new picker or announce acceptance in another chat',async()=>{
  const f=fixture();f.attendance.resolve(true);const pending=f.run(f.file,'caption');
  await new Promise(done=>setImmediate(done));assert.equal(f.sends.length,1);
  f.dependencies.audioContextRef.current='B';f.dependencies.fileInputRef.current={value:'selection-b'};
  f.delivery.resolve(canonical());assert.equal(await pending,'cancelled');
  assert.equal(f.dependencies.fileInputRef.current.value,'selection-b');assert.deepEqual(f.notices,[]);
});
test('actual floating direct-file oversized source does not prepare attendance or send',async()=>{
  const f=fixture();f.file.size=5*1024*1024+1;
  assert.equal(await f.run(f.file,'caption'),'failed');assert.deepEqual(f.sends,[]);
  assert.equal(f.notices[0].title,'Arquivo muito grande');
});
test('actual floating direct-file oversized processed payload never encodes or enqueues',async()=>{
  let encoded=0;
  const f=fixture({compressOutboundImageFile:async file=>({...file,size:5*1024*1024+1}),blobToBase64:async()=>{encoded++;return 'synthetic';}});
  f.attendance.resolve(true);assert.equal(await f.run(f.file,'caption'),'failed');
  assert.equal(encoded,0);assert.deepEqual(f.sends,[]);
});
test('actual floating file after lost response stays unconfirmed and does not invite another enqueue',async()=>{
  const f=fixture();f.attendance.resolve(true);const pending=f.run(f.file,'caption');
  await new Promise(done=>setImmediate(done));f.delivery.reject(new TypeError('response lost'));
  assert.equal(await pending,'unconfirmed');assert.equal(f.sends.length,1);assert.deepEqual(f.notices,[]);
});
