import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

// Actual parent handlers and actual resolution helpers. No React mocks can
// replace their decision after the canonical POST response. No network/DB.
const root = resolve(import.meta.dirname, '../../..');
const baseline = process.env.WHATSAPP_FILE_UI_BASELINE;
const helper = { exports: {} };
Function('exports', ts.transpileModule(readFileSync(resolve(root, 'lib/whatsapp-send-intent.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(helper.exports);
const cacheFile = ts.createSourceFile('cache.ts', readFileSync(resolve(root, 'lib/whatsapp-query-cache.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const failureSource = cacheFile.statements.filter(node =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(cacheFile) === 'DEFINITIVE_SEND_FAILURES')
  || ts.isFunctionDeclaration(node) && node.name?.text === 'getWhatsAppSendFailureStatus').map(node => node.getText(cacheFile)).join('\n');
Function('exports', ts.transpileModule(failureSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(helper.exports);
for (const relative of ['components/features/whatsapp/ConversationsScreen.tsx', 'components/features/chat/FloatingChat.tsx']) {
  const file = ts.createSourceFile(relative, readFileSync(resolve(baseline || root, relative), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleFileSelect') handler = node.initializer.getText(file); ts.forEachChild(node, visit); }
  visit(file); assert.ok(handler);
  const js = ts.transpileModule(`return (${handler});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const conversation = { id: 'conversation-a', session_id: 'session-a', lead_id: 'lead-a' };
  const canonical = (status, code) => ({ conversationId: conversation.id, clientMessageId: 'original-file', status: 'queued',
    message: { id: 'canonical-file', from_me: true, status, delivery_error_code: code, conversation_id: conversation.id, client_message_id: 'original-file' } });
  const cases = [
    ['recipient rejection', canonical('failed', 'recipient_not_registered'), 'Arquivo não enviado'],
    ['unknown outcome', canonical('failed', 'outcome_unknown'), 'Confirmando envio'],
    ['failure without definitive code', canonical('failed'), 'Confirmando envio'],
    ['post-admission partial response', { conversationId: conversation.id, clientMessageId: 'original-file', status: 'confirming' }, 'Confirmando envio'],
    ['queued response without canonical evidence', { conversationId: conversation.id, clientMessageId: 'original-file', status: 'queued' }, 'Confirmando envio'],
    ['exact canonical admission', canonical('queued'), 'Arquivo na fila'],
  ];
  function fixture(result, beforeResolve = () => {}) {
    const file = { name: 'sintetico.pdf', type: 'application/pdf', size: 32 }, input = { files: [file], value: 'selected' }, toasts = [], sends = [], preparation = { joined: 0, compressed: 0, base64: 0 };
    let reply = { message: { id: 'quote-a' } };
    const send = { isPending: false, mutateAsync: async params => { sends.push(params); beforeResolve(dependencies); if (result instanceof Error) throw result; return result; } };
    const dependencies = { selectedConversation: conversation, activeConversation: conversation, sendMediaMessage: send, sendMessage: send,
      audioGenerationRef: { current: 1 }, audioContextRef: { current: 'context-a' }, audioContextKey: 'context-a', canMutateActiveConversation: true,
      whatsappMessageInputState: { disabled: false, sendSessionId: 'session-a' }, isReadOnlyMode: false, MAX_OUTBOUND_MESSAGE_MEDIA_BYTES: 5*1024*1024,
      fileInputRef: { current: input }, attendanceGate: { ensureJoined: async () => { preparation.joined++; return true; } }, compressOutboundImageFile: async f => { preparation.compressed++; return f; },
      OUTBOUND_IMAGE_COMPRESSION_PROFILES: { preferSmallerFile: {}, preservePngEncoding: {} }, blobToBase64: async () => { preparation.base64++; return 'synthetic'; }, getOutboundMessageMediaKind: () => 'document',
      replyTarget: { id: 'quote-a' }, toWhatsAppQuote: m => m, setReplySelection: fn => { reply = fn(reply); }, toast: notice => toasts.push(notice),
      getWhatsAppFileSendFeedback: helper.exports.getWhatsAppFileSendFeedback, getWhatsAppSendFailureStatus: helper.exports.getWhatsAppSendFailureStatus };
    const run = Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
    return { input, toasts, sends, preparation, dependencies, run: context => run({ target: input }, undefined, context), get reply() { return reply; } };
  }
  for (const [name, result, title] of cases) test(`${relative}: ${name} preserves the exact file intent feedback`, async () => {
    const f = fixture(result); await f.run();
    assert.deepEqual(f.toasts.map(x => x.title), [title]);
    assert.equal(f.reply === null, title === 'Arquivo na fila');
    assert.equal(f.sends.length, 1); assert.equal(f.sends[0].conversation.id, conversation.id); assert.equal(f.input.value, '');
  });
  test(`${relative}: checking an original file never claims another enqueue`, async () => {
    const f = fixture({ status: 'confirming', fileIntentChecked: true }); await f.run(); assert.deepEqual(f.toasts, []); assert.ok(f.reply); assert.equal(f.input.value, '');
  });
  for (const [fileIntentResolution, state] of [['accepted', 'queued'], ['failed', 'failed'], ['pending', 'unconfirmed'], ['cancelled', 'cancelled']]) {
    test(`${relative}: checked ${fileIntentResolution} preserves its explicit resolution and Verify mode`, async () => {
      const f = fixture({ conversationId: conversation.id, clientMessageId: 'original-file', fileIntentChecked: true, fileIntentResolution });
      const outcome = await f.run({ verificationOnly: true, adoptScope: () => false });
      assert.equal(outcome, state); assert.deepEqual(f.toasts, []); assert.ok(f.reply);
      assert.equal(f.sends[0].fileIntentVerificationOnly, true);
      assert.equal(f.sends[0].fileIntentSource.name, 'sintetico.pdf');
      assert.deepEqual(f.preparation, { joined: 0, compressed: 0, base64: 0 });
      assert.equal(f.sends[0].base64, undefined); assert.equal(f.sends[0].mediaType, undefined);
      assert.equal(f.sends[0].quotedMessageId, undefined); assert.equal(f.sends[0].optimisticQuotedMessage, undefined);
      assert.equal(f.sends[0].sendSessionId, 'session-a');
    });
  }
  test(`${relative}: a completion from the previous conversation never announces or clears the new context`, async () => {
    const f = fixture(canonical('queued'), d => { d.audioContextRef.current = 'context-b'; d.fileInputRef.current = { value: 'new-file' }; }); await f.run();
    assert.deepEqual(f.toasts, []); assert.ok(f.reply);
  });
  test(`${relative}: Verify transport failure preserves uncertainty without joining attendance or preparing bytes`, async () => {
    const f = fixture(new TypeError('Synthetic verification response lost'));
    const outcome = await f.run({ verificationOnly: true, adoptScope: () => false });
    assert.equal(outcome, 'unconfirmed'); assert.deepEqual(f.toasts, []); assert.ok(f.reply);
    assert.deepEqual(f.preparation, { joined: 0, compressed: 0, base64: 0 }); assert.equal(f.input.value, '');
  });
  test(`${relative}: late Verify after a physical conversation change is cancelled and preserves the next selection`, async () => {
    const f = fixture({ conversationId: conversation.id, clientMessageId: 'original-file', fileIntentChecked: true, fileIntentResolution: 'accepted' },
      dependencies => { dependencies.audioContextRef.current = 'context-b'; dependencies.fileInputRef.current = { value: 'new-file' }; });
    const outcome = await f.run({ verificationOnly: true, adoptScope: () => false });
    assert.equal(outcome, 'cancelled'); assert.deepEqual(f.toasts, []); assert.ok(f.reply);
    assert.deepEqual(f.preparation, { joined: 0, compressed: 0, base64: 0 }); assert.equal(f.dependencies.fileInputRef.current.value, 'new-file');
  });
}
