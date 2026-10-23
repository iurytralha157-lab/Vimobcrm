import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { evaluateProduction, productionDeclaration, deferred } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { getGlobalSignOutSessionId } from '../../../../lib/auth/global-sign-out.ts';
import { mergeLeadDetailMutation } from './hydrate-lead-detail.ts';

// Actual confirmation hook and popup callbacks. No network, DOM or business writes.
function fixture(status = 'open') {
  const client = new QueryClient(), slots = [];
  let cursor = 0, blocked = false, permission = true, mounted = true;
  const token = (actor, sid) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid })).toString('base64url')}.synthetic`;
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  const changed = (a, b) => !a || b.some((value, index) => value !== a[index]);
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
    useMemo(build, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect(setup, deps) { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
  };
  const scopeHook = evaluateProduction(productionDeclaration('hooks/leads/use-lead-detail-operation-scope.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadDetailOperationScope'), react, 'useLeadDetailOperationScope');
  const hook = evaluateProduction(productionDeclaration('hooks/leads/use-lead-status-confirmation.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadStatusConfirmation'), {
    ...react, useQueryClient: () => client, useAuth: () => auth, useUserPermissions: () => ({ hasPermission: () => permission }),
    useLeadDetailOperationScope: scopeHook, getGlobalSignOutSessionId, emptyDraft: () => ({ selectedReason: '', details: '' }),
  }, 'useLeadStatusConfirmation');
  let lead = { id: 'lead-a', name: 'Synthetic', organization_id: 'org-a', assigned_user_id: 'actor-a', can_operate: true,
    stage_id: 'stage-a', deal_status: status, updated_at: '2026-10-16T10:00:00.000001Z', property_id: 'property-a', valor_interesse: 100 };
  let localLead = { ...lead }, serverLead = { ...lead }, confirmation, lostOpen = false, pendingStage = null, reply;
  let currentHook, currentHandlers, writes = 0, closed = false;
  const requests = [], notices = [], refs = { statusSubmittingRef: { current: false } };
  const setLocalLead = value => { localLead = typeof value === 'function' ? value(localLead) : value; };
  const statusMutation = { isPending: false, mutateAsync: async input => {
    requests.push(input);
    if (reply) return reply.promise;
    // A synthetic authoritative server enforces the unchanged revision contract.
    if (input.expectedUpdatedAt !== serverLead.updated_at) throw new Error('Version conflict');
    writes++; serverLead = { ...serverLead, deal_status: input.newStatus, updated_at: '2026-10-16T10:01:00.000001Z' };
    return { lead: serverLead };
  } };
  function render() {
    cursor = 0;
    currentHook = hook(lead.id, lead, blocked);
    const deps = { ...refs, canOperateLead: !blocked && permission, dealStatusChange: statusMutation, stageMovePending: false,
      reopenStatusConfirmation: confirmation,
      localLead, lead, statusConfirmation: currentHook, captureDetailOperation: () => ({ isCurrent: () => mounted }),
      setReopenStatusConfirmation: value => { confirmation = value; }, setPendingLostStageMove: value => { pendingStage = value; },
      setLostReasonDialogOpen: value => { lostOpen = value; }, pendingLostStageMove: pendingStage,
      setLostReasonLocal() {}, persistMoveToStage: async () => true, activeOrganization: auth.activeOrganization,
      organization: { name: 'Synthetic org' }, fullLeadQuery: { data: lead }, queryClient: client,
      setLocalLead, mergeLeadDetailMutation,
      toast: { error: message => notices.push(message) },
      assigneeSelectionRef: { current: null }, setAssigneeScheduleConfirmation() {}, setReadOnlyScheduleEvent() {},
      onClose: () => { closed = true; unmount(); },
    };
    currentHandlers = Object.fromEntries(['handleDealStatusChange', 'handleConfirmLostReason', 'handleCloseLeadDetail'].map(name => [name,
      evaluateProduction('const ' + productionDeclaration('components/features/leads/LeadDetailDialog.tsx',
        node => ts.isVariableDeclaration(node) && node.name.getText() === name), deps, name)]));
    for (const [name, attribute] of [['closeLost', 'onLostReasonDialogOpenChange'], ['closeReopen', 'onReopenStatusConfirmationChange']]) {
      const expression = productionDeclaration('components/features/leads/LeadDetailDialog.tsx', node => ts.isArrowFunction(node)
        && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText() === attribute);
      currentHandlers[name] = evaluateProduction('const callback=' + expression, deps, 'callback');
    }
  }
  function unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); }
  render();
  return {
    requests, notices, openLost: async () => { await currentHandlers.handleDealStatusChange('lost'); render(); },
    openReopen: async () => { await currentHandlers.handleDealStatusChange('open'); render(); },
    confirmLost: async reason => { await currentHandlers.handleConfirmLostReason(reason); render(); },
    confirmReopen: async () => { await currentHandlers.handleDealStatusChange('open', { confirmation }); render(); },
    callbacks: () => ({ lost: currentHandlers.handleConfirmLostReason, reopen: currentHandlers.handleDealStatusChange,
      closeLost: currentHandlers.closeLost, closeReopen: currentHandlers.closeReopen, clear: currentHook.clear, confirmation }),
    cancel: () => { if (currentHook.clear()) { lostOpen = false; confirmation = null; } render(); },
    draft: value => { currentHook.updateDraft(value); render(); },
    patch: patch => { lead = { ...lead, ...patch }; localLead = { ...lead }; serverLead = { ...lead }; render(); },
    access: value => { blocked = value; render(); },
    replace: (organizationId = 'org-b', actor = 'actor-b', sid = 'sid-b', leadId = lead.id) => {
      auth.activeOrganization.organizationId = organizationId; auth.user = { id: actor }; auth.session = { access_token: token(actor, sid) };
      lead = { ...lead, id: leadId, organization_id: organizationId }; localLead = lead; render();
    },
    deny: () => { permission = false; render(); },
    allow: () => { permission = true; render(); },
    closeDetail: () => currentHandlers.handleCloseLeadDetail(),
    stageReason: () => { currentHook.restart(); pendingStage = { stageId: 'stage-b', revision: lead.updated_at }; lostOpen = true; render(); },
    deferReply: () => reply = deferred(),
    state: () => ({ lead: localLead, serverLead, confirmation, lostOpen, writes, closed, draft: currentHook.draft }),
    close: () => { unmount(); client.clear(); },
  };
}

test('Perdido keeps the gesture revision, owner and property through a newer authorized read', async () => {
  const f = fixture();
  try {
    await f.openLost(); f.draft({ selectedReason: 'other', details: 'Synthetic original reason' });
    f.patch({ deal_status: 'won', updated_at: '2026-10-16T10:00:00.000002Z', assigned_user_id: 'actor-b', property_id: 'property-b' });
    await f.confirmLost('Synthetic original reason');
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.requests[0].authorizedLead.deal_status, 'open'); assert.equal(f.requests[0].propertyId, 'property-a');
    assert.equal(f.requests[0].userId, 'actor-a'); assert.equal(f.state().writes, 0); assert.equal(f.state().serverLead.deal_status, 'won');
    assert.equal(f.state().lostOpen, true); assert.equal(f.state().draft.details, 'Synthetic original reason');
  } finally { f.close(); }
});

for (const initial of ['won', 'lost']) test(`Reabrir from ${initial} keeps the original authorized snapshot`, async () => {
  const f = fixture(initial);
  try {
    await f.openReopen(); f.patch({ deal_status: initial === 'won' ? 'lost' : 'won', updated_at: '2026-10-16T10:00:00.000002Z', property_id: 'property-b' });
    await f.confirmReopen(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.requests[0].authorizedLead.deal_status, initial); assert.equal(f.requests[0].propertyId, 'property-a'); assert.equal(f.state().writes, 0);
  } finally { f.close(); }
});

for (const kind of ['lost', 'reopen']) test(`${kind}: a transient access failure blocks actions and retains the original confirmation`, async () => {
  const f = fixture(kind === 'lost' ? 'open' : 'won');
  try {
    await (kind === 'lost' ? f.openLost() : f.openReopen()); f.draft({ selectedReason: 'other', details: 'Preserved reason' });
    f.access(true); await (kind === 'lost' ? f.confirmLost('Preserved reason') : f.confirmReopen()); assert.equal(f.requests.length, 0);
    assert.equal(f.state().draft.details, 'Preserved reason');
    f.patch({ updated_at: '2026-10-16T10:00:00.000002Z' }); f.access(false);
    await (kind === 'lost' ? f.confirmLost('Preserved reason') : f.confirmReopen());
    assert.equal(f.requests[0].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z'); assert.equal(f.state().writes, 0);
  } finally { f.close(); }
});

test('successful loss clears the owned reason; opening another confirmation starts empty', async () => {
  const f = fixture();
  try {
    await f.openLost(); f.draft({ selectedReason: 'other', details: 'Saved reason' }); await f.confirmLost('Saved reason');
    assert.equal(f.state().writes, 1); assert.equal(f.state().lostOpen, false); assert.deepEqual(f.state().draft, { selectedReason: '', details: '' });
  } finally { f.close(); }
});

test('reopen keeps a null property from its original snapshot when newer props contain a property', async () => {
  const f = fixture('won');
  try {
    f.patch({ property_id: null, interest_property_id: null }); await f.openReopen();
    f.patch({ property_id: 'property-later', interest_property_id: 'property-later', updated_at: '2026-10-16T10:00:00.000002Z' });
    await f.confirmReopen(); assert.equal(f.requests[0].propertyId, null); assert.equal(f.requests[0].authorizedLead.property_id, null);
    assert.equal(f.state().writes, 0);
  } finally { f.close(); }
});

test('cancel and a deliberate new selection can use the new revision; a retired loss callback cannot', async () => {
  const f = fixture();
  try {
    await f.openLost(); const retired = f.callbacks(); f.cancel(); f.patch({ updated_at: '2026-10-16T10:00:00.000002Z' }); await f.openLost();
    await retired.reopen('lost');
    await retired.lost('Old reason'); retired.closeLost(false); assert.equal(retired.clear(), false); assert.equal(f.requests.length, 0); assert.equal(f.state().lostOpen, true);
    await f.confirmLost('New decision'); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].expectedUpdatedAt, '2026-10-16T10:00:00.000002Z');
    assert.equal(f.state().writes, 1);
  } finally { f.close(); }
});

test('cancel and reopen invalidates an old reopen confirmation and close callback', async () => {
  const f = fixture('won');
  try {
    await f.openReopen(); const retired = f.callbacks(); f.cancel(); await f.openReopen();
    await retired.reopen('open', { confirmation: retired.confirmation }); retired.closeReopen(null); assert.equal(retired.clear(retired.confirmation.intent), false);
    assert.equal(f.requests.length, 0); assert.ok(f.state().confirmation); await f.confirmReopen(); assert.equal(f.state().writes, 1);
  } finally { f.close(); }
});

for (const replacement of [
  ['org-b', 'actor-a', 'sid-a'], ['org-a', 'actor-b', 'sid-b'], ['org-a', 'actor-a', 'sid-b'], ['org-a', 'actor-a', 'sid-a', 'lead-b'],
]) test('replaced lead/org/actor/SID invalidates the original intention: ' + replacement.join('/'), async () => {
  const f = fixture();
  try {
    await f.openLost(); const old = f.callbacks(); f.draft({ selectedReason: 'other', details: 'Old scope draft' }); f.replace(...replacement);
    await old.lost('Old scope reason'); assert.equal(f.requests.length, 0); assert.deepEqual(f.state().draft, { selectedReason: '', details: '' });
    f.replace('org-a', 'actor-a', 'sid-a', 'lead-a'); await old.lost('Retired visit'); assert.equal(f.requests.length, 0);
    assert.deepEqual(f.state().draft, { selectedReason: '', details: '' });
  } finally { f.close(); }
});

test('permission revocation and close invalidate original callbacks without a status write', async () => {
  const f = fixture();
  try { await f.openLost(); const old = f.callbacks(); f.deny(); await old.lost('Revoked'); f.closeDetail(); await old.lost('Closed'); assert.equal(f.requests.length, 0); }
  finally { f.close(); }
});

for (const kind of ['lost', 'reopen']) test(`${kind}: current cancellation still closes after operation permission is revoked`, async () => {
  const f = fixture(kind === 'reopen' ? 'won' : 'open');
  try {
    if (kind === 'lost') await f.openLost(); else await f.openReopen();
    const original = f.callbacks();
    f.deny();
    const revoked = f.callbacks();
    if (kind === 'lost') revoked.closeLost(false); else revoked.closeReopen(null);
    assert.equal(kind === 'lost' ? f.state().lostOpen : Boolean(f.state().confirmation), false);
    await original.lost('Retired reason');
    await original.reopen('open', { confirmation: original.confirmation });
    assert.equal(f.requests.length, 0);

    f.allow();
    if (kind === 'lost') await f.openLost(); else await f.openReopen();
    if (kind === 'lost') revoked.closeLost(false); else revoked.closeReopen(null);
    assert.equal(kind === 'lost' ? f.state().lostOpen : Boolean(f.state().confirmation), true);
    assert.equal(f.requests.length, 0);
  } finally { f.close(); }
});

test('late status success cannot update a closed detail', async () => {
  const f = fixture();
  try {
    await f.openLost(); const response = f.deferReply(), saving = f.confirmLost('Pending'); f.closeDetail();
    response.resolve({ lead: { ...f.state().lead, deal_status: 'lost' } }); await saving;
    assert.equal(f.state().lead.deal_status, 'open'); assert.equal(f.state().closed, true);
  } finally { f.close(); }
});

test('the existing pending stage reason still follows its original stage-move path', async () => {
  const f = fixture();
  try { f.stageReason(); await f.confirmLost('Stage reason'); assert.equal(f.requests.length, 0); assert.equal(f.state().lostOpen, false); }
  finally { f.close(); }
});

test('a new stage reason can start after retiring another scope visit', async () => {
  const f = fixture();
  try {
    await f.openLost(); f.replace(); f.replace('org-a', 'actor-a', 'sid-a'); f.stageReason(); await f.confirmLost('New stage decision');
    assert.equal(f.state().lostOpen, false); assert.equal(f.requests.length, 0);
  } finally { f.close(); }
});

test('a callback captured before a transient access failure cannot confirm while hidden', async () => {
  const f = fixture();
  try {
    await f.openLost(); const old = f.callbacks(); f.draft({ selectedReason: 'other', details: 'Preserve during outage' });
    f.access(true); await old.lost('Obsolete allowed callback'); assert.equal(f.requests.length, 0);
    assert.equal(f.state().draft.details, 'Preserve during outage'); f.access(false); await f.confirmLost('Recovered');
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
  } finally { f.close(); }
});

function lossFormState(props, local = ['', '']) {
  const declaration = productionDeclaration('components/features/leads/LostReasonDialog.tsx',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'LostReasonDialog');
  const parsed = ts.createSourceFile('loss.tsx', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = parsed.statements[0].body.statements.filter(node => !ts.isReturnStatement(node)).map(node => node.getText(parsed)).join('\n');
  let index = 0;
  const dependencies = { ...props, loading: false, onConfirm() {}, onOpenChange() {},
    lostReasonSchema: { safeParse: value => ({ success: Boolean(value), data: value }) },
    buildLostReasonValue: (reason, details) => [reason, details].filter(Boolean).join(': '), LOSS_REASON_OTHER_VALUE: 'other',
    useState: () => { const slot = index++; return [local[slot], value => { local[slot] = value; }]; }, useEffect: callback => callback(),
  };
  return evaluateProduction(body, dependencies, '({selectedReason,details,setSelectedReason,setDetails})');
}

test('controlled loss reason survives a dialog remount without resetting the owner draft', async () => {
  const updates = [], draft = { selectedReason: 'other', details: 'Reason retained while hidden' };
  const first = lossFormState({ open: true, draft, onDraftChange: value => updates.push(value) });
  const remounted = lossFormState({ open: true, draft, onDraftChange: value => updates.push(value) });
  await Promise.resolve(); assert.deepEqual(updates, []);
  assert.equal(first.details, draft.details); assert.equal(remounted.details, draft.details);
  remounted.setDetails('Changed'); assert.deepEqual(updates, [{ selectedReason: 'other', details: 'Changed' }]);
});

test('uncontrolled loss reason retains its existing reset-on-open behavior', async () => {
  const local = ['other', 'Old local draft']; lossFormState({ open: true, draft: undefined, onDraftChange: undefined }, local);
  await Promise.resolve(); assert.deepEqual(local, ['', '']);
});
