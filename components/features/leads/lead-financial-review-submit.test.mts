import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildLeadEditFields, changedLeadFields, uploadLeadFiles } from '../../../lib/lead-edit-session';
import { requiresWonLeadFinancialReview, WON_LEAD_FINANCIAL_REVIEW_MESSAGE } from './lead-detail/financial-review';

const require = createRequire(import.meta.url);
const ts: typeof import('typescript') = require('typescript');
const source = readFileSync(new URL('./CreateLeadDialog.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('CreateLeadDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submitSource = '';
function visit(node: import('typescript').Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleSubmit') submitSource = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(submitSource);

type SyntheticLead = { id: string; organization_id: string; name: string; deal_status: string; updated_at: string; can_operate?: boolean; valor_interesse?: number | null; commission_percentage?: number | null };
const before: SyntheticLead = {
  id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222',
  name: 'Synthetic', deal_status: 'won', can_operate: true, updated_at: '2026-10-12T10:00:00.000001Z', valor_interesse: 100, commission_percentage: 5,
};
function fixture(saved: SyntheticLead, original: SyntheticLead = before, withUpload = false) {
  const notices: Array<{ kind: string; message: string }> = [], updates: Array<Record<string, unknown>> = [], callbacks: SyntheticLead[] = [];
  const baseRef = { current: original };
  const h = {
    current: true, finishPatch: (() => {}) as () => void, finishUpload: (() => {}) as () => void, uploads: 0,
  };
  const formData = {
    name: 'Synthetic updated', phone: '+5511999990000', email: '', feedback: '', message: '', person_type: 'individual',
    gender: '', social_name: '', birth_date: '', cpf: '', rg: '', cnpj: '', corporate_name: '', trade_name: '', state_registration: '',
    interest_property_ids: [], property_id: '', valor_interesse: '', tag_ids: [], source: 'manual',
  };
  const deps = {
    accessBlocked: false, accessPending: false, submissionAttemptRef: { current: null }, submissionMountedRef: { current: true },
    canUploadAttachments: true, isSubmitting: false, attachmentRecovery: null, editReadDenied: false, activeTab: 'management', isEditMode: true, editableLead: original,
    validateBasicStep: () => true, validateProfileStep: () => true, validateManagementStep: () => true, sensitiveProfileError: false,
    editBaseLeadRef: baseRef, editBaseFormRef: { current: { ...formData, name: 'Synthetic' } },
    formData, buildLeadEditFields, changedLeadFields, uploadLeadFiles, parseCurrencyInput: () => undefined,
    submissionScope: { capture: () => () => h.current }, submissionScopeKey: 'synthetic-scope',
    captureLeadRequestIntent: () => ({ expectedUserId: 'synthetic-actor', expectedSessionId: 'synthetic-session' }),
    getGlobalSignOutSessionId: () => 'synthetic-session', user: { id: 'synthetic-actor' }, session: null,
    updateLead: { mutateAsync: (input: Record<string, unknown>) => {
      updates.push(input); return new Promise<SyntheticLead>(resolve => { h.finishPatch = () => resolve(saved); });
    } }, createLead: { mutateAsync: () => { throw new Error('An edit must not create another lead'); } },
    pendingAttachments: withUpload ? [{ name: 'synthetic.pdf' }] : [], activeOrganization: { organizationId: before.organization_id },
    leadAttachmentsAPI: { upload: () => { h.uploads++; return new Promise<void>(resolve => { h.finishUpload = resolve; }); } },
    setActiveTab: () => {}, setIsSubmitting: () => {}, removeLeadDraft: () => {}, draftKey: null,
    setPendingAttachments: () => {}, setDraftRestored: () => {}, setErrors: () => {}, setAttachmentRecovery: () => {},
    onSaved: (lead: SyntheticLead) => callbacks.push(lead), onCreated: () => { throw new Error('No create callback for edits'); }, onOpenChange: () => {},
    requiresWonLeadFinancialReview, WON_LEAD_FINANCIAL_REVIEW_MESSAGE,
    toast: Object.fromEntries(['warning', 'success', 'error'].map(kind => [kind, (message: string) => notices.push({ kind, message })])),
  };
  const script = ts.transpileModule(`const ${submitSource};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const submit = Function(...Object.keys(deps), `${script};return handleSubmit;`)(...Object.values(deps)) as (event: { preventDefault(): void }) => Promise<void>;
  return { submit: () => submit({ preventDefault() {} }), notices, updates, callbacks, baseRef, h };
}

test('actual edit submit reports preserved financial records for zero and null values without a finance call', async () => {
  for (const patch of [{ valor_interesse: 0 }, { valor_interesse: null }, { commission_percentage: 0 }, { commission_percentage: null }]) {
    const f = fixture({ ...before, ...patch }); const pending = f.submit();
    assert.equal(f.updates.length, 1); assert.equal(f.updates[0].expectedUpdatedAt, before.updated_at);
    f.h.finishPatch(); await pending;
    assert.deepEqual(f.notices, [{ kind: 'warning', message: WON_LEAD_FINANCIAL_REVIEW_MESSAGE }]);
    assert.equal(f.callbacks.length, 1);
  }
});
test('ordinary contact edits do not produce a financial warning', async () => {
  const f = fixture({ ...before, name: 'Synthetic updated' }); const pending = f.submit(); f.h.finishPatch(); await pending;
  assert.deepEqual(f.notices, [{ kind: 'success', message: 'Lead atualizado com sucesso!' }]);
});
test('partial or masked snapshots never claim a proven monetary change', async () => {
  const f = fixture({ ...before }, { ...before, valor_interesse: undefined, commission_percentage: undefined });
  const pending = f.submit(); f.h.finishPatch(); await pending;
  assert.equal(f.notices.some(notice => notice.kind === 'warning'), false);
});
test('financial feedback uses the base captured before PATCH and upload rather than a newer reference', async () => {
  const f = fixture({ ...before, valor_interesse: 200 }, before, true); const pending = f.submit();
  f.baseRef.current = { ...before, valor_interesse: 200 }; f.h.finishPatch();
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(f.h.uploads, 1);
  f.h.finishUpload(); await pending;
  assert.ok(f.notices.some(notice => notice.kind === 'warning' && notice.message === WON_LEAD_FINANCIAL_REVIEW_MESSAGE));
});
test('closing or changing access while PATCH is pending prevents obsolete financial feedback and callbacks', async () => {
  const f = fixture({ ...before, valor_interesse: 200 }); const pending = f.submit(); f.h.current = false; f.h.finishPatch(); await pending;
  assert.deepEqual(f.notices, []); assert.deepEqual(f.callbacks, []);
});
test('changing access during attachment upload prevents obsolete financial feedback and callbacks', async () => {
  const f = fixture({ ...before, valor_interesse: 200 }, before, true); const pending = f.submit(); f.h.finishPatch();
  await new Promise<void>(resolve => setImmediate(resolve)); f.h.current = false; f.h.finishUpload(); await pending;
  assert.deepEqual(f.notices, []); assert.deepEqual(f.callbacks, []);
});
