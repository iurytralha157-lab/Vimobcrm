import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = process.env.WHATSAPP_SEND_ENTRY_BASELINE;
const read = path => readFileSync(join(baseline || repository, path), 'utf8');
const compileOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React };
const input = {};
Function('exports', ts.transpileModule(readFileSync(join(repository, 'lib/whatsapp-message-input.ts'), 'utf8'), { compilerOptions: compileOptions }).outputText)(input);
const helpers = {};
Function('require', 'exports', ts.transpileModule(read('lib/whatsapp-own-start.ts'), { compilerOptions: compileOptions }).outputText)(() => input, helpers);
const parsed = ts.createSourceFile('FloatingChat.tsx', read('components/features/chat/FloatingChat.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name) declarations.set(node.name.getText(parsed), node);
  ts.forEachChild(node, visit);
}
visit(parsed);
function actual(name, dependencies) {
  const node = declarations.get(name); assert.ok(node, name);
  const code = ts.transpileModule(ts.isVariableDeclaration(node) ? `const ${node.getText(parsed)};` : node.getText(parsed), { compilerOptions: compileOptions }).outputText;
  return Function(...Object.keys(dependencies), `${code};return ${name}`)(...Object.values(dependencies));
}
const own = { id: 'own-a', owner_user_id: 'viewer', status: 'connected', can_send: true, provider: 'evolution_go' };
const shared = { ...own, id: 'shared', owner_user_id: 'original-owner' };
const conversation = { id: 'original', session_id: shared.id, lead_id: 'lead-a', contact_phone: '+5511999998888',
  lead: { id: 'lead-a', assignee: { id: 'viewer' } } };
const notice = patch => helpers.getOwnWhatsAppStartNotice({ conversation, sessions: [shared, own], currentUserId: 'viewer', canOperate: true, ...patch });

test('an authorized original route offers the owned route while keeping its working composer', () => {
  assert.deepEqual(notice(), { kind: 'start', ownConnectedSessionIds: ['own-a'], preserveComposer: true });
  assert.equal(input.getWhatsAppMessageInputState(conversation, null, [shared, own], 'viewer').sendSessionId, 'shared');
  assert.equal(input.getWhatsAppMessageInputState(conversation, own.id, [shared, own], 'viewer').disabled, true, 'never send across physical sessions');
});
test('missing original grant still offers owned start, and absence of an owned route does not disable an authorized original', () => {
  assert.deepEqual(notice({ sessions: [own] }), { kind: 'start', ownConnectedSessionIds: ['own-a'] });
  assert.equal(notice({ sessions: [shared] }), null);
  assert.equal(notice({ conversation: { ...conversation, session_id: own.id } }), null);
});
test('a new lead uses the normal own-account composer and only asks to connect when no owned account is available', () => {
  const draft = { ...conversation, id: null, session_id: null };
  for (const sessions of [[own], [shared, own, { ...own, id: 'own-b' }]]) {
    assert.equal(notice({ conversation: draft, sessions }), null, 'a draft has no original route to replace');
    assert.equal(input.getWhatsAppMessageInputState(draft, own.id, sessions, 'viewer').sendSessionId, own.id);
    assert.equal(input.getWhatsAppMessageInputState(draft, null, sessions, 'viewer').disabled, sessions.length > 1);
  }
  assert.deepEqual(notice({ conversation: draft, sessions: [] }), { kind: 'connect', ownConnectedSessionIds: [] });
});

test('read-only, unresolved, group and missing lead cannot expose an owned-start action', () => {
  for (const patch of [{ canOperate: false }, { loadingSessions: true }, { currentUserId: null }, { sessions: undefined },
    { conversation: { ...conversation, is_group: true } }, { conversation: { ...conversation, lead_id: null, lead: null } }]) assert.equal(notice(patch), null);
});

const React = { Fragment: 'Fragment', createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children })
  : ({ type, props: props ?? {}, children: children.flat(Infinity).filter(item => item !== false && item != null) }) };
const noticeExports = {};
Function('require', 'exports', 'React', ts.transpileModule(read('components/features/whatsapp/OwnWhatsAppStartNotice.tsx'), { compilerOptions: compileOptions }).outputText)(id => id === 'next/link' ? { default: 'Link' } : { Loader2: 'Loader2' }, noticeExports, React);
const tree = item => typeof item === 'object' && item ? [item, ...(item.children ?? []).flatMap(tree)] : [];
const noop = () => {};
test('actual floating renderer keeps the original input alongside the optional owned-start action', () => {
  const render = actual('renderMessageInput', { React, cn: (...x) => x.filter(Boolean).join(' '), originalOrganization: true,
    activeSupervisoryView: false, activeConversation: conversation, ownStartNotice: { kind: 'start', ownConnectedSessionIds: [own.id], preserveComposer: true },
    canOperateWhatsApp: true, localReadOnly: false, sessionsFailed: false, OwnWhatsAppStartNotice: noticeExports.OwnWhatsAppStartNotice,
    refetchSessions: noop, isStartingConversation: false, requestOwnWhatsAppStart: noop, attachments: { onPaste: noop, onFileSelect: noop },
    audioContextKey: 'scope-a', fileInputRef: { current: null }, AttachmentPreviewComposer: 'AttachmentPreview', replyTarget: null,
    ScopedMessageBox: 'ScopedMessageBox', messageText: 'Rascunho original', setMessageText: noop, handleSendMessage: noop,
    handleKeyPress: noop, isReadOnlyMode: false, whatsappMessageInputState: { placeholder: 'Digite sua mensagem...' },
    messageInputDisabled: false, sendMessage: { isPending: false }, messageInputRef: { current: null }, Paperclip: 'Paperclip',
    sendMediaMessage: { isPending: false }, canStartActiveConversationAutomation: false, handleSendAudio: noop, handleResolveAudio: noop, audioDisabled: false });
  const result = tree(render(false));
  assert.equal(result.filter(n => n.props['data-whatsapp-own-start'] === 'start').length, 1);
  assert.equal(result.find(n => n.type === 'ScopedMessageBox')?.props.value, 'Rascunho original');
  assert.equal(result.find(n => n.type === 'ScopedMessageBox')?.props.disabled, false);
});

function startup(patch = {}) {
  const calls = []; let live = true;
  const values = { intentTenantKey: 'viewer:org-a', intentGeneration: 1, startupScope: 'scope-a', startupScopeRef: { current: 'scope-a' },
    isIntentCurrent: () => live, sessions: [own], currentUserId: 'viewer', startRequestGenerationRef: { current: 0 },
    setVisibleStartRequestGeneration: noop, originalOrganization: true, normalizePhoneToE164: p => p, setIsStartingConversation: noop,
    activeOrganization: { organizationId: 'org-a' }, canOperateWhatsApp: true, localReadOnly: false, sessionsFailed: false,
    whatsappAPI: { findConversation: async () => null }, findConversation: { mutateAsync: async () => null },
    startConversation: { mutateAsync: async p => { calls.push(['start', p]); return { id: 'own-conversation', lead_id: 'lead-a', session_id: own.id }; } },
    setSelectedSessionId: id => calls.push(['session', id]), openConversation: c => calls.push(['open', c]),
    clearActiveConversation: () => calls.push(['clear']), clearPendingMessage: () => calls.push(['clear-message']),
    toast: p => calls.push(['toast', p]), getWhatsAppPhoneChangeConfirmation: () => null,
    WHATSAPP_UNLINKED_LEAD_SNAPSHOT: 'unlinked', ...patch };
  return { calls, run: actual('handleStartConversationWithSession', values), invalidate: () => { live = false; } };
}
test('cold lookup without session or prior history retains the intent and prepared text without a false error', async () => {
  const h = startup({ sessions: [] }); await h.run('+5511999998888', undefined, 'Lead sintético', 'lead-a');
  assert.deepEqual(h.calls, []);
});
test('reconnected startup creates an owned physical conversation and never sends the prepared message automatically', async () => {
  const h = startup(); await h.run('+5511999998888', own.id, 'Lead sintético', 'lead-a', true);
  assert.equal(h.calls.filter(([kind]) => kind === 'start').length, 1);
  assert.equal(h.calls.find(([kind]) => kind === 'start')[1].sessionId, own.id);
  assert.equal(h.calls.find(([kind]) => kind === 'start')[1].ownSessionOnly, true);
  assert.equal(h.calls.find(([kind]) => kind === 'open')[1].session_id, own.id);
  assert.equal(h.calls.some(([kind]) => ['clear', 'clear-message', 'send'].includes(kind)), false);
});
test('a cancelled cold lookup cannot reopen a later intent', async () => {
  let settle; const h = startup({ whatsappAPI: { findConversation: () => new Promise(resolve => { settle = resolve; }) } });
  const pending = h.run('+5511999998888', undefined, 'Lead sintético', 'lead-a'); h.invalidate(); settle(null); await pending;
  assert.deepEqual(h.calls, []);
});
test('connection link notifies its owner without clearing an intent', () => {
  let opened = 0;
  const result = tree(noticeExports.OwnWhatsAppStartNotice({ notice: { kind: 'connect', ownConnectedSessionIds: [] }, onConnect: () => opened++ }));
  const link = result.find(n => n.type === 'Link'); assert.equal(link.props.href, '/settings?tab=whatsapp');
  link.props.onClick(); assert.equal(opened, 1);
});
