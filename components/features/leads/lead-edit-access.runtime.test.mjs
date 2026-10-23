import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { deferred, evaluateProduction, productionDeclaration, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { createLeadImportScope } from '../../../lib/lead-import-scope.ts';
import { captureLeadRequestIntent } from '../../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../../lib/auth/global-sign-out.ts';

function fixture() {
  const requests = [], effects = [], response = deferred(), submissionScope = createLeadImportScope();
  const key = JSON.stringify(['org-a', 'actor-a', 'sid-a', 'lead-a']); submissionScope.activate(key);
  const baseLead = { id: 'lead-a', organization_id: 'org-a', updated_at: '2026-10-16T10:00:00.000001Z' };
  const formData = { name: 'Draft', feedback: '', message: '', interest_property_ids: [], property_id: '', person_type: 'individual', gender: '', social_name: '', birth_date: '', cpf: '', rg: '', cnpj: '', corporate_name: '', trade_name: '', state_registration: '' };
  const state = { accessBlocked: false, accessPending: false, isSubmitting: false };
  const dependencies = { submissionScope, submissionScopeKey: key, submissionAttemptRef: { current: null }, submissionMountedRef: { current: true },
    attachmentRecovery: null, editReadDenied: false, activeTab: 'interest', isEditMode: true, sensitiveProfileError: false,
    validateBasicStep: () => true, validateProfileStep: () => true, validateManagementStep: () => true,
    formData, editBaseLeadRef: { current: baseLead }, editBaseFormRef: { current: {} }, editableLead: baseLead,
    buildLeadEditFields: value => value, changedLeadFields: () => ({ name: 'Draft' }), parseCurrencyInput: () => undefined,
    pendingAttachments: [], canUploadAttachments: false, draftKey: null, user: { id: 'actor-a' },
    session: { access_token: `header.${Buffer.from(JSON.stringify({ sub: 'actor-a', session_id: 'sid-a' })).toString('base64url')}.synthetic` },
    captureLeadRequestIntent, getGlobalSignOutSessionId,
    setIsSubmitting: value => { state.isSubmitting = value; }, updateLead: { mutateAsync: async body => { requests.push(body); return response.promise; } },
    setPendingAttachments: () => effects.push('attachments'), setDraftRestored: () => effects.push('draft'), setErrors: () => effects.push('errors'),
    onSaved: () => effects.push('saved'), onOpenChange: () => effects.push('closed'), setAttachmentRecovery() {},
    removeLeadDraft: () => effects.push('removed'), requiresWonLeadFinancialReview: () => false,
    toast: { error: () => effects.push('error'), success: () => effects.push('success') },
  };
  const handler = () => evaluateProduction('const ' + productionDeclaration('components/features/leads/CreateLeadDialog.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleSubmit'), { ...dependencies, ...state }, 'handleSubmit');
  return { state, requests, effects, response, capture: handler, submit: () => handler()({ preventDefault() {} }),
    block: () => { state.accessBlocked = true; submissionScope.activate(null); },
    replace: () => submissionScope.activate(JSON.stringify(['org-b', 'actor-b', 'sid-b', 'lead-a'])),
  };
}

for (const field of ['accessBlocked', 'accessPending']) test(`real editor handler cannot submit while ${field}`, async () => {
  const f = fixture(); f.state[field] = true; await f.submit(); assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
});

test('a previously captured editor callback cannot submit after access is suspended or session is replaced', async () => {
  for (const action of ['block', 'replace']) {
    const f = fixture(), old = f.capture(); f[action](); await old({ preventDefault() {} }); assert.deepEqual(f.requests, []); assert.deepEqual(f.effects, []);
  }
});

test('a pending save keeps its original revision; a later suspension prevents completion effects and releases only its busy state', async () => {
  const f = fixture(), old = f.capture(); const saving = old({ preventDefault() {} }); await turn();
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
  f.block(); await old({ preventDefault() {} }); assert.equal(f.requests.length, 1);
  f.response.resolve({ id: 'lead-a', updated_at: '2026-10-16T10:00:00.000002Z' }); await saving;
  assert.equal(f.state.isSubmitting, false); assert.deepEqual(f.effects, []);
});
