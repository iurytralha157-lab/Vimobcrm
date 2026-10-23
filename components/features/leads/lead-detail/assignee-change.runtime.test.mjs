import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryObserver } from '@tanstack/react-query';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration, turn } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { captureLeadRequestIntent } from '../../../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../../../lib/auth/global-sign-out.ts';
import { mergeLeadServerResponse } from '../../../../lib/merge-lead-server-response.ts';
import { mergeLeadOperationCapability } from '../../../../lib/lead-operation-capability.ts';
import { mergeLeadDetailMutation } from './hydrate-lead-detail.ts';
import { VimobAPIError } from '../../../../lib/api/vimob-error.ts';
import { leadFieldOptimismRuntime } from '../../../../hooks/leads/lead-field-optimism-runtime-fixture.mjs';

function fixture({ outsideSchedule = false, availableSchedule = false } = {}) {
  const runtime = leadHookRuntime(), client = runtime.client();
  const { request: requestScope, captureResource: captureDetailOperation } = runtime.distributionScope();
  const lead = { ...runtime.authorizedLead, updated_at: '2026-10-16T10:00:00.000001Z' }, key = ['lead', 'org-a', lead.id];
  let localLead = { ...lead }, serverLead = { ...lead }, confirmation, popover = false, updating = false, reply, availability, readReply;
  const requests = [], notices = [], events = [], completions = [], restores = [];
  const fields = leadFieldOptimismRuntime({ client, lead, getLead: () => localLead,
    setLead: value => { localLead = typeof value === 'function' ? value(localLead) : value; } });
  client.setQueryData(key, lead);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: async () => readReply ? readReply.promise : ({ ...serverLead }), staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => undefined);
  const refs = { assigneeUpdatingRef: { current: false }, assigneeSelectionRef: { current: null } };
  const dependencies = {
    ...refs, canTransferLead: true, canUnassignLead: true, lead, user: runtime.auth.user, session: runtime.auth.session,
    activeOrganization: runtime.auth.activeOrganization, captureDetailOperation, requestScope, captureLeadRequestIntent, getGlobalSignOutSessionId,
    assignableUsers: [{ id: 'actor-b', name: 'Synthetic B' }], teams: outsideSchedule || availableSchedule ? [{ members: [{ id: 'member-b', user_id: 'actor-b' }] }] : [],
    loadAssigneeAvailability: async () => availability ? availability.promise : [], getLeadAssigneeAvailability: () => ({ available: availableSchedule, today: null }),
    setAssigneeScheduleConfirmation: value => { confirmation = value; }, setAssigneePopoverOpen: value => { popover = value; },
    setIsUpdatingAssignee: value => { updating = value; }, setLocalLead: value => { localLead = typeof value === 'function' ? value(localLead) : value; },
    mergeLeadDetailMutation, mergeLeadServerResponse, mergeLeadOperationCapability, queryClient: client, VimobAPIError,
    fieldOptimism: fields.render(), isDefiniteLeadFieldRejection: fields.isDefiniteLeadFieldRejection,
    updatePipelineAssigneeCache: () => [], restorePipelineCache: value => restores.push(value), updatePipelineLeadCache() {},
    refreshPipelineInBackground: (...args) => events.push(args), fullLeadQuery: { refetch: () => client.refetchQueries({ queryKey: key }) },
    toast: { success: value => notices.push(value), error: value => notices.push(value) }, getErrorMessage: error => error.message,
    leadsAPI: { assignLead: async (...args) => {
      requests.push(args); if (reply) return reply.promise;
      if (args[4] !== serverLead.updated_at) throw new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' });
      serverLead = { ...serverLead, assigned_user_id: args[1], updated_at: '2026-10-16T10:01:00.000001Z' };
      return { data: { ...serverLead }, error: null };
    } },
  };
  const handler = name => {
    const bindings = { ...dependencies, localLead, isUpdatingAssignee: updating,
      handleAssignUser: (...args) => { const promise = handler('handleAssignUser')(...args); completions.push(promise); return promise; } };
    delete bindings[name];
    return evaluateProduction('const ' + productionDeclaration(process.env.PIPELINE_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx',
      node => ts.isVariableDeclaration(node) && node.name.getText() === name), bindings, name);
  };
  return {
    requests, notices, events, restores, choose: (id = 'actor-b') => handler('handleAssignUser')(id),
    confirm: async () => { handler('handleConfirmAssignee')(confirmation); await Promise.all(completions); },
    patch: patch => { serverLead = { ...serverLead, ...patch }; localLead = { ...serverLead }; client.setQueryData(key, localLead); },
    patchLocal: patch => { localLead = { ...localLead, ...patch }; },
    canonical: async () => fields.canonical(),
    replace: () => { runtime.switchTo('org-b', 'actor-b', 'sid-b'); runtime.distributionScope();
      dependencies.fieldOptimism = fields.render({ organizationId: 'org-b', actorId: 'actor-b', sessionId: 'sid-b' }); },
    retiredCallback: () => handler('handleAssignUser'),
    state: () => ({ localLead, serverLead, confirmation, popover, updating }),
    deferReply: () => reply = deferred(), deferAvailability: () => availability = deferred(), holdReads: () => readReply = deferred(),
    close: () => { readReply?.resolve(serverLead); fields.close(); unsubscribe(); runtime.close(); },
  };
}

test('assignment sends the exact microsecond revision selected before any asynchronous work', async () => {
  const f = fixture();
  try {
    await f.choose(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0][4], '2026-10-16T10:00:00.000001Z');
    assert.equal(f.requests[0][3].expectedSessionId, 'sid-a'); assert.equal(f.state().serverLead.assigned_user_id, 'actor-b');
  } finally { f.close(); }
});

test('schedule confirmation cannot rebase the selected revision after another transfer', async () => {
  const f = fixture({ outsideSchedule: true });
  try {
    const availability = f.deferAvailability(), choosing = f.choose();
    f.patch({ assigned_user_id: 'actor-c', updated_at: '2026-10-16T10:00:00.000002Z' }); availability.resolve([]); await choosing;
    assert.equal(f.requests.length, 0); assert.ok(f.state().confirmation);
    await f.confirm(); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0][4], '2026-10-16T10:00:00.000001Z');
    assert.equal(f.state().serverLead.assigned_user_id, 'actor-c'); assert.equal(f.state().popover, true); assert.deepEqual(f.events, []);
    assert.match(f.notices[0], /atualizado em outra sessão/);
    await turn(); assert.equal(f.requests.length, 1);
  } finally { f.close(); }
});

test('schedule confirmation from a retired organization/session cannot dispatch', async () => {
  const f = fixture({ outsideSchedule: true });
  try { await f.choose(); f.replace(); await f.confirm(); assert.equal(f.requests.length, 0); assert.match(f.notices[0], /seleção expirou/); }
  finally { f.close(); }
});

test('double selection cannot dispatch twice while the first assignment is pending', async () => {
  const f = fixture();
  try {
    const reply = f.deferReply(), first = f.choose(); await turn(); await f.choose(); assert.equal(f.requests.length, 1);
    reply.resolve({ data: f.state().serverLead, error: null }); await first; assert.equal(f.state().updating, false);
  } finally { f.close(); }
});

test('a callback retained before scope replacement cannot start a new transfer or leak an exception', async () => {
  const f = fixture();
  try { const old = f.retiredCallback(); f.replace(); await old('actor-b'); assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, []); }
  finally { f.close(); }
});

test('assignment rejection restores only assignee fields and preserves a tag restored by another operation', async () => {
  const f = fixture();
  try {
    f.holdReads(); const reply = f.deferReply(), pending = f.choose(); await turn();
    assert.equal(f.state().localLead.assigned_user_id, 'actor-b');
    f.patchLocal({ tags: [{ id: 'restored-tag', name: 'Restored' }], name: 'Fresh name', deal_status: 'won', whatsapp_avatar_url: 'fresh', valor_interesse: 42 });
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending;
    const lead = f.state().localLead; assert.equal(lead.assigned_user_id, 'actor-a');
    assert.deepEqual(lead.tags, [{ id: 'restored-tag', name: 'Restored' }]); assert.equal(lead.name, 'Fresh name');
    assert.equal(lead.deal_status, 'won'); assert.equal(lead.whatsapp_avatar_url, 'fresh'); assert.equal(lead.valor_interesse, 42);
    assert.equal(f.restores.length, 1);
  } finally { f.close(); }
});

test('assignment applies over tag rollback that completed while availability was loading', async () => {
  const f = fixture({ availableSchedule: true });
  try {
    f.holdReads(); const reply = f.deferReply(), availability = f.deferAvailability(), pending = f.choose();
    f.patchLocal({ tags: [{ id: 'restored-during-wait' }], name: 'Fresh during availability' });
    availability.resolve([]); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.state().localLead.assigned_user_id, 'actor-b');
    assert.deepEqual(f.state().localLead.tags, [{ id: 'restored-during-wait' }]);
    assert.equal(f.state().localLead.name, 'Fresh during availability');
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending;
    assert.deepEqual(f.state().localLead.tags, [{ id: 'restored-during-wait' }]);
  } finally { f.close(); }
});

for (const status of [undefined, 408, 500]) test(`assignment uncertain ${status} failure does not invent popup or board rollback`, async () => {
  const f = fixture();
  try {
    f.holdReads(); const reply = f.deferReply(), pending = f.choose(); await turn();
    const before = f.state().localLead;
    reply.reject(status ? new VimobAPIError('Unknown outcome', { status }) : new TypeError('Connection lost')); await pending;
    assert.equal(f.state().localLead, before); assert.equal(f.restores.length, 0);
  } finally { f.close(); }
});

test('assignment identical canonical read fences both popup and board rollback', async () => {
  const f = fixture();
  try {
    const reply = f.deferReply(), pending = f.choose(); await turn();
    assert.equal(await f.canonical(), true); const before = f.state().localLead; f.holdReads();
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending;
    assert.equal(f.state().localLead, before); assert.equal(f.restores.length, 0);
  } finally { f.close(); }
});

test('assignment late rejection cannot change replacement organization state', async () => {
  const f = fixture();
  try {
    const reply = f.deferReply(), pending = f.choose(); await turn(); f.replace();
    f.patchLocal({ name: 'Replacement', tags: [{ id: 'replacement' }] }); const before = f.state().localLead;
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending;
    assert.equal(f.state().localLead, before); assert.equal(f.restores.length, 0); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});
