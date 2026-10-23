import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { deferred, evaluateProduction, productionDeclaration, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { captureLeadRequestIntent } from '../../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../../lib/auth/global-sign-out.ts';
import { VimobAPIError } from '../../../lib/api/vimob-error.ts';

function fixture(options = {}) {
  const revision = 'revision' in options ? options.revision : '2026-10-16T10:00:00.000001Z';
  const requests = [], notices = [], events = [], mountedRef = { current: true }, assignmentInFlightRef = { current: false };
  let serverRevision = revision, popover = false, assigning = false, reply;
  const dependencies = {
    lead: { id: 'lead-a', assigned_user_id: 'actor-a', updated_at: revision }, organizationId: 'org-a',
    user: { id: 'actor-a' }, session: { access_token: `header.${Buffer.from(JSON.stringify({ sub: 'actor-a', session_id: 'sid-a' })).toString('base64url')}.synthetic` },
    canAssignCurrentLead: true, canAssignAnyLead: true, mountedRef, assignmentInFlightRef,
    captureLeadRequestIntent, getGlobalSignOutSessionId, VimobAPIError,
    setAssigneePopoverOpen: value => { popover = value; }, setIsAssigning: value => { assigning = value; },
    toast: { success: value => notices.push(value), error: value => notices.push(value) },
    queryClient: { invalidateQueries: value => events.push(['invalidate', value]) }, notifyLeadRealtimeChange: value => events.push(['realtime', value]),
    leadsAPI: { assignLead: async (...args) => {
      requests.push(args); if (reply) return reply.promise;
      if (args[4] !== serverRevision) throw new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' });
      return { error: null };
    } },
  };
  const handler = name => evaluateProduction('const ' + productionDeclaration('components/features/whatsapp/ConversationLeadPanel.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === name),
  { ...dependencies, ...(name === 'refreshLeadData' ? {} : { refreshLeadData: () => handler('refreshLeadData')() }) }, name);
  return { requests, notices, events, choose: () => handler('handleAssignUser')('actor-b'), retire: () => { mountedRef.current = false; },
    patchServer: revision => { serverRevision = revision; }, deferReply: () => reply = deferred(), state: () => ({ popover, assigning }) };
}

test('WhatsApp assignment keeps the current snapshot revision and rejects an external change without retry', async () => {
  const f = fixture(); f.patchServer('2026-10-16T10:00:00.000002Z'); await f.choose(); await turn();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0][4], '2026-10-16T10:00:00.000001Z');
  assert.equal(f.requests[0][3].expectedSessionId, 'sid-a'); assert.equal(f.state().popover, true);
  assert.match(f.notices[0], /atualizado em outra sessão/); assert.equal(f.events.filter(value => value[0] === 'realtime').length, 0);
});

test('an older conversation-detail response without revision remains readable but cannot transfer', async () => {
  const f = fixture({ revision: undefined }); await f.choose(); assert.equal(f.requests.length, 0);
  assert.match(f.notices[0], /Atualize este lead/);
});

test('double click dispatches once and a response after remount/session replacement has no UI effects', async () => {
  const f = fixture(), reply = f.deferReply(), first = f.choose(); await turn(); await f.choose(); assert.equal(f.requests.length, 1);
  f.retire(); reply.resolve({ error: null }); await first; assert.deepEqual(f.notices, []); assert.deepEqual(f.events, []);
});
