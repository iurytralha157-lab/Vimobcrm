import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { uploadLeadFiles } from '../../../lib/lead-edit-session.ts';
import { captureLeadRequestIntent } from '../../../lib/lead-request-intent.ts';
import { isDefinitiveLeadReadDenial } from '../../../lib/lead-read-access.ts';
import { evaluateProduction, productionDeclaration } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';

function fixture(canOperate, permission = true, uploadFails = false) {
  const requests = [], recoveries = [], pending = [], notices = []; let closed = 0;
  const savedLead = { id: 'lead-a', organization_id: 'org-a', can_operate: canOperate };
  const file = new File(['synthetic'], 'synthetic.pdf');
  const formData = { name: 'Synthetic', phone: '+5511999999999', email: '', message: '', feedback: '', source: 'manual',
    interest_property_ids: [], tag_ids: [], valor_interesse: '', person_type: 'individual', assigned_user_id: 'actor-a', pipeline_id: 'pipeline-a', stage_id: 'stage-a', deal_status: 'open' };
  const action = evaluateProduction('const ' + productionDeclaration('components/features/leads/CreateLeadDialog.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleSubmit'), {
    accessBlocked: false, accessPending: false, submissionAttemptRef: { current: null }, submissionMountedRef: { current: true },
    isSubmitting: false, attachmentRecovery: null, editReadDenied: false, activeTab: 'management', isEditMode: false,
    setActiveTab() {}, validateBasicStep: () => true, validateProfileStep: () => true, validateManagementStep: () => true,
    sensitiveProfileError: false, editBaseLeadRef: { current: null }, editBaseFormRef: { current: null }, formData,
    submissionScope: { capture: () => () => true }, submissionScopeKey: 'current', setIsSubmitting() {},
    captureLeadRequestIntent, user: { id: 'actor-a' }, session: {}, getGlobalSignOutSessionId: () => 'sid-a', parseCurrencyInput: () => undefined,
    editableLead: null, createLead: { mutateAsync: async () => ({ id: 'lead-a', lead: savedLead, leadVisible: true }) }, updateLead: {},
    canUploadAttachments: permission, pendingAttachments: [file], uploadLeadFiles,
    leadAttachmentsAPI: { upload: async (...args) => { requests.push(args); if (uploadFails) throw Error('Synthetic failed upload'); return {}; } },
    activeOrganization: { organizationId: 'org-a' }, toast: { warning: value => notices.push(value), success: value => notices.push(value), error: value => notices.push(value) },
    removeLeadDraft() {}, draftKey: null, setPendingAttachments: value => pending.push(value), setDraftRestored() {}, setErrors() {},
    setAttachmentRecovery: value => recoveries.push(value), onSaved: undefined, onCreated: undefined,
    onOpenChange: () => { closed += 1; },
  }, 'handleSubmit');
  return { submit: () => action({ preventDefault() {} }), requests, recoveries, pending, notices, file, closed: () => closed };
}

for (const capability of [false, undefined]) test(`actual creation preserves pending files when operational capability is ${capability}`, async () => {
  const f = fixture(capability); await f.submit(); assert.equal(f.requests.length, 0);
  assert.equal(f.recoveries[0].canUpload, false); assert.equal(f.recoveries[0].files[0], f.file); assert.equal(f.closed(), 0);
});
test('revoked global permission prevents upload even if a saved receipt is operable', async () => {
  const f = fixture(true, false); await f.submit(); assert.equal(f.requests.length, 0); assert.equal(f.recoveries[0].canUpload, false);
});
test('normal operable creation uploads once, with its initiating identity, and closes after success', async () => {
  const f = fixture(true); await f.submit(); assert.equal(f.requests.length, 1); assert.equal(f.closed(), 1);
  assert.equal(f.requests[0][3].expectedUserId, 'actor-a'); assert.equal(f.requests[0][3].expectedSessionId, 'sid-a');
});
test('operable creation retains only failed selected Files for safe recovery', async () => {
  const f = fixture(true, true, true); await f.submit(); assert.equal(f.requests.length, 1); assert.equal(f.recoveries[0].canUpload, true);
  assert.equal(f.recoveries[0].files[0], f.file); assert.equal(f.closed(), 0);
});
test('actual new won validation rejects missing Operate without changing user inputs', () => {
  const formData = { assigned_user_id: 'actor-a', pipeline_id: 'pipeline-a', stage_id: 'stage-a', deal_status: 'won', lost_reason: '' };
  const previous = { ...formData }, notices = [];
  const validate = evaluateProduction('const ' + productionDeclaration('components/features/leads/CreateLeadDialog.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'validateManagementStep'), {
    formData, hasPermission: () => false, setErrors() {}, setActiveTab() {}, toast: { error: value => notices.push(value) },
  }, 'validateManagementStep');
  assert.equal(validate(), false); assert.deepEqual(formData, previous); assert.ok(notices[0].includes('permissão'));
});

test('actual editor hides the form after definitive denial or operational capability loss', () => {
  const source = 'const ' + productionDeclaration('components/features/leads/CreateLeadDialog.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'editReadDenied');
  const denied = (persistedLead, error, permission = true) => evaluateProduction(source, {
    isEditMode: true, persistedLead, persistedLeadError: error, hasPermission: () => permission, isDefinitiveLeadReadDenial,
  }, 'editReadDenied');
  assert.equal(denied({ can_operate: true }), false);
  assert.equal(denied({ can_operate: true }, { status: 503 }), false);
  assert.equal(denied({ can_operate: false }), true);
  assert.equal(denied({ can_operate: true }, { status: 403 }), true);
  assert.equal(denied({ can_operate: true }, { status: 404 }), true);
  assert.equal(denied({ can_operate: true }, undefined, false), true);
});
