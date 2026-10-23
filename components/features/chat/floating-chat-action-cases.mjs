import assert from 'node:assert/strict';
import ts from 'typescript';
import { getWhatsAppConversationMessageScope, preserveWhatsAppConversationCardSnapshot } from '../../../lib/whatsapp-message-input.ts';
import { callback, calls, effect, evaluate, jsx, nodes, prop, propText, value } from './floating-chat-source-fixture.mjs';

const F = 'components/features/chat/FloatingChat.tsx';
const CS = 'components/features/whatsapp/ConversationsScreen.tsx';
const MEDIA = 'components/features/whatsapp/message-bubble/MessageMedia.tsx';
const AUDIO = 'components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx';
const one = (items, label) => { assert.equal(items.length, 1, label); return items[0]; };

export function inboxScopeAndWriteGate() {
  for (const [file, deps, expected] of [[F, { shouldSyncFloatingChat: false }, false], [F, { shouldSyncFloatingChat: true }, true], [CS, { activePlatform: 'whatsapp' }, true], [CS, { activePlatform: 'instagram' }, false]]) {
    const invocation = one(calls(file, 'useWhatsAppInboxRealtime'), 'private inbox');
    assert.equal(evaluate(invocation.arguments[0].getText(), deps), expected);
    assert.equal(evaluate(invocation.arguments[1].getText()), true, 'active inbox includes conversations without lead');
  }
  for (const conversation of [null, { id: 'c', lead_id: null }, { id: 'c', lead_id: 'l', historical_lead_view: true }, { id: 'c', lead_id: 'l' }]) {
    const scope = getWhatsAppConversationMessageScope(conversation);
    assert.equal(value(F, 'canMutateActiveConversation', { canOperateWhatsApp: true, localReadOnly: false, sessionsFailed: false, activeConversationMessageScope: scope }), Boolean(conversation?.lead_id) && !conversation?.historical_lead_view);
  }
  for (const gate of ['sessionsFailed', 'isReadOnlyMode']) assert.equal(value(F, 'messageInputDisabled', { sessionsFailed: false, isReadOnlyMode: false, attendanceGate: { isResolving: false }, whatsappMessageInputState: { disabled: false }, [gate]: true }), true);
  assert.equal(value(F, 'messageInputDisabled', { sessionsFailed: false, isReadOnlyMode: false, attendanceGate: { isResolving: true }, whatsappMessageInputState: { disabled: false } }), true);
  assert.equal(value(F, 'messageInputDisabled', { sessionsFailed: false, isReadOnlyMode: false, attendanceGate: { isResolving: false }, whatsappMessageInputState: { disabled: true } }), true);
}

export async function permissionFailClosed() {
  const permissionsPath = 'hooks/use-user-permissions.ts';
  for (const permissions of [[], ['whatsapp_operate'], ['*']]) {
    assert.equal(callback(permissionsPath, 'hasPermission', { isSuperAdmin: false, isLoading: true, permissions })('whatsapp_operate'), false, 'permission loading must fail closed even with cached grants');
  }
  assert.equal(callback(permissionsPath, 'hasPermission', { isSuperAdmin: false, isLoading: false, permissions: ['whatsapp_operate'] })('whatsapp_operate'), true);
  for (const originalOrganization of [false, true]) for (const allowed of [false, true]) assert.equal(value(F, 'canOperateWhatsApp', { originalOrganization, hasPermission: key => key === 'whatsapp_operate' && allowed }), originalOrganization && allowed);
  for (const name of ['canMutateActiveConversation', 'canManageActiveConversation']) {
    const base = { canOperateWhatsApp: true, localReadOnly: false, sessionsFailed: false, activeConversationMessageScope: { canMutate: true, canManage: true } };
    assert.equal(value(F, name, base), true);
    for (const patch of [{ canOperateWhatsApp: false }, { localReadOnly: true }, { sessionsFailed: true }, { activeConversationMessageScope: { canMutate: false, canManage: false } }]) assert.equal(value(F, name, { ...base, ...patch }), false);
  }
  let writes = 0;
  const forbidden = () => { writes++; throw new Error('blocked operation must not execute'); };
  for (const historical of [false, true]) {
    const conversation = { id: 'c', lead_id: 'l', historical_lead_view: historical };
    for (const canOperateWhatsApp of [false, true]) {
      if (canOperateWhatsApp && !historical) continue;
      callback(F, 'handleArchiveConversation', { canOperateWhatsApp, archiveConversation: { mutate: forbidden } })(conversation);
      callback(F, 'handleDeleteConversation', { canOperateWhatsApp, setPendingDeleteConversation: forbidden })(conversation);
    }
  }
  await callback(F, 'retryMediaDownload', { canMutateActiveConversation: false, whatsappAPI: { retryMediaDownload: forbidden } })('m');
  await callback(F, 'handleSendMessage', { audioGenerationRef: { current: 1 }, messageText: 'texto', canMutateActiveConversation: false, sendMessage: { mutateAsync: forbidden } })();
  await callback(F, 'handleSendAudio', { audioGenerationRef: { current: 1 }, audioContextRef: { current: 'scope' }, audioContextKey: 'scope', canMutateActiveConversation: false, sendMediaMessage: { mutateAsync: forbidden } })('data', 'audio/ogg', { contextKey: 'scope' });
  assert.equal(writes, 0);
  const unread = one(calls(F, 'useWhatsAppUnread'), 'read marking options').arguments[0];
  const enabled = one(unread.properties.filter(p => p.name?.getText() === 'enabled'), 'read marking enabled');
  const base = { chatSurfaceVisible: true, loadingMessages: false, messagesFailed: false, reconciliationFailed: false, canManageActiveConversation: true };
  assert.equal(evaluate(enabled.initializer.getText(), base), true);
  for (const patch of [{ chatSurfaceVisible: false }, { loadingMessages: true }, { messagesFailed: true }, { reconciliationFailed: true }, { canManageActiveConversation: false }]) assert.equal(evaluate(enabled.initializer.getText(), { ...base, ...patch }), false);
  const bubble = one(jsx(F, 'MessageBubble'), 'floating message bubble');
  const deps = { canMutateActiveConversation: false, item: { message: { stored_media: false } } };
  assert.equal(prop(bubble, 'onReact', deps), undefined); assert.equal(prop(bubble, 'onRetryMedia', deps), undefined);
  const reactDeps = { canMutateActiveConversation: true, activeConversation: { session_id: null }, item: { message: { session_id: 's' } }, canReactToWhatsAppMessage: () => true };
  assert.equal(prop(bubble, 'onReact', reactDeps), undefined);
  assert.equal(prop(bubble, 'onReact', { ...reactDeps, activeConversation: { session_id: 's' }, item: { message: { session_id: null } } }), undefined);
  assert.equal(prop(bubble, 'onRetryMedia', { canMutateActiveConversation: true, item: { message: { media_storage_path: 'durable-object' } } }), undefined, 'stored media refresh must not request provider redownload');
}

export async function waitForSessions() {
  const pending = effect(F, 'const pendingStartKey');
  let requests = [], selectors = [], data = [];
  const ref = { current: null };
  const base = { pendingPhone: '5511999999999', pendingLeadName: 'Synthetic', pendingLeadId: 'lead', pendingStartKeyRef: ref, loadingSessions: false, accessReady: true, canViewWhatsApp: true, currentUserId: 'actor', startupScope: 'scope', intentTenantKey: 'tenant', intentGeneration: 2, originalOrganization: true, sessions: [{ id: 's1', status: 'connected' }], eligibleLeadStartSession: s => s.status === 'connected', handleStartConversationWithSession: async (...args) => { requests.push(args); }, setPendingStartData: item => data.push(item), setShowSessionSelector: open => selectors.push(open), toast() { throw new Error('unexpected missing-session notice'); } };
  const run = patch => evaluate(pending.getText(), { ...base, ...patch })();
  for (const patch of [{ loadingSessions: true }, { accessReady: false }, { canViewWhatsApp: false }]) { run(patch); assert.equal(ref.current, null); }
  assert.equal(requests.length, 0);
  run({}); await Promise.resolve();
  assert.deepEqual(requests, [['5511999999999', 's1', 'Synthetic', 'lead']]);
  run({}); assert.equal(requests.length, 1, 'same intent must not start twice');
  run({ sessions: [{ id: 's1', status: 'connected' }, { id: 's2', status: 'connected' }] });
  assert.deepEqual(selectors, [true]); assert.equal(data[0].leadId, 'lead');
  run({ intentGeneration: 3 }); await Promise.resolve(); assert.equal(requests.length, 2, 'new intentional generation may start');
  run({ pendingPhone: null }); assert.equal(ref.current, null);
  requests = []; selectors = []; data = [];
  run({ sessions: [] }); await Promise.resolve(); assert.equal(requests[0][1], undefined, 'lead start defers own-session connection to guarded handler');
}

export function leadTagIsolation() {
  const item = one(jsx(F, 'ConversationListItem'), 'floating row');
  for (const originalOrganization of [false, true]) for (const allowed of [false, true]) assert.equal(value(F, 'canOperateLeads', { originalOrganization, hasPermission: key => key === 'lead_operate' && allowed }), originalOrganization && allowed);
  const calls = [];
  for (const canOperateLeads of [false, true]) for (const adding of [false, true]) for (const removing of [false, true]) for (const lead of [null, { id: 'lead-A' }]) {
    const deps = { canOperateLeads, conversation: { lead }, addLeadTag: { isPending: adding, mutate: data => calls.push(['add', data]) }, removeLeadTag: { isPending: removing, mutate: data => calls.push(['remove', data]) } };
    const before = calls.length;
    prop(item, 'onAddTag', deps)('tag-1'); prop(item, 'onRemoveTag', deps)('tag-2');
    assert.equal(calls.length - before, canOperateLeads && !adding && !removing && lead ? 2 : 0);
  }
  assert.deepEqual(calls, [['add', { leadId: 'lead-A', tagId: 'tag-1' }], ['remove', { leadId: 'lead-A', tagId: 'tag-2' }]]);
  assert.equal(prop(item, 'canManageTags', { canOperateLeads: true }), true);
  assert.equal(prop(item, 'canOperate', { canOperateWhatsApp: false }), false);
  for (const lead of [null, { id: 'l' }]) for (const canManageTags of [false, true]) assert.equal(value('components/features/whatsapp/conversations/ConversationListItem.tsx', 'canManageConversationTags', { canManageTags, conversation: { lead } }), Boolean(lead) && canManageTags);
}

export function syncActiveMetadata() {
  const synchronize = effect(F, 'const updatedConv = conversations.find');
  const initial = { id: 'c', lead_id: 'l', lead: { id: 'l', name: 'Old' }, unread_count: 2 };
  const refreshed = { ...initial, lead: { ...initial.lead, name: 'New' }, last_message: 'new message' };
  const opened = [], ref = { current: null };
  const base = { activeConversationId: 'c', activeConversation: initial, conversations: [refreshed], pendingConversationLinkRef: ref, intentTenantKey: 'actor:org', intentGeneration: 3, preserveWhatsAppConversationCardSnapshot, openConversation: (...args) => opened.push(args) };
  const run = patch => evaluate(synchronize.getText(), { ...base, ...patch })();
  run({}); assert.equal(opened[0][0], refreshed); assert.deepEqual(opened[0][1], { tenantKey: 'actor:org', generation: 3 });
  opened.length = 0; run({ activeConversation: refreshed }); assert.equal(opened.length, 0, 'same snapshot is not reopened in a loop');
  run({ conversations: [{ ...refreshed, lead_id: 'lead-B', lead: { id: 'lead-B' } }] });
  assert.equal(opened[0][0].lead_id, 'l'); assert.equal(opened[0][0].historical_lead_view, true); assert.equal(opened[0][0].unread_count, 0);
  opened.length = 0; ref.current = { conversationId: 'c', leadId: 'pending-lead' }; run({}); assert.equal(opened.length, 0, 'refresh must not erase pending explicit link');
  const linked = { ...refreshed, lead_id: 'pending-lead' }; run({ conversations: [linked] }); assert.equal(opened[0][0], linked); assert.equal(ref.current, null);
}

export function localizedRetries() {
  const retries = jsx(F, 'Button', n => propText(n, 'onClick').includes('reconciliationFailed ? retryReconciliation() : refetchMessages()'));
  assert.equal(retries.length, 2, 'empty and cached-message failures both expose recovery');
  for (const button of retries) for (const reconciliationFailed of [false, true]) {
    const calls = [];
    prop(button, 'onClick', { reconciliationFailed, retryReconciliation: () => calls.push('reconcile'), refetchMessages: () => calls.push('messages') })();
    assert.deepEqual(calls, [reconciliationFailed ? 'reconcile' : 'messages']);
  }
  const retryList = jsx(F, 'Button', n => propText(n, 'onClick').includes('Promise.all([refetchSessions(), refetchConversations()])'));
  assert.ok(retryList.length >= 1);
  for (const button of retryList) {
    const calls = [];
    prop(button, 'onClick', { refetchSessions: () => calls.push('sessions'), refetchConversations: () => calls.push('conversations') })();
    assert.deepEqual(calls, ['sessions', 'conversations']);
  }
}

export async function mediaRecovery() {
  const events = [];
  await callback(F, 'retryMediaDownload', { canMutateActiveConversation: true, activeOrganization: { organizationId: 'org-A' }, whatsappAPI: { retryMediaDownload: async (...args) => events.push(['backend', ...args]) }, refetchMessages: async () => events.push(['refetch']), toast: notice => events.push(['toast', notice.title]) })('message-A');
  assert.deepEqual(events.slice(0, 2), [['backend', 'message-A', 'org-A'], ['refetch']]);
  for (const [name, kind] of [['retryImage', 'Image'], ['retryVideo', 'Video']]) for (const refresh of [false, true]) {
    const state = [], deps = { onRefreshMedia: refresh ? async () => state.push('refresh') : undefined, onRetryMedia: async () => state.push('backend'), [`set${kind}Error`]: b => state.push(['error', b]), [`set${kind}Loading`]: b => state.push(['loading', b]), setMediaReloadKey: update => state.push(['reload', update(2)]) };
    await callback(MEDIA, name, deps)();
    assert.deepEqual(state, [['error', false], ['loading', true], refresh ? 'refresh' : 'backend', ['reload', 3]]);
  }
  for (const [name, kind] of [['retryImage', 'Image'], ['retryVideo', 'Video']]) {
    const state = [];
    await callback(MEDIA, name, { onRefreshMedia: undefined, onRetryMedia: async () => { throw Error('offline'); }, [`set${kind}Error`]: b => state.push(['error', b]), [`set${kind}Loading`]: b => state.push(['loading', b]), setMediaReloadKey() { throw Error('failed media must not report reload success'); } })();
    assert.deepEqual(state, [['error', false], ['loading', true], ['error', true], ['loading', false]]);
  }
  for (const refresh of [false, true]) {
    const events = [], ref = { current: 3 };
    await callback(AUDIO, 'retryAudio', { onRefreshMedia: refresh ? async () => events.push('refresh') : undefined, onRetryMedia: async () => events.push('backend'), audioFallbackRequestRef: ref, setIsRetryingMedia: b => events.push(['retrying', b]), resetAudioPlayback: () => events.push('reset'), setAudioError: e => events.push(e) })();
    assert.deepEqual(events, [['retrying', true], refresh ? 'refresh' : 'backend', ['retrying', false], 'reset']);
  }
  const stale = [], ref = { current: 1 };
  await callback(AUDIO, 'retryAudio', { onRefreshMedia: async () => { ref.current++; }, onRetryMedia() { throw Error('should prefer refresh'); }, audioFallbackRequestRef: ref, setIsRetryingMedia: b => stale.push(b), resetAudioPlayback: () => stale.push('reset'), setAudioError: e => stale.push(e) })();
  assert.deepEqual(stale, [true], 'stale completion does not reset new audio state');
  const failed = [];
  await callback(AUDIO, 'retryAudio', { onRefreshMedia: undefined, onRetryMedia: async () => { throw Error('offline'); }, audioFallbackRequestRef: { current: 1 }, setIsRetryingMedia: b => failed.push(b), resetAudioPlayback() { throw Error('failed recovery must not reset playback as success'); }, setAudioError: e => failed.push(e) })();
  assert.deepEqual(failed, [true, false, 'Não foi possível recuperar o áudio.']);
  const manual = []; await callback(MEDIA, 'handleManualMediaDownload', { onRetryMedia: async () => manual.push('backend'), isRequestingManualDownload: false, setIsRequestingManualDownload: b => manual.push(b) })();
  assert.deepEqual(manual, [true, 'backend', false]);
  await callback(MEDIA, 'handleManualMediaDownload', { onRetryMedia: async () => { throw Error('double click must be suppressed'); }, isRequestingManualDownload: true })();
}

export function accessibleKeyboard() {
  const surface = {};
  const base = { chatSurfaceRef: { current: surface }, showSessionSelector: false, showAutomationDialog: false, pendingDeleteConversation: null, historySearchOpen: false, activeConversationId: 'conversation' };
  const run = (patch = {}, eventPatch = {}) => {
    const actions = [];
    surface.focus = options => actions.push(['surface-focus', options]);
    const deps = { ...base, clearActiveConversation: () => actions.push('back'), closeChat: () => actions.push('close'), setHistorySearchOpen: value => actions.push(['search', value]), conversationSearchRef: { current: { focus: options => actions.push(['focus', options]) } }, ...patch };
    callback(F, 'handleChatEscape', deps)({ key: 'Escape', composedPath: () => [surface], preventDefault: () => actions.push('prevent'), ...eventPatch }); return actions;
  };
  for (const patch of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { key: 'Enter' }]) assert.deepEqual(run({}, patch), []);
  for (const patch of [{ showSessionSelector: true }, { showAutomationDialog: true }, { pendingDeleteConversation: {} }]) assert.deepEqual(run(patch), []);
  for (const composedPath of [() => [], () => [{}]]) assert.deepEqual(run({}, { composedPath }), [], 'background and unrelated portals keep their native Escape');
  assert.deepEqual(run({ chatSurfaceRef: { current: null } }), []);
  assert.deepEqual(run(), ['prevent', ['surface-focus', { preventScroll: true }], 'back']); assert.deepEqual(run({ activeConversationId: null }), ['prevent', 'close']);
  assert.deepEqual(run({ historySearchOpen: true }), ['prevent', ['search', false], ['focus', { preventScroll: true }]]);
  for (const event of [{ key: 'Enter', nativeEvent: { isComposing: true } }, { key: 'Enter', nativeEvent: { keyCode: 229 } }, { key: 'Enter', shiftKey: true, nativeEvent: {} }, { key: 'a', nativeEvent: {} }]) {
    let sent = 0; callback(F, 'handleKeyPress', { handleSendMessage: () => { sent++; } })({ preventDefault() { throw Error('IME and non-send keys must remain native'); }, ...event }); assert.equal(sent, 0);
  }
  let sent = 0, prevented = 0;
  callback(F, 'handleKeyPress', { handleSendMessage: () => { sent++; } })({ key: 'Enter', nativeEvent: {}, preventDefault: () => { prevented++; } });
  assert.equal(sent, 1); assert.equal(prevented, 1);
  const labels = nodes(F, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && propText(n, 'aria-label'));
  for (const label of ['Chat do WhatsApp', 'Voltar à lista de conversas', 'Fechar chat do WhatsApp', 'Anexar arquivo']) assert.ok(labels.some(n => propText(n, 'aria-label') === JSON.stringify(label)), label);
  assert.ok(nodes(F, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && propText(n, 'inputAriaLabel') === '"Digite sua mensagem"').length);
  const actionPath = 'components/features/whatsapp/ConversationAutomationAction.tsx';
  const component = value(actionPath, 'ConversationAutomationAction', { Loader2: 'spinner', Square: 'stop', Zap: 'start' });
  for (const active of [false, true]) {
    const actions = []; const rendered = component({ loading: false, unavailable: false, active, cancelling: false, onStart: () => actions.push('start'), onCancel: () => actions.push('stop') });
    assert.equal(rendered.props['aria-label'], active ? 'Parar automação ativa' : 'Iniciar automação'); rendered.props.onClick(); assert.deepEqual(actions, [active ? 'stop' : 'start']);
  }
  const listener = evaluate(effect(F, 'document.addEventListener("keydown", handleChatEscape)').getText(), { chatSurfaceVisible: true, isMobile: false, handleChatEscape: 'same-handler', document: { addEventListener: (...args) => assert.deepEqual(args, ['keydown', 'same-handler']), removeEventListener: (...args) => assert.deepEqual(args, ['keydown', 'same-handler']) } });
  const cleanup = listener(); assert.equal(typeof cleanup, 'function'); cleanup();
  const launcher = one(jsx('components/features/chat/FloatingChatButton.tsx', 'Button', n => propText(n, 'aria-controls') === '"floating-whatsapp-chat"'), 'launcher aria owner');
  for (const isOpen of [false, true]) for (const isPresenceOpen of [false, true]) for (const panelPresent of [false, true]) {
    assert.equal(prop(launcher, 'aria-expanded', { state: { isOpen, isPresenceOpen }, panelPresent }), isOpen && !isPresenceOpen && !panelPresent);
  }
}
