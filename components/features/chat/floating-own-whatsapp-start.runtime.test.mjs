import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('FloatingChat.tsx', readFileSync(new URL('./FloatingChat.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) nodes.set(node.name.text, node);
  if (ts.isFunctionDeclaration(node) && node.name) nodes.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(source);
function compile(name, dependencies) {
  const node = nodes.get(name);
  assert.ok(node, `actual declaration ${name}`);
  const code = ts.transpileModule(ts.isVariableDeclaration(node) ? `const ${node.getText(source)};` : node.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return Function(...Object.keys(dependencies), `${code};return ${name};`)(...Object.values(dependencies));
}
const helpers = {};
Function('exports', ts.transpileModule(readFileSync(new URL('../../../lib/whatsapp-message-input.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(helpers);
const ownStartHelpers = {};
Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../../../lib/whatsapp-own-start.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(() => helpers, ownStartHelpers);
const actor = 'user-own';
const own = { id: 'own-A', owner_user_id: actor, status: 'connected', can_send: true, provider: 'evolution_go' };
const ownB = { ...own, id: 'own-B' };
const shared = { ...own, id: 'shared', owner_user_id: 'user-other' };
const legacy = { ...own, id: 'legacy', provider: 'evolution' };
const eligibleLeadStartSession = compile('eligibleLeadStartSession', {});

function connected(sessions) {
  if (nodes.has('connectedSessions')) return compile('connectedSessions', { sessions, currentUserId: actor, getOwnWhatsAppStartNotice: helpers.getOwnWhatsAppStartNotice });
  return sessions.filter(item => item.owner_user_id === actor && item.status === 'connected' && item.can_send !== false && item.provider !== 'evolution');
}
function selection(sessions, pendingStartData) {
  return compile('startSelectionSessions', { sessions, currentUserId: actor, originalOrganization: true,
    pendingStartData, eligibleLeadStartSession, getOwnWhatsAppStartNotice: helpers.getOwnWhatsAppStartNotice });
}
test('actual own-session list excludes the retired Evolution provider', () => {
  assert.deepEqual(connected([own, legacy, shared]).map(item => item.id), ['own-A']);
});
test('actual own-only selector cannot offer a shared or retired-provider session', () => {
  assert.deepEqual(selection([own, ownB, shared, legacy], { leadId: 'lead-A', ownOnly: true }).map(item => item.id), ['own-A', 'own-B']);
});
test('ordinary selector preserves the existing authorized shared-session option', () => {
  assert.ok(selection([own, shared], { leadId: 'lead-A' }).some(item => item.id === 'shared'));
});
test('the actual own-only selection handler rejects a forged shared session', () => {
  const calls = [];
  const pendingStartData = { phone: '+5511999999999', leadId: 'lead-A', ownOnly: true };
  const handle = compile('handleSessionSelect', { pendingStartData, currentUserId: actor, originalOrganization: true,
    sessions: [own, ownB, shared], startSelectionSessions: [own, ownB], canOperateWhatsApp: true,
    eligibleLeadStartSession, getOwnWhatsAppStartNotice: helpers.getOwnWhatsAppStartNotice,
    setShowSessionSelector: () => {}, setPendingStartData: () => {}, toast: () => {},
    handleStartConversationWithSession: (...args) => calls.push(args) });
  handle(shared);
  assert.deepEqual(calls, []);
});
test('the actual ordinary selection handler still permits an eligible shared session', () => {
  const calls = [];
  const pendingStartData = { phone: '+5511999999999', leadId: 'lead-A' };
  const handle = compile('handleSessionSelect', { pendingStartData, currentUserId: actor, originalOrganization: true,
    sessions: [own, shared], startSelectionSessions: [own, shared], canOperateWhatsApp: true,
    eligibleLeadStartSession, getOwnWhatsAppStartNotice: helpers.getOwnWhatsAppStartNotice,
    setShowSessionSelector: () => {}, setPendingStartData: () => {}, toast: () => {},
    handleStartConversationWithSession: (...args) => calls.push(args) });
  handle(shared);
  assert.deepEqual(calls, [['+5511999999999', 'shared', undefined, 'lead-A']]);
});

function harness(sessions = [own], overrides = {}) {
  const calls = [], states = [];
  const conversation = { id: 'history-A', lead_id: 'lead-A', session_id: 'shared', is_group: false };
  const dependencies = { activeConversationLeadId: 'lead-A', activeConversation: conversation,
    activeConversationId: 'history-A', activeConversationRef: { current: conversation },
    intentTenantKey: 'user-own:org-A', intentGeneration: 1, isIntentCurrent: () => true,
    startupScope: 'scope-A', startupScopeRef: { current: 'scope-A' }, canOperateWhatsApp: true,
    originalOrganization: true, currentUserId: actor, sessions, connectedSessions: connected(sessions),
    startSelectionSessions: connected(sessions), isStartingConversation: false,
    ownStartNotice: ownStartHelpers.getOwnWhatsAppStartNotice({ conversation, sessions, currentUserId: actor, canOperate: true, loadingSessions: false }),
    ownStartInFlightRef: { current: false }, setIsStartingConversation: value => states.push(value),
    conversationLeadDetailAPI: { get: async (...args) => { calls.push(['lead', ...args]); return { id: 'lead-A', phone: '+5511988888888', name: 'Lead atual' }; } },
    activeOrganization: { organizationId: 'org-A' }, normalizePhoneToE164: value => value,
    handleStartConversationWithSession: async (...args) => calls.push(['start', ...args]),
    setPendingStartData: value => calls.push(['selector-data', value]),
    setShowSessionSelector: value => calls.push(['selector', value]), toast: value => calls.push(['toast', value]),
    getOwnWhatsAppStartNotice: helpers.getOwnWhatsAppStartNotice, ...overrides };
  return { calls, states, dependencies, run: compile('requestOwnWhatsAppStart', dependencies) };
}
test('actual own start loads the current lead phone and uses only the owned session', async () => {
  const h = harness(); await h.run();
  assert.deepEqual(h.calls.filter(call => call[0] === 'start'), [['start', '+5511988888888', 'own-A', 'Lead atual', 'lead-A', true]]);
});
test('actual own start with multiple own sessions carries the own-only intent', async () => {
  const h = harness([own, ownB, shared]); await h.run();
  assert.equal(h.calls.find(call => call[0] === 'selector-data')?.[1].ownOnly, true);
});
test('actual own start never opens a shared-session selector when no own session is connected', async () => {
  const h = harness([shared]); await h.run();
  assert.equal(h.calls.some(call => ['start', 'selector', 'selector-data'].includes(call[0])), false);
});
test('actual own start cannot prepare after the access context changes during the lead GET', async () => {
  const scopeRef = { current: 'scope-A' };
  const h = harness([own], { startupScopeRef: scopeRef,
    conversationLeadDetailAPI: { get: async () => { scopeRef.current = 'scope-B'; return { phone: '+5511988888888', name: 'Outro' }; } } });
  await h.run(); assert.equal(h.calls.some(call => call[0] === 'start'), false);
});
test('actual own start remains blocked outside the permitted original-organization operation', async () => {
  const h = harness([own], { canOperateWhatsApp: false }); await h.run(); assert.deepEqual(h.calls, []);
});
test('the actual own-only preparation never accepts a historical projection as a send route', async () => {
  const calls = [];
  const intent = { tenantKey: 'actor:org', generation: 1 };
  const history = { id: 'historical', session_id: own.id, lead_id: 'lead-A', historical_lead_view: true };
  const dependencies = { intentTenantKey: intent.tenantKey, intentGeneration: intent.generation,
    isIntentCurrent: () => true, startupScope: 'scope-A', startupScopeRef: { current: 'scope-A' },
    startRequestGenerationRef: { current: 0 }, setVisibleStartRequestGeneration: () => {},
    originalOrganization: true, currentUserId: actor, sessions: [own], canOperateWhatsApp: true,
    normalizePhoneToE164: value => value, setIsStartingConversation: () => {},
    activeOrganization: { organizationId: 'org-A' },
    whatsappAPI: { findConversation: async () => history },
    findConversation: { mutateAsync: async () => ({ id: 'physical', session_id: own.id, lead_id: 'lead-B' }) },
    setSelectedSessionId: () => {}, openConversation: value => calls.push(['open', value]),
    clearActiveConversation: () => {}, clearPendingMessage: () => {}, toast: value => calls.push(['toast', value]),
    getWhatsAppPhoneChangeConfirmation: () => null, VimobAPIError: class extends Error {},
    getWhatsAppStartErrorMessage: error => error.message, console: { error: () => {} },
    startConversation: { mutateAsync: async () => { calls.push(['prepare']); return { id: 'new' }; } },
  };
  await compile('handleStartConversationWithSession', dependencies)('+5511999999999', own.id, 'Lead A', 'lead-A', true);
  assert.equal(calls.some(call => call[0] === 'open'), false);
  assert.equal(calls.some(call => call[0] === 'prepare'), false);
  assert.equal(calls.some(call => call[0] === 'toast'), true);
});
for (const ownOnly of [true, false]) test(`the actual phone confirmation preserves own-session intent ${ownOnly}`, async () => {
  const calls = [];
  const target = { ownOnly, phone: '+5511999999999', leadName: 'Lead A', intent: { tenantKey: 'actor:org', generation: 1 },
    confirmation: { leadId: 'lead-A', sessionId: 'own-A', conversationId: 'old-A', requiresDestinationHistoryConfirmation: false } };
  const handle = compile('confirmPhoneChange', { pendingPhoneChange: target, phoneChangeCurrent: () => true,
    phoneChangePreviewMatches: () => true, startConversation: { isPending: false,
      mutateAsync: async body => { calls.push(body); return { id: 'new-A' }; } },
    setPhoneChangeError: () => {}, setPendingPhoneChange: () => {}, openConversation: () => {},
    getWhatsAppStartErrorMessage: error => error.message });
  await handle(); assert.equal(calls[0].ownSessionOnly, ownOnly ? true : undefined);
  assert.equal(calls[0].confirmPhoneChange, true);
});
for (const ownOnly of [true, false]) test(`the actual history-link confirmation preserves own-session intent ${ownOnly}`, async () => {
  const calls = [];
  const target = { ownOnly, phone: '+5511999999999', leadName: 'Lead A', leadId: 'lead-A', sessionId: own.id,
    conversation: { id: 'unlinked-A', session_id: own.id, lead_id: null } };
  const preview = { conversationId: 'unlinked-A', sessionId: own.id, leadId: 'lead-A', expectedPreviousLeadId: helpers.WHATSAPP_UNLINKED_LEAD_SNAPSHOT };
  const dependencies = { intentTenantKey: 'actor:org', intentGeneration: 1, startupScope: 'scope-A',
    startupScopeRef: { current: 'scope-A' }, isIntentCurrent: () => true, currentUserId: actor, sessions: [own],
    pendingLeadLink: target, leadLinkPreview: preview, leadLinkPreviewFailed: false,
    ...helpers, linkConversationToLead: { isPending: false, mutateAsync: async body => { calls.push(['link', body]); return { bindingMode: 'history_only' }; } },
    leadLinkPreviewRequestRef: { current: 0 }, setPendingLeadLink: () => {}, setLeadLinkPreview: () => {},
    startConversation: { mutateAsync: async body => { calls.push(['prepare', body]); return { id: 'new-A' }; } },
    setSelectedSessionId: () => {}, openConversation: () => {}, toast: () => {} };
  await compile('confirmPendingLeadLink', dependencies)();
  assert.equal(calls.find(call => call[0] === 'link')[1].ownSessionOnly, ownOnly ? true : undefined);
  assert.equal(calls.find(call => call[0] === 'prepare')[1].ownSessionOnly, ownOnly ? true : undefined);
});
