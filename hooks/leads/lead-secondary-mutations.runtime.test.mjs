import assert from 'node:assert/strict';
import test from 'node:test';
import { MutationObserver } from '@tanstack/react-query';
import { deferred, leadHookRuntime, turn } from './lead-request-runtime-fixture.mjs';

const cases = [
  ['hooks/use-leads.ts', 'useAddLeadTag', { leadId: 'lead-a', tagId: 'tag-a' }, 'addLeadTag', 2, 3],
  ['hooks/use-leads.ts', 'useRemoveLeadTag', { leadId: 'lead-a', tagId: 'tag-a' }, 'removeLeadTag', 2, 3],
  ['hooks/use-leads.ts', 'useCreateLead', { name: 'Synthetic contact' }, 'createLead', 0, 2],
  ['hooks/use-activities.ts', 'useCreateActivity', { lead_id: '30000000-0000-4000-8000-000000000001', type: 'note', content: 'Synthetic' }, 'activity.create', 1, 2],
  ['hooks/use-lead-tasks.ts', 'useCreateLeadTask', { lead_id: 'lead-a', type: 'note', title: 'Synthetic', day_offset: 0 }, 'task.create', 1, 2],
  ['hooks/use-lead-tasks.ts', 'useToggleLeadTask', { id: 'task-a', is_done: true, leadId: 'lead-a' }, 'task.patch', 2, 3],
  ['hooks/use-lead-tasks.ts', 'useCompleteCadenceTask', { leadId: 'lead-a', taskId: 'task-a' }, 'task.complete', null, 1],
  ['hooks/use-first-response.ts', 'useRecordFirstResponse', { leadId: 'lead-a', organizationId: 'org-a', channel: 'phone', actorUserId: 'actor-a' }, 'recordFirstResponse', null, 2],
];

for (const [path, hook, variables, method, organizationIndex, intentIndex] of cases) {
  test(`actual ${hook} pins organization/user/session before transport and suppresses late global effects`, async () => {
    const fixture = leadHookRuntime();
    try {
      const pending = deferred(); fixture.respond(() => pending.promise);
      const options = fixture.render(path, hook); const observer = new MutationObserver(fixture.client(), options);
      const operation = observer.mutate({ ...variables }); await turn();
      assert.equal(fixture.requests.length, 1);
      const request = fixture.requests[0]; assert.equal(request.method, method);
      if (organizationIndex !== null) assert.equal(request.args[organizationIndex], 'org-a');
      const intent = request.args[intentIndex]; assert.equal(intent.expectedUserId, 'actor-a'); assert.equal(intent.expectedSessionId, 'sid-a');
      if (method === 'task.complete') assert.equal(request.args[0].organizationId, 'org-a');
      if (method === 'recordFirstResponse') assert.equal(request.args[1].organizationId, 'org-a');
      fixture.unmount(); fixture.switchTo('org-b', 'actor-b', 'sid-b'); assert.equal(intent.signal.aborted, true);
      pending.resolve(method === 'createLead' ? { leadId: 'lead-a', leadVisible: true, data: { id: 'lead-a' }, reentry: true, assignedUserName: 'Synthetic private actor', error: null } : { id: 'item-a', lead_id: 'lead-a', recorded: true, error: null });
      await operation; assert.deepEqual(fixture.notices, []); assert.deepEqual(fixture.events, []);
    } finally { fixture.close(); }
  });
}

test('old callbacks and already bound gestures cannot revive after A -> B -> A; same SID refresh survives', () => {
  const fixture = leadHookRuntime();
  try {
    const first = fixture.scope(); const variables = {}; const gesture = first.bind(variables);
    fixture.switchTo('org-a', 'actor-a', 'sid-a', 2); fixture.scope(); assert.equal(gesture.isCurrent(), true);
    fixture.switchTo('org-b', 'actor-a', 'sid-a'); fixture.scope(); assert.equal(gesture.isCurrent(), false);
    fixture.switchTo(); const current = fixture.scope(); assert.throws(() => first.capture()); assert.throws(() => first.require(variables));
    assert.equal(gesture.isCurrent(), false); assert.equal(current.capture().isCurrent(), true);
  } finally { fixture.close(); }
});

test('replacement SID under the same actor aborts an old gesture', () => {
  const fixture = leadHookRuntime();
  try { const scope = fixture.scope(), gesture = scope.bind({}); fixture.switchTo('org-a', 'actor-a', 'sid-b'); fixture.scope(); assert.equal(gesture.isCurrent(), false); assert.equal(gesture.intent.signal.aborted, true); }
  finally { fixture.close(); }
});

test('actual detail callback capture cannot revive after lead ABA or session replacement', () => {
  const fixture = leadHookRuntime();
  try {
    const originalCapture = fixture.detailScope(), original = originalCapture();
    fixture.detailScope('lead-b'); fixture.detailScope('lead-a');
    assert.equal(original.isCurrent(), false); assert.throws(() => originalCapture());
    const currentCapture = fixture.detailScope(); const current = currentCapture();
    fixture.switchTo('org-a', 'actor-a', 'sid-a', 2); fixture.detailScope(); assert.equal(current.isCurrent(), true);
    fixture.switchTo('org-a', 'actor-a', 'sid-b'); fixture.detailScope(); assert.equal(current.isCurrent(), false); assert.throws(() => currentCapture());
  } finally { fixture.close(); }
});

test('normal successful creation retains notices and the current organization event', async () => {
  const fixture = leadHookRuntime();
  try { const observer = new MutationObserver(fixture.client(), fixture.render('hooks/use-leads.ts', 'useCreateLead')); await observer.mutate({ name: 'Synthetic' }); assert.equal(fixture.notices[0].text, 'Lead criado com sucesso!'); assert.equal(fixture.events[0].organizationId, 'org-a'); }
  finally { fixture.close(); }
});

test('actual status hook pins its authorized write and does not publish after SID replacement', async () => {
  const fixture = leadHookRuntime();
  try {
    const pending = deferred(); fixture.respond(method => method === 'updateLead' ? pending.promise : { data: fixture.authorizedLead, error: null });
    const observer = new MutationObserver(fixture.client(), fixture.render('hooks/use-deal-status-change.ts', 'useDealStatusChange'));
    const operation = observer.mutate({ leadId: 'lead-a', organizationId: 'org-a', newStatus: 'won', authorizedLead: fixture.authorizedLead,
      userId: 'actor-a', propertyId: null, valorInteresse: null, commissionPercentage: null, leadName: 'Synthetic' }); await turn();
    const request = fixture.requests.find(value => value.method === 'updateLead'); assert.ok(request); assert.equal(request.args[3].expectedSessionId, 'sid-a');
    fixture.switchTo('org-a', 'actor-a', 'sid-b'); fixture.render('hooks/use-deal-status-change.ts', 'useDealStatusChange'); assert.equal(request.args[3].signal.aborted, true);
    pending.resolve({ data: { ...fixture.authorizedLead, deal_status: 'won' }, error: null }); await operation;
    assert.deepEqual(fixture.notices, []); assert.deepEqual(fixture.events, []);
  } finally { fixture.close(); }
});

test('actual round-robin hook pins its initiating scope and suppresses late success after session replacement', async () => {
  const fixture = leadHookRuntime();
  try {
    const pending = deferred(); fixture.respond(() => pending.promise);
    const options = fixture.render('hooks/use-assign-lead-roundrobin.ts', 'useAssignLeadRoundRobin');
    const observer = new MutationObserver(fixture.client(), options);
    const result = observer.mutate('lead-a'); await turn();
    const request = fixture.requests[0]; assert.equal(request.method, 'redistributeLeadRoundRobin');
    assert.deepEqual(request.args[2], { expectedUnassigned: true });
    assert.equal(request.args[1], 'org-a'); assert.equal(request.args[3].expectedUserId, 'actor-a');
    assert.equal(request.args[3].expectedSessionId, 'sid-a');
    fixture.switchTo('org-a', 'actor-a', 'sid-b'); fixture.render('hooks/use-assign-lead-roundrobin.ts', 'useAssignLeadRoundRobin');
    assert.equal(request.args[3].signal.aborted, true);
    pending.resolve({ success: true, lead_id: 'lead-a', assigned_user_id: 'actor-a' }); await result;
    assert.deepEqual(fixture.notices, []); assert.deepEqual(fixture.events, []);
  } finally { fixture.close(); }
});

test('actual round-robin hook refuses old queued mutation before transport after organization ABA', async () => {
  const fixture = leadHookRuntime();
  try {
    const old = fixture.render('hooks/use-assign-lead-roundrobin.ts', 'useAssignLeadRoundRobin');
    old.onMutate('lead-a');
    fixture.switchTo('org-b'); fixture.render('hooks/use-assign-lead-roundrobin.ts', 'useAssignLeadRoundRobin');
    fixture.switchTo(); fixture.render('hooks/use-assign-lead-roundrobin.ts', 'useAssignLeadRoundRobin');
    await assert.rejects(old.mutationFn('lead-a')); assert.equal(fixture.requests.length, 0);
    assert.throws(() => old.onMutate('lead-b'));
    old.onSettled(undefined, undefined, 'lead-a', undefined);
  } finally { fixture.close(); }
});

test('normal round-robin assignment preserves configured unassigned policy and current notices', async () => {
  const fixture = leadHookRuntime();
  try {
    fixture.respond(() => ({ success: true, lead_id: 'lead-a', assigned_user_id: 'actor-a' }));
    const observer = new MutationObserver(fixture.client(), fixture.render('hooks/use-assign-lead-roundrobin.ts', 'useAssignLeadRoundRobin'));
    await observer.mutate('lead-a'); assert.equal(fixture.events[0].reason, 'lead.redistributed');
    assert.equal(fixture.notices[0].kind, 'success');
  } finally { fixture.close(); }
});
