import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { canOperateLeadFromFreshRead } from '../../../lib/lead-operation-capability.ts';

// Execute the actual panel render and callbacks with closed hook reads. No DOM,
// database, provider, service or browser is started by this focused runtime test.
const source = readFileSync(new URL('./ConversationLeadPanel.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ConversationLeadPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imports = ast.statements.filter(ts.isImportDeclaration).flatMap(node => {
  const clause = node.importClause;
  return [clause?.name?.text, ...(clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
    ? clause.namedBindings.elements.map(binding => binding.name.text) : [])].filter(Boolean);
});
const body = ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
  .map(node => node.getText(ast).replace(/^export /, '')).join('\n');
const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const queuePool = { round_robin_id: '11111111-1111-4111-8111-111111111111',
  episode_id: '22222222-2222-4222-8222-222222222222', revision: 4,
  state: 'pool_waiting', reason: 'queue_closed', can_claim: true };
const lead = { id: 'lead-a', organization_id: 'org-a', name: 'Lead sintético', assigned_user_id: 'actor-a',
  phone: null, email: null, tags: [], created_at: '2026-10-16T17:00:00Z', updated_at: '2026-10-16T17:00:00.000001Z',
  deal_status: 'open', can_operate: true, queue_pool: null };
const nodes = (tree, type) => !tree || typeof tree !== 'object' ? [] : [
  ...(tree.type === type ? [tree] : []), ...(tree.props?.children || []).flatMap(child => Array.isArray(child)
    ? child.flatMap(item => nodes(item, type)) : nodes(child, type)),
];
function fixture(options = {}) {
  const requests = [], queryCalls = [];
  const query = { isSuccess: true, isFetchedAfterMount: true, isFetching: false, data: lead, ...options.query };
  const empty = { data: [], isLoading: false, isError: false, refetch() {} };
  const dependencies = Object.fromEntries(imports.map(name => [name, /^[A-Z]/.test(name) ? name : () => undefined]));
  Object.assign(dependencies, {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    canOperateLeadFromFreshRead,
    useState: initial => [initial === '' ? 'Feedback sintético' : initial, () => {}],
    useRef: initial => ({ current: initial }), useLayoutEffect() {},
    useQueryClient: () => ({ invalidateQueries: async value => requests.push(['invalidate', value]) }),
    useAuth: () => ({ activeOrganization: { organizationId: options.organizationId || 'org-a' },
      profile: { organization_id: options.profileOrganizationId || 'org-a' }, user: { id: 'actor-a' } }),
    useUserPermissions: () => ({ hasPermission: () => options.permission !== false }),
    useOrganizationModules: () => ({ hasModule: () => false }),
    useLead: (id, opts) => { queryCalls.push([id, opts]); return query; },
    useConversationLeadDetail: () => ({ data: { ...lead, ...options.detail }, isLoading: false, isError: false, refetch() {} }),
    useTags: () => empty, useProperty: () => ({ data: null }), useProperties: () => empty,
    useUsers: () => empty, useLeadAttachments: () => empty, useScheduleEvents: () => empty,
    useUploadLeadAttachment: () => ({ isPending: false }),
    useUpdateLead: () => ({ isPending: false, mutateAsync: async value => requests.push(['feedback', value]) }),
    useAddLeadTag: () => ({ isPending: false }), useRemoveLeadTag: () => ({ isPending: false }),
    useDealStatusChange: () => ({ isPending: false }),
    toast: { success() {}, error() {} }, cn: (...values) => values.filter(Boolean).join(' '),
    normalizePhoneToE164: value => value || '', formatPhoneForDisplay: value => value,
    formatWhatsAppPersonName: value => value || '', format: () => '16/10/26 14:00',
    getConversationAssigneeLabel: id => id ? 'Corretor atual' : 'Sem responsável',
    getConversationPropertyLabel: () => 'Nenhum',
  });
  const render = Function(...Object.keys(dependencies), `${compiled};return ConversationLeadPanelContent;`)(...Object.values(dependencies));
  const tree = render({ leadId: 'lead-a', onClose() {} });
  return { tree, requests, queryCalls };
}
const feedback = f => nodes(f.tree, 'Textarea').find(node => node.props['aria-label'] === 'Feedback do atendimento do lead');
const save = f => nodes(f.tree, 'Button').find(node => node.props.children.includes('Registrar feedback'));

test('pooled lead replaces reassignment with the canonical claim control and blocks ordinary mutations', async () => {
  const f = fixture({ query: { data: { ...lead, assigned_user_id: null, can_operate: false, queue_pool: queuePool } },
    detail: { assigned_user_id: null } });
  assert.deepEqual(f.queryCalls, [['lead-a', { freshOnMount: true }]]);
  const claim = nodes(f.tree, 'QueuePoolClaimButton');
  assert.equal(claim.length, 1); assert.equal(claim[0].props.lead.queue_pool, queuePool);
  assert.equal(claim[0].props.disabled, false);
  assert.equal(nodes(f.tree, 'Popover').length, 0);
  assert.equal(feedback(f).props.disabled, true); assert.equal(save(f).props.disabled, true);
  await save(f).props.onClick(); assert.deepEqual(f.requests, []);
});

test('pool without claim permission remains read-only and cannot invoke peripheral actions', async () => {
  const pool = { ...queuePool, can_claim: false };
  const f = fixture({ query: { data: { ...lead, assigned_user_id: null, can_operate: false, queue_pool: pool } },
    detail: { assigned_user_id: null, phone: '5511999998888', email: 'synthetic@example.invalid' } });
  const claim = nodes(f.tree, 'QueuePoolClaimButton')[0];
  assert.equal(claim.props.lead.queue_pool.can_claim, false, 'the shared control renders the non-claimable pool label');
  const tags = nodes(f.tree, 'ConversationLeadTagBar')[0];
  assert.equal(tags.props.canManage, false); tags.props.onAdd('tag-a'); tags.props.onRemove('tag-a');
  for (const button of nodes(f.tree, 'Button').filter(node => /Ligar para|Enviar e-mail/.test(node.props['aria-label'] || ''))) {
    assert.equal(button.props.disabled, true);
    button.props.onClick(); // A forced stale gesture must also be guarded.
  }
  assert.deepEqual(f.requests, []);
});

for (const [name, query] of [
  ['cached-before-GET', { isFetchedAfterMount: false }],
  ['refetching', { isFetching: true }],
  ['read-error', { isSuccess: false, isError: true }],
  ['denied', { data: { ...lead, can_operate: false } }],
  ['foreign-tenant', { data: { ...lead, organization_id: 'org-b' } }],
  ['other-lead', { data: { ...lead, id: 'lead-b' } }],
]) test(`panel ${name} cannot operate from a cached DTO or broad permission`, async () => {
  const f = fixture({ query });
  assert.equal(feedback(f).props.disabled, true); assert.equal(save(f).props.disabled, true);
  await save(f).props.onClick(); assert.deepEqual(f.requests, []);
  assert.equal(nodes(f.tree, 'QueuePoolClaimButton').length, 0);
});

for (const query of [{ isFetchedAfterMount: false }, { isFetching: true }, { isSuccess: false }]) {
  test(`cached pool cannot claim before a successful fresh read: ${JSON.stringify(query)}`, () => {
    const f = fixture({ query: { data: { ...lead, assigned_user_id: null, can_operate: false, queue_pool: queuePool }, ...query } });
    const claim = nodes(f.tree, 'QueuePoolClaimButton');
    assert.equal(claim.length, 1); assert.equal(claim[0].props.disabled, true);
    assert.equal(feedback(f).props.disabled, true);
  });
}

test('fresh protected or claimed lead uses explicit server capability and the current owner', async () => {
  const f = fixture({ detail: { assigned_user_id: null }, query: { data: { ...lead, queue_pool: null } } });
  assert.equal(nodes(f.tree, 'QueuePoolClaimButton').length, 0);
  assert.equal(feedback(f).props.disabled, false); assert.equal(save(f).props.disabled, false);
  assert.ok(nodes(f.tree, 'span').some(node => node.props.children.includes('Corretor atual')));
  await save(f).props.onClick(); assert.deepEqual(f.requests, [['feedback', { id: 'lead-a', feedback: 'Feedback sintético' }]]);
});

for (const options of [{ permission: false }, { organizationId: 'org-b' }, { profileOrganizationId: 'org-b' }]) {
  test(`no operation outside the active membership: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); assert.equal(feedback(f).props.disabled, true);
    await save(f).props.onClick(); assert.deepEqual(f.requests, []);
    assert.equal(nodes(f.tree, 'QueuePoolClaimButton').length, 0);
  });
}

test('a pooled cache for another lead or tenant never offers the claim control', async () => {
  for (const patch of [{ id: 'lead-b' }, { organization_id: 'org-b' }]) {
    const f = fixture({ query: { data: { ...lead, assigned_user_id: null, queue_pool: queuePool, ...patch } } });
    assert.equal(nodes(f.tree, 'QueuePoolClaimButton').length, 0);
    assert.equal(feedback(f).props.disabled, true);
    await save(f).props.onClick(); assert.deepEqual(f.requests, []);
  }
});
