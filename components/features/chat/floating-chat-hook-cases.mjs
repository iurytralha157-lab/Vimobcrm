import assert from 'node:assert/strict';
import { createWhatsAppDraftStore, getWhatsAppDraftOwner } from '../../../lib/whatsapp-draft-store.ts';
import { getWhatsAppConversationDraftKey } from '../../../lib/whatsapp-message-input.ts';
import { getWhatsAppSendFailureStatus } from '../../../lib/whatsapp-query-cache.ts';
import { callback, calls, effect, evaluate, hookFixture, jsx, prop, value } from './floating-chat-source-fixture.mjs';

const F = 'components/features/chat/FloatingChat.tsx';
const DRAFT = 'hooks/use-whatsapp-conversation-draft.ts';
const SCROLL = 'hooks/use-whatsapp-thread-scroll.ts';

export async function scopedDraftsAndRollback() {
  for (const file of [F, 'components/features/whatsapp/ConversationsScreen.tsx']) assert.equal(calls(file, 'useWhatsAppConversationDraft').length, 1);
  const floatingArgs = calls(F, 'useWhatsAppConversationDraft')[0].arguments;
  const scope = { organizationId: 'org-A', userId: 'actor-A', accessScope: 'sid' };
  assert.equal(evaluate(floatingArgs[0].getText(), { whatsappQueryScope: scope }), scope);
  assert.equal(evaluate(floatingArgs[1].getText(), { activeConversationId: 'conversation-A' }), 'conversation-A');
  assert.equal(evaluate(floatingArgs[2].getText(), { activeConversationMessageScope: { expectedLeadId: 'lead-A' } }), 'lead-A');
  const pageArgs = calls('components/features/whatsapp/ConversationsScreen.tsx', 'useWhatsAppConversationDraft')[0].arguments;
  assert.equal(evaluate(pageArgs[2].getText(), { activePlatform: 'whatsapp', selectedExpectedLeadId: 'lead-B' }), 'lead-B');
  const store = createWhatsAppDraftStore();
  const fixture = hookFixture(DRAFT, { getWhatsAppConversationDraftKey, getWhatsAppDraftOwner, getWhatsAppDraftStore: () => store });
  const owner = { organizationId: 'org-A', userId: 'actor-A', accessScope: 'role:broker:sid1', draftAccessScope: 'role:broker' };
  let a = fixture.render(owner, 'conversation-A', 'lead-A'); a.setText('draft-A');
  let b = fixture.render(owner, 'conversation-B', 'lead-B'); assert.equal(b.text, ''); b.setText('draft-B');
  a.setText('stale'); b = fixture.render(owner, 'conversation-B', 'lead-B'); assert.equal(b.text, 'draft-B');
  a = fixture.render(owner, 'conversation-A', 'lead-A'); assert.equal(a.text, 'draft-A');
  const oldSid = a;
  const renewed = { ...owner, accessScope: 'role:broker:sid2' };
  a = fixture.render(renewed, 'conversation-A', 'lead-A'); assert.equal(a.text, 'draft-A');
  oldSid.setText('old session'); oldSid.clearConversation('conversation-A');
  oldSid.setConversationDraft('conversation-A', 'lead-A', 'old session');
  a = fixture.render(renewed, 'conversation-A', 'lead-A'); assert.equal(a.text, 'draft-A');
  const rebound = fixture.render(renewed, 'conversation-A', 'lead-C'); assert.equal(rebound.text, ''); rebound.setText('card-C');
  a.setText('stale lead'); assert.equal(fixture.render(renewed, 'conversation-A', 'lead-C').text, 'card-C');
  assert.equal(fixture.render(renewed, 'conversation-A', 'lead-A').text, 'draft-A');
  const other = { ...renewed, organizationId: 'org-B' };
  assert.equal(fixture.render(other, 'conversation-A', 'lead-A').text, '');
  assert.equal(store.get(getWhatsAppConversationDraftKey({ tenantKey: getWhatsAppDraftOwner({ ...owner, accessScope: owner.draftAccessScope }), conversationId: 'conversation-A', expectedLeadId: 'lead-A' })), '', 'previous tenant drafts cleared at owner transition');
  assert.equal(fixture.render({ ...other, userId: 'actor-B' }, 'conversation-A', 'lead-A').text, ''); fixture.close();

  for (const status of [400, 503]) {
    let text = 'original', writes = 0, join;
    const refs = { audioGenerationRef: { current: 1 }, audioContextRef: { current: 'scope-A' } };
    const pendingJoin = new Promise(resolve => { join = resolve; });
    const deps = { ...refs, messageText: ' original ', canMutateActiveConversation: true, activeConversation: { id: 'c', lead_id: 'l' }, audioContextKey: 'scope-A', whatsappMessageInputState: { disabled: false, sendSessionId: 'session-A' }, isReadOnlyMode: false, attendanceGate: { ensureJoined: () => pendingJoin }, replyTarget: null, getWhatsAppSendFailureStatus, setMessageText: next => { text = typeof next === 'function' ? next(text) : next; }, setReplySelection() {}, sendMessage: { isPending: false, mutateAsync: async payload => { writes++; assert.equal(text, ''); assert.equal(payload.text, 'original'); assert.equal(payload.sendSessionId, 'session-A'); throw { status }; } } };
    const promise = callback(F, 'handleSendMessage', deps)();
    assert.equal(text, 'original', 'attendance still pending keeps draft'); assert.equal(writes, 0);
    join(true); await promise;
    assert.equal(writes, 1); assert.equal(text, status === 400 ? 'original' : '', 'only definitive failure restores draft to avoid uncertain duplicate send');
  }
  for (const phase of ['join', 'mutation']) {
    let text = 'original', sends = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const refs = { audioGenerationRef: { current: 1 }, audioContextRef: { current: 'scope-A' } };
    const deps = { ...refs, messageText: text, canMutateActiveConversation: true, activeConversation: { id: 'c' }, audioContextKey: 'scope-A', whatsappMessageInputState: { disabled: false }, isReadOnlyMode: false, attendanceGate: { ensureJoined: async () => phase === 'join' ? await gate : true }, replyTarget: null, getWhatsAppSendFailureStatus, setMessageText: next => { text = typeof next === 'function' ? next(text) : next; }, setReplySelection() {}, sendMessage: { isPending: false, mutateAsync: async () => { sends++; await gate; throw { status: 400 }; } } };
    const pending = callback(F, 'handleSendMessage', deps)(); await Promise.resolve(); await Promise.resolve();
    refs.audioContextRef.current = 'scope-B'; refs.audioGenerationRef.current++;
    text = 'new-context'; release(true); await pending;
    assert.equal(text, 'new-context'); assert.equal(sends, phase === 'join' ? 0 : 1);
  }
  let text = 'original';
  await callback(F, 'handleSendMessage', { audioGenerationRef: { current: 1 }, audioContextRef: { current: 's' }, audioContextKey: 's', messageText: 'original', canMutateActiveConversation: true, activeConversation: { id: 'c' }, isReadOnlyMode: false, whatsappMessageInputState: { disabled: false }, attendanceGate: { ensureJoined: async () => true }, replyTarget: null, setMessageText: next => { text = typeof next === 'function' ? next(text) : next; }, getWhatsAppSendFailureStatus, sendMessage: { isPending: false, mutateAsync: async () => { text = 'typed while sending'; throw { status: 400 }; } } })();
  assert.equal(text, 'typed while sending', 'failure must not overwrite newer typing');
}

export async function viewportAndCleanup() {
  let absoluteTop = 300, nextFrame = 1, disconnected = 0, observed = 0;
  const frames = new Map(), cancelled = [], followed = [], queries = [];
  const viewport = { clientWidth: 300, clientHeight: 100, scrollHeight: 1000, scrollTop: 300,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    querySelector: () => null,
    querySelectorAll: () => [{ dataset: { threadItemId: 'm1' }, getBoundingClientRect: () => ({ top: absoluteTop - viewport.scrollTop, bottom: absoluteTop - viewport.scrollTop + 30 }) }],
  };
  const window = { requestAnimationFrame: fn => { const id = nextFrame++; frames.set(id, fn); return id; }, cancelAnimationFrame: id => { cancelled.push(id); frames.delete(id); } };
  class ResizeObserver { constructor(callback) { this.callback = callback; } observe() { observed++; } disconnect() { disconnected++; } }
  const fixture = hookFixture(SCROLL, { window, ResizeObserver });
  const scrollRef = { current: { querySelector: query => { queries.push(query); return viewport; } } };
  const bottomRef = { current: { scrollIntoView: options => followed.push(options) } };
  const render = (scope = 'org-A:conversation-A:lead-A', options = {}) => fixture.render(scope, 'last', scrollRef, bottomRef, { radixViewport: true, enabled: true, ...options });
  let state = render(); assert.deepEqual(followed[0], { behavior: 'instant', block: 'end' });
  state.onScroll({}); state = render(); assert.equal(state.showScrollToLatest, true);
  assert.ok(queries.every(query => query === '[data-radix-scroll-area-viewport]'));
  const follows = followed.length;
  await state.loadOlderPreservingPosition(async () => { absoluteTop += 200; viewport.scrollHeight += 200; });
  assert.equal(frames.size, 1);
  const [frame, restore] = frames.entries().next().value; frames.delete(frame); restore();
  assert.equal(viewport.scrollTop, 500, 'visible message anchor stays at the same relative position after prepend');
  assert.equal(followed.length, follows, 'loading older does not jump to newest');
  state.scrollToLatest(); assert.deepEqual(followed.at(-1), { behavior: 'instant', block: 'end' });
  assert.equal(render().showScrollToLatest, false);
  await state.loadOlderPreservingPosition(async () => {}); assert.equal(frames.size, 1);
  const pendingFrame = frames.keys().next().value;
  const stale = state;
  render('org-B:conversation-B:lead-B'); assert.ok(cancelled.includes(pendingFrame), 'tenant transition cancels pending restoration');
  const before = followed.length; stale.scrollToLatest(); assert.equal(followed.length, before, 'stale scope cannot scroll new thread');
  let loaded = 0; await stale.loadOlderPreservingPosition(async () => { loaded++; }); assert.equal(loaded, 0);
  const disabled = render('org-B:conversation-B:lead-B', { enabled: false });
  disabled.scrollToLatest(); await disabled.loadOlderPreservingPosition(async () => { loaded++; }); assert.equal(loaded, 0);
  fixture.close(); assert.equal(frames.size, 0); assert.ok(observed > 0 && disconnected > 0);

  const options = calls(F, 'useWhatsAppThreadScroll')[0].arguments[4];
  assert.ok(evaluate(options.properties.find(n => n.name.getText() === 'radixViewport').initializer.getText()));
  const bindings = jsx(F, 'FloatingMessagesViewport')[0];
  let scrolled = 0;
  prop(bindings, 'onScroll', { threadScroll: { onScroll: () => { scrolled++; } } })(); assert.equal(scrolled, 1);
  const component = value(F, 'FloatingMessagesViewport', { ScrollArea: 'scroll', ScrollToLatestButton: 'latest' });
  const rendered = component({ children: 'messages', scrollAreaRef: scrollRef, onScroll: 'scroll-handler', showScrollToLatest: true, onScrollToLatest: 'latest-handler', unreadCount: 3 });
  const [area, latest] = rendered.props.children;
  assert.equal(area.props.ref, scrollRef); assert.equal(area.props.onScrollCapture, 'scroll-handler');
  assert.equal(latest.props.onClick, 'latest-handler'); assert.equal(latest.props.unreadCount, 3);
  for (const [path, marker, dependencies] of [
    [F, 'const wasChatVisible = wasChatVisibleRef.current', { wasChatVisibleRef: { current: false }, chatSurfaceVisible: true, focusChatSurface() {} }],
    [F, 'messageInputRef.current?.focus({ preventScroll: true })', { chatSurfaceVisible: true, isMobile: false, activeConversationId: 'c', canMutateActiveConversation: true, restoringFromFilterPanelRef: { current: false }, messageInputRef: { current: { focus() {} } } }],
    ['components/features/chat/FloatingChatButton.tsx', 'const wasChatOpen = wasChatOpenRef.current', { wasChatOpenRef: { current: true }, state: { isOpen: false, isPresenceOpen: false }, panelPresent: false, btnRef: { current: { focus() {} } } }],
  ]) {
    const cleanup = evaluate(effect(path, marker).getText(), { window, ...dependencies })();
    assert.equal(typeof cleanup, 'function'); assert.equal(frames.size, 1); cleanup(); assert.equal(frames.size, 0);
  }
}
