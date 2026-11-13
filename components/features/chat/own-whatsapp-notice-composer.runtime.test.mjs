import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const parse = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const floatSource = parse('./FloatingChat.tsx');
let floatRenderer;
function findFloat(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(floatSource) === 'renderMessageInput') floatRenderer = node.getText(floatSource);
  ts.forEachChild(node, findFloat);
}
findFloat(floatSource); assert.ok(floatRenderer);
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React };
const floatBody = ts.transpileModule(`const ${floatRenderer};`, { compilerOptions }).outputText;
const React = { Fragment: 'Fragment', createElement: (type, props, ...children) => typeof type === 'function'
  ? type({ ...props, children }) : ({ type, props: props ?? {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }) };
const noticeExports = {};
Function('require', 'exports', 'React', ts.transpileModule(readFileSync(new URL('../whatsapp/OwnWhatsAppStartNotice.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { ...compilerOptions, module: ts.ModuleKind.CommonJS },
}).outputText)(id => id === 'next/link' ? { default: 'Link' } : { Loader2: 'Loader2' }, noticeExports, React);
const isNotice = item => Boolean(item.props['data-whatsapp-own-start']);
function nodes(tree) { return typeof tree === 'object' && tree ? [tree, ...(tree.children ?? []).flatMap(nodes)] : []; }
function dependencies(overrides = {}) {
  const noop = () => {};
  return { React, cn: (...values) => values.filter(Boolean).join(' '), originalOrganization: true,
    activeSupervisoryView: false,
    activeConversation: { id: 'chat-own', lead_id: 'lead-A', is_group: false },
    ownStartNotice: null, leadOwnStartNotice: null, OwnWhatsAppStartNotice: noticeExports.OwnWhatsAppStartNotice,
    isStartingConversation: false, requestOwnWhatsAppStart: noop, localReadOnly: false, sessionsFailed: false, refetchSessions: noop,
    attachments: { onPaste: noop, onFileSelect: noop },
    audioContextKey: 'scope-A', fileInputRef: { current: null }, messageInputRef: { current: null }, textareaRef: { current: null },
    messageInputDisabled: false, audioDisabled: false, replyTarget: null, AttachmentPreviewComposer: 'AttachmentPreview',
    ScopedMessageBox: 'ScopedMessageBox', MessageBox: 'MessageBox', messageText: '', text: '',
    setMessageText: noop, setText: noop, handleSendMessage: noop, handleSend: noop, handleKeyPress: noop,
    isReadOnlyMode: false, whatsappMessageInputState: { placeholder: 'Digite sua mensagem...' },
    sendMessage: { isPending: false }, sendMediaMessage: { isPending: false }, canStartActiveConversationAutomation: false,
    handleSendAudio: noop, handleResolveAudio: noop,
    Paperclip: 'Paperclip', AudioRecorderButton: 'AudioRecorderButton',
    conversation: { id: 'chat-own' }, canOperateWhatsApp: true, hasLeadPhone: true, leadHasNoWhatsApp: false,
    ownConnectedSessions: [], selectedOwnSessionId: null, handleOwnSessionSelect: noop,
    isSendingMessage: false, isSendingMedia: false, loadingSessions: false, composerHighlighted: false,
    canSendMessage: true, inputPlaceholder: 'Digite sua mensagem...', audioActive: false,
    setAudioActive: noop, resolveSendIntent: noop, ...overrides };
}
function renderFloat(overrides) { const values = dependencies(overrides); return Function(...Object.keys(values), `${floatBody};return renderMessageInput(false);`)(...Object.values(values)); }
for (const kind of ['start', 'connect']) test(`the actual floating footer renders only the ${kind} notice without sending`, () => {
  let sends = 0;
  const result = nodes(renderFloat({ ownStartNotice: { kind, ownConnectedSessionIds: kind === 'start' ? ['own-A'] : [] },
    messageInputDisabled: true, handleSendMessage: () => sends++, requestOwnWhatsAppStart: () => sends++ }));
  assert.equal(result.filter(isNotice).length, 1);
  assert.equal(result.some(item => ['input', 'ScopedMessageBox', 'AttachmentPreview', 'AudioRecorderButton'].includes(item.type)), false);
  assert.equal(sends, 0);
});
test('the actual floating footer preserves the available own or shared composer when no notice applies', () => {
  for (const id of ['chat-own', 'chat-shared']) {
    const result = nodes(renderFloat({ activeConversation: { id, lead_id: 'lead-A', is_group: false } }));
    assert.equal(result.some(isNotice), false);
    assert.equal(result.find(item => item.type === 'ScopedMessageBox')?.props.disabled, false);
  }
});
test('supervisory floating history shows only a read-only footer even when own-start is available', () => {
  const result = nodes(renderFloat({ activeSupervisoryView: true, ownStartNotice: { kind: 'start', ownConnectedSessionIds: ['own-A'] } }));
  assert.equal(result.some(item => item.props.role === 'status' && item.children.includes('Histórico deste lead (somente leitura)')), true);
  assert.equal(result.some(item => isNotice(item) || item.type === 'ScopedMessageBox'), false);
});

test('the original-organization read-only floating footer cannot expose the own-start action', () => {
  const result = nodes(renderFloat({ originalOrganization: false, ownStartNotice: { kind: 'start', ownConnectedSessionIds: ['own-A'] } }));
  assert.equal(result.some(item => isNotice(item) || item.type === 'ScopedMessageBox'), false);
});

for (const reason of ['read_only', 'sessions_failed']) test(`floating ${reason} replaces the optional own-start action and current composer`, () => {
  let retries = 0;
  const result = nodes(renderFloat({ localReadOnly: reason === 'read_only', sessionsFailed: reason === 'sessions_failed',
    refetchSessions: () => retries++, ownStartNotice: { kind: 'start', ownConnectedSessionIds: ['own-A'], preserveComposer: true } }));
  assert.equal(result.some(item => item.props['data-whatsapp-unavailable'] === reason), true);
  assert.equal(result.some(item => isNotice(item) || item.type === 'ScopedMessageBox'), false);
  const retry = result.find(item => item.type === 'button' && item.children.includes('Tentar novamente'));
  if (reason === 'sessions_failed') { assert.ok(retry); retry.props.onClick(); assert.equal(retries, 1); }
  else assert.equal(retry, undefined);
});
