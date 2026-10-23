import assert from 'node:assert/strict';
import ts from 'typescript';
import { CONVERSATION_LIST_UI } from '../../../components/features/whatsapp/conversation-list-ui.ts';
import { calls, cn, declaration, evaluate, jsx, nodes, prop, propText, text, value } from './floating-chat-source-fixture.mjs';

const F = 'components/features/chat/FloatingChat.tsx';
const B = 'components/features/chat/FloatingChatButton.tsx';
const M = 'components/features/whatsapp/MessageBubble.tsx';
const MEDIA = 'components/features/whatsapp/message-bubble/MessageMedia.tsx';
const AUDIO = 'components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx';
const ITEM = 'components/features/whatsapp/conversations/ConversationListItem.tsx';
const OLDER = 'components/features/whatsapp/LoadOlderMessagesButton.tsx';
const LATEST = 'components/features/whatsapp/ScrollToLatestButton.tsx';
const CM = 'components/features/whatsapp/conversations/ConversationMessages.tsx';
const one = (items, label) => { assert.equal(items.length, 1, label); return items[0]; };
const attribute = (path, name) => jsx(path, 'div', node => node.attributes.properties.some(p => p.name?.getText() === name));
const labelled = (path, label) => one(jsx(path, 'Button', n => prop(n, 'aria-label') === label && propText(n, 'className').includes('bg-[var(--app-surface-soft)]') && propText(n, 'className').includes('h-9 w-9')), label);
const hasToken = (classes, token) => assert.ok(classes.split(/\s+/).includes(token), `missing ${token} in ${classes}`);

export function compactPresentation() {
  const header = one(jsx(F, 'div', n => propText(n, 'className').includes('h-12 bg-primary/50')), 'list header');
  for (const mobile of [false, true]) {
    const classes = prop(header, 'className', { cn, mobile });
    hasToken(classes, 'bg-primary/50'); hasToken(classes, 'text-primary-foreground');
    if (!mobile) for (const token of ['h-12', 'px-3.5', 'shadow-[0_2px_8px_rgba(0,0,0,0.08)]']) hasToken(classes, token);
  }
  const search = one(jsx(F, 'Input', n => prop(n, 'aria-label') === 'Buscar conversas'), 'search');
  assert.equal(prop(search, 'className', { CONVERSATION_LIST_UI }), CONVERSATION_LIST_UI.search);
  hasToken(CONVERSATION_LIST_UI.search, 'h-8');
  hasToken(CONVERSATION_LIST_UI.search, 'text-[length:var(--app-font-size-caption)]');
  assert.equal(prop(search, 'maxLength'), 180);
  let query; prop(search, 'onChange', { onSearchChange: next => { query = next; } })({ target: { value: 'Ana' } });
  assert.equal(query, 'Ana');
  const launcher = one(jsx(B, 'Button', n => propText(n, 'className').includes('h-14 w-14')), 'launcher');
  const classes = prop(launcher, 'className', { cn, panelPresent: false, isDragging: false });
  for (const token of ['h-14', 'w-14', 'rounded-full', 'bg-primary']) hasToken(classes, token);
  assert.ok(!classes.includes('bg-primary/50'));
  assert.equal(prop(one(jsx(B, 'MessageCircle'), 'launcher icon'), 'className'), 'h-7 w-7');
  const counter = one(jsx(B, 'span', n => propText(n, 'className').includes('h-[26px]')), 'counter');
  for (const token of ['h-[26px]', 'min-w-[26px]', 'text-[12px]']) hasToken(prop(counter, 'className'), token);
  assert.ok(jsx(F, 'div', n => propText(n, 'className').includes('shadow-[0_12px_32px_rgba(0,0,0,0.10)]')).length > 0);
  assert.ok(!nodes(F, n => ts.isStringLiteral(n) && /shadow-\[[^\]]*rgba\(255,69,41,/.test(n.text)).length);
  hasToken(CONVERSATION_LIST_UI.pagination, '[&_svg]:size-3.5');
}

export function metadataAlignment() {
  const tags = one(attribute(ITEM, 'data-conversation-tags'), 'list tags');
  for (const token of ['col-span-3', 'row-start-2', 'flex-nowrap', 'overflow-hidden']) hasToken(prop(tags, 'className'), token);
  assert.ok(jsx(ITEM, 'div', n => /col-start-2 row-start-1/.test(propText(n, 'className'))).some(n => /self-stretch.*justify-center/.test(propText(n, 'className'))));
  const actions = one(jsx(ITEM, 'Button', n => propText(n, 'aria-label').includes('Mais ações de')), 'list actions');
  hasToken(prop(actions, 'className'), 'row-start-1'); hasToken(prop(actions, 'className'), 'self-center');
  const metadata = one(attribute(M, 'data-message-metadata'), 'message metadata');
  hasToken(prop(metadata, 'className'), 'items-end');
  assert.ok(!prop(metadata, 'className').includes('justify-center'));
  const timestamps = nodes(M, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.attributes.properties.some(p => p.name?.getText() === 'data-message-timestamp-position'));
  for (const [position, margin] of [['bottom-left', 'mr-auto'], ['bottom-right', 'ml-auto']]) {
    const stamp = one(timestamps.filter(n => prop(n, 'data-message-timestamp-position') === position), position);
    assert.ok(propText(stamp, 'className').includes(margin));
  }
  for (const file of [MEDIA, AUDIO]) {
    const stamps = nodes(file, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.attributes.properties.some(p => p.name?.getText() === 'data-message-timestamp-position'));
    assert.ok(stamps.length >= 1);
    for (const node of stamps) for (const fromMe of [false, true]) {
      assert.equal(prop(node, 'data-message-timestamp-position', { fromMe }), fromMe ? 'bottom-right' : 'bottom-left');
      const classes = prop(node, 'className', { cn, fromMe });
      if (classes.includes('absolute')) hasToken(classes, fromMe ? 'right-1' : 'left-1');
      else if (fromMe) hasToken(classes, 'ml-auto');
      else assert.ok(!classes.includes('ml-auto'));
    }
  }
  assert.ok(!nodes(M, n => ts.isStringLiteral(n) && n.text.includes('float-right')).length);
  assert.ok(!nodes('components/features/whatsapp/message-bubble/MessageText.tsx', n => ts.isStringLiteral(n) && n.text.includes('w-[65px]')).length);
  const reactions = 'components/features/whatsapp/message-bubble/MessageReactions.tsx';
  assert.ok(!nodes(reactions, n => ts.isStringLiteral(n) && /-(left|right)-9/.test(n.text)).length);
  assert.ok(nodes(reactions, n => ts.isStringLiteral(n) && n.text.includes('relative z-20 inline-flex shrink-0')).length);
}

export function contextChips() {
  const classes = value(F, 'contextChipClassName');
  for (const token of ['min-h-[18px]', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]', 'rounded-[4px]', 'border-0', 'px-1.5', 'text-[9px]', 'font-medium', 'text-white']) hasToken(classes, token);
  const context = one(attribute(F, 'data-floating-chat-context'), 'header context');
  const layout = prop(context, 'className');
  for (const token of ['flex-wrap', 'gap-1.5', 'px-3', 'pb-2.5', 'pt-0.5']) hasToken(layout, token);
  assert.ok(!/flex-nowrap|overflow-hidden/.test(layout));
  const colors = [];
  const colorHelper = color => { colors.push(color); return { color: '#fff', backgroundColor: color }; };
  const styles = nodes(F, n => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && propText(n, 'style').includes('getTagColorStyleWithWhiteText'));
  assert.ok(styles.length >= 2);
  for (const node of styles) {
    const result = prop(node, 'style', { getTagColorStyleWithWhiteText: colorHelper, lt: { tag: { color: '#123456' } }, stageColor: '#654321' });
    assert.equal(result.color, '#fff');
  }
  assert.ok(colors.includes('#123456') && colors.includes('#654321'));
  const pipeline = one(jsx(F, 'Badge', n => propText(n, 'className').includes('bg-primary/10 text-primary')), 'pipeline chip');
  hasToken(prop(pipeline, 'className', { cn, contextChipClassName: classes }), 'bg-primary/10');
}

export function hideOnFullPage() {
  const base = { isOpen: true, accessReady: true, canViewWhatsApp: true, isPresenceOpen: false, pendingPhone: null, activeConversation: null, connectingPendingScope: null, startupScope: 'scope', pathname: '/crm/pipeline' };
  assert.equal(value(F, 'chatVisible', base), true);
  for (const patch of [{ pathname: '/crm/conversas' }, { isOpen: false }, { accessReady: false }, { canViewWhatsApp: false }, { isPresenceOpen: true }, { pathname: '/settings', pendingPhone: '5511', connectingPendingScope: 'scope' }]) assert.equal(value(F, 'chatVisible', { ...base, ...patch }), false);
  assert.equal(value(F, 'shouldSyncFloatingChat', { chatVisible: false }), false);
  assert.equal(value(F, 'shouldSyncFloatingChat', { chatVisible: true }), true);
  assert.ok(nodes(F, n => ts.isPropertyAssignment(n) && n.name.getText() === 'refetchOnWindowFocus' && n.initializer.kind === ts.SyntaxKind.TrueKeyword).length > 0);
}

export function olderFailureRetry() {
  const older = one(jsx(F, 'LoadOlderMessagesButton'), 'floating older loader');
  let loaded = 0, preserved = 0;
  prop(older, 'onClick', { threadScroll: { loadOlderPreservingPosition: load => { preserved++; return load(); } }, loadOlderMessages: () => { loaded++; } })();
  assert.equal(loaded, 1); assert.equal(preserved, 1);
  for (const loading of [false, true]) assert.equal(prop(older, 'loading', { isLoadingOlder: loading }), loading);
  assert.equal(prop(older, 'error', { olderMessagesFailed: true }), true);
  const component = value(OLDER, 'LoadOlderMessagesButton', { Button: 'button', Loader2: 'spinner' });
  const failed = component({ onClick() {}, loading: false, error: true });
  assert.ok(text(failed).includes('Tentar carregar mensagens anteriores'));
  assert.equal(failed.props.disabled, false);
  assert.equal(failed.props['aria-busy'], false);
  const busy = component({ onClick() {}, loading: true, error: false });
  assert.equal(busy.props.disabled, true); assert.equal(busy.props['aria-busy'], true);
  assert.ok(nodes(F, n => ts.isJsxText(n) && n.text.includes('O histórico atual foi mantido')).length);
  // The older-page warning is a sibling, not a replacement for the already loaded timeline.
  const warning = one(nodes(F, n => ts.isJsxText(n) && n.text.includes('O histórico atual foi mantido')), 'preservation warning');
  let branch = warning.parent;
  while (branch && !(ts.isJsxExpression(branch) && branch.expression?.getText().startsWith('olderMessagesFailed &&'))) branch = branch.parent;
  assert.ok(branch); assert.ok(!branch.getText().includes('floatingTimelineItems.map'));
  assert.ok(nodes(F, n => ts.isConditionalExpression(n) && n.condition.getText().includes('(messages?.length ?? 0) === 0')).length);
}

export function incrementalPagination() {
  olderFailureRetry();
  const list = one(jsx(F, 'Button', n => propText(n, 'onClick').includes('loadMoreConversations')), 'list load more');
  let loaded = 0; prop(list, 'onClick', { loadMoreConversations: () => { loaded++; } })(); assert.equal(loaded, 1);
  for (const busy of [false, true]) assert.equal(prop(list, 'disabled', { isLoadingMoreConversations: busy }), busy);
  const page = one(calls(F, 'useWhatsAppConversations'), 'conversation query');
  assert.equal(evaluate(page.arguments[3].getText()), 30);
  const messages = one(calls(F, 'useWhatsAppMessagesPaginated'), 'history query');
  const options = messages.arguments[1];
  const size = one(options.properties.filter(n => n.name?.getText() === 'pageSize'), 'message page size');
  assert.equal(evaluate(size.initializer.getText()), 50);
  for (const key of ['expectedSessionId', 'expectedLeadId', 'historyLeadId', 'onConversationUnavailable']) assert.ok(options.properties.some(p => p.name?.getText() === key), key);
}

export function navigationPresentation() {
  for (const file of [F, CM]) assert.ok(jsx(file, 'LoadOlderMessagesButton').length, `${file}: shared older control`);
  const older = value(OLDER, 'LoadOlderMessagesButton', { Button: 'button', Loader2: 'spinner' })({ onClick() {}, loading: false });
  assert.equal(older.props['data-load-older-messages'], true);
  for (const token of ['bg-primary/50', 'text-primary-foreground', 'border-0', 'rounded-[6px]']) hasToken(older.props.className, token);
  const latest = value(LATEST, 'ScrollToLatestButton', { Button: 'button', ArrowDown: 'icon' });
  let clicked = 0;
  for (const unreadCount of [0, 7, 150]) {
    const rendered = latest({ onClick: () => { clicked++; }, unreadCount });
    assert.equal(rendered.props['data-scroll-to-latest'], true);
    assert.ok(rendered.props['aria-label'].includes('Ir para mensagens mais recentes'));
    if (unreadCount) assert.ok(rendered.props['aria-label'].includes(`${unreadCount} não lidas`));
    rendered.props.onClick();
    if (unreadCount > 99) assert.ok(text(rendered).includes('99+'));
  }
  assert.equal(clicked, 3);
  assert.ok(jsx(F, 'ScrollToLatestButton').length); assert.ok(jsx(CM, 'ScrollToLatestButton').length);
}

export function greyNavigation() {
  for (const [label, handler] of [['Voltar à lista de conversas', 'clearActiveConversation'], ['Fechar chat do WhatsApp', 'closeChat']]) {
    const button = labelled(F, label); let clicked = 0;
    for (const mobile of [false, true]) {
      const classes = prop(button, 'className', { cn, mobile });
      for (const token of ['bg-[var(--app-surface-soft)]', 'hover:bg-[var(--app-surface-muted)]', 'rounded-[6px]', mobile ? 'h-11' : 'h-9']) hasToken(classes, token);
      prop(button, 'onClick', { [handler]: () => { clicked++; } })();
    }
    assert.equal(clicked, 2);
  }
}

export function memoizedBubble() {
  const comparable = value(M, 'comparableMessageBubbleProps');
  const equal = value(M, 'messageBubblePropsAreEqual', { comparableMessageBubbleProps: comparable });
  const first = { content: 'Olá', messageId: 'm1', reactions: [{ emoji: '👍', senderName: 'A', fromMe: true }] };
  assert.equal(equal(first, { ...first, reactions: first.reactions.map(r => ({ ...r })) }), true);
  for (const key of comparable) assert.equal(equal(first, { ...first, [key]: Symbol(key) }), false, `${key}: visible update must render`);
  for (const key of ['onReact', 'onRetryMedia']) {
    assert.equal(equal({ ...first, [key]() {} }, { ...first, [key]() {} }), true, `${key}: callback identity alone is ignored`);
    assert.equal(equal(first, { ...first, [key]() {} }), false, `${key}: enabling action must render`);
  }
  for (const key of ['onReply', 'onRecoverText', 'onCheckSend', 'onOpenLead', 'onDiscardLocal']) assert.equal(equal({ ...first, [key]() {} }, { ...first, [key]() {} }), false, `${key}: behavioral callback must refresh`);
  for (const patch of [{ emoji: '❤️' }, { senderName: 'B' }, { fromMe: false }]) assert.equal(equal(first, { ...first, reactions: [{ ...first.reactions[0], ...patch }] }), false);
  assert.equal(equal(first, { ...first, reactions: [] }), false);
  const memo = declaration(M, 'MessageBubble').initializer;
  assert.equal(memo.expression.getText(), 'memo'); assert.equal(memo.arguments[1].getText(), 'messageBubblePropsAreEqual');
}
