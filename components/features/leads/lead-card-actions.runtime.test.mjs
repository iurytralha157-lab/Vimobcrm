import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction, productionDeclaration } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { normalizePhoneToE164 } from '../../../lib/phone-utils.ts';
import { leadContactOutcomeCommandSchema } from '../../../lib/validation/lead-contact-outcomes.ts';

function fixture(canOperate, poolReadOnly = false) {
  const calls = [], lead = { id: 'lead-a', can_operate: canOperate, phone: '+5511999999999', email: 'synthetic@example.invalid' };
  const canRecordContact = evaluateProduction('const ' + productionDeclaration('components/features/leads/LeadCard.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'canRecordContact'), { poolReadOnly, lead }, 'canRecordContact');
  const commandId = '77777777-7777-4777-8777-777777777777';
  const dependencies = { canRecordContact, lead, poolReadOnly, normalizePhoneToE164, outcomeType: 'call',
    captureCardOperation: () => ({ isCurrent: () => true }),
    cardOutcomeDraft: {
      getSubmission: (outcome, notes) => leadContactOutcomeCommandSchema.parse({ commandId, channel: dependencies.outcomeType, outcome, notes }),
      beginSubmission: command => { calls.push(['begin', command]); return true; },
      acknowledgeSavedCommand: command => { calls.push(['ack', command]); return acknowledge; },
      endSubmission: command => calls.push(['end', command]),
    },
    window: { open: (...args) => calls.push(['open', ...args]) }, setOutcomeType: value => { dependencies.outcomeType = value; calls.push(['type', value]); }, setOutcomeDialogOpen: value => calls.push(['dialog', value]),
    recordContactOutcome: { mutateAsync: async value => { calls.push(['command', value]); await Promise.resolve(); calls.push(['receipt', value.commandId]); } },
    recordFirstResponse: async value => calls.push(['first-response', value]),
    activeOrganization: { organizationId: 'org-a' }, profile: { id: 'actor-a' }, toast: { warning() {}, error() {}, info() {} }, getErrorObjectMessage: error => error.message,
  };
  let acknowledge = true;
  const handler = name => evaluateProduction('const ' + productionDeclaration('components/features/leads/LeadCard.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === name), dependencies, name);
  return { calls, commandId, click: async name => handler(name)({ stopPropagation() {} }),
    confirm: () => handler('handleOutcomeConfirm')(dependencies.outcomeType === 'call' ? 'answered' : 'replied', 'Synthetic'),
    preserveNewDraft: () => { acknowledge = false; },
  };
}

for (const capability of [false, undefined]) test(`readonly/unknown capability ${capability} cannot initiate phone/email or register an outcome`, async () => {
  const f = fixture(capability); await f.click('handlePhoneClick'); await f.click('handleEmailClick'); await f.confirm(); assert.deepEqual(f.calls, []);
});

test('a queue-pool lead without ownership cannot initiate the flow even with a stale true capability', async () => {
  const f = fixture(true, true); await f.click('handlePhoneClick'); await f.click('handleEmailClick'); await f.confirm(); assert.deepEqual(f.calls, []);
});

test('an authorized lead preserves phone/email and confirmed activity/first-response behavior', async () => {
  const f = fixture(true); await f.click('handlePhoneClick'); await f.click('handleEmailClick'); assert.equal(await f.confirm(), true);
  assert.equal(f.calls.filter(value => value[0] === 'open').length, 2);
  assert.equal(f.calls[0][1], 'tel:+5511999999999'); assert.match(f.calls[3][1], /^https:\/\/mail.google.com/);
  assert.equal(f.calls.filter(value => value[0] === 'command').length, 1); assert.equal(f.calls.filter(value => value[0] === 'first-response').length, 1);
  assert.deepEqual(f.calls.find(value => value[0] === 'command')[1], { leadId: 'lead-a', commandId: f.commandId, channel: 'email', outcome: 'replied', notes: 'Synthetic' });
  assert.deepEqual(f.calls.filter(value => ['begin', 'command', 'receipt', 'ack', 'first-response', 'end'].includes(value[0])).map(value => value[0]), ['begin', 'command', 'receipt', 'ack', 'first-response', 'end']);
  assert.equal(f.calls.find(value => value[0] === 'first-response')[1].channel, 'email');
  assert.deepEqual(f.calls.filter(value => value[0] === 'dialog').at(-1), ['dialog', false]);
});

test('authorized phone confirmation binds the call command and acknowledges it before closing', async () => {
  const f = fixture(true); await f.click('handlePhoneClick'); assert.equal(await f.confirm(), true);
  assert.deepEqual(f.calls.find(value => value[0] === 'command')[1], { leadId: 'lead-a', commandId: f.commandId, channel: 'call', outcome: 'answered', notes: 'Synthetic' });
  assert.equal(f.calls.find(value => value[0] === 'first-response')[1].channel, 'phone');
  assert.equal(f.calls.filter(value => value[0] === 'ack').length, 1); assert.equal(f.calls.filter(value => value[0] === 'end').length, 1);
  assert.deepEqual(f.calls.filter(value => value[0] === 'dialog').at(-1), ['dialog', false]);
});

test('a confirmed older command cannot close a newer draft that declines acknowledgment', async () => {
  const f = fixture(true); await f.click('handleEmailClick'); f.preserveNewDraft(); assert.equal(await f.confirm(), false);
  assert.equal(f.calls.filter(value => value[0] === 'command').length, 1); assert.equal(f.calls.filter(value => value[0] === 'end').length, 1);
  assert.deepEqual(f.calls.filter(value => value[0] === 'dialog').at(-1), ['dialog', true]);
});
