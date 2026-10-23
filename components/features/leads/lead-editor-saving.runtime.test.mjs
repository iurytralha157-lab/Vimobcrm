import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { deferred, evaluateProduction, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { createLeadImportScope } from '../../../lib/lead-import-scope.ts';
import { captureLeadRequestIntent } from '../../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../../lib/auth/global-sign-out.ts';
import { buildLeadEditFields, changedLeadFields, uploadLeadFiles } from '../../../lib/lead-edit-session.ts';

const sourcePath = process.env.EDITOR_SOURCE || 'components/features/leads/CreateLeadDialog.tsx';
const ast = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CreateLeadDialog');
assert.ok(component);
const declarations = new Map(component.body.statements.filter(ts.isVariableStatement).flatMap(statement =>
  statement.declarationList.declarations.filter(node => ts.isIdentifier(node.name)).map(node => [node.name.text, node])));
const elements = [];
function visit(node) { if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node); ts.forEachChild(node, visit); }
visit(component);
const attr = (node, name) => node.attributes.properties.find(property => property.name?.getText(ast) === name);
const attrText = (node, name) => attr(node, name)?.initializer?.getText(ast) || '';
function expression(node, name) {
  const attribute = attr(node, name); assert.ok(attribute, `${node.tagName.getText(ast)}.${name}`);
  return attribute.initializer.expression?.getText(ast) || attribute.initializer.getText(ast);
}
const element = (tag, predicate = () => true) => { const found = elements.find(node => node.tagName.getText(ast) === tag && predicate(node)); assert.ok(found, tag); return found; };

// Resolve the real JSX callback or its named handler. Only external boundaries
// and React state setters are synthetic; declarations and edit helpers are real.
function fixture(edit, { withFile = false, holdUpload = false } = {}) {
  const scope = createLeadImportScope(), key = JSON.stringify(['org-a', 'actor-a', 'sid-a', edit ? 'lead-a' : null]); scope.activate(key);
  const initial = { ...Object.fromEntries(['email','feedback','message','cargo','empresa','profissao','renda_familiar','valor_interesse','gender','social_name','birth_date','cpf','rg','cnpj','corporate_name','trade_name','state_registration','lost_reason'].map(name => [name, ''])),
    name: 'Draft', phone: '+5511999990000', source: 'manual', person_type: 'individual', property_id: 'property-a', interest_property_ids: ['property-a'],
    tag_ids: ['tag-a'], assigned_user_id: 'actor-a', team_id: '', pipeline_id: 'pipeline-a', stage_id: 'stage-a', deal_status: 'open', conversation_id: '' };
  const file = { name: 'original.pdf', size: 42, lastModified: 1 }, property = { id: 'property-a', title: 'Synthetic property', preco: 1000 };
  const baseLead = { id: 'lead-a', organization_id: 'org-a', can_operate: true, updated_at: '2026-10-19T10:00:00.000001Z' };
  const state = { formData: structuredClone(initial), files: withFile ? [file] : [], picked: { organizationId: 'org-a', items: [property] },
    activeTab: edit ? 'interest' : 'management', errors: { name: 'Previous' }, isSubmitting: false, recovery: null, reload: false };
  let response = deferred(); const upload = deferred(), requests = [], uploads = [], effects = [];
  const set = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const dependencies = {
    submissionScope: scope, submissionScopeKey: key, submissionAttemptRef: { current: null }, submissionMountedRef: { current: true },
    accessBlocked: false, accessPending: false, editReadDenied: false, isEditMode: edit, editableLead: edit ? baseLead : null,
    sensitiveProfileError: false, isLoadingEditLead: false, persistedLead: baseLead,
    editBaseLeadRef: { current: baseLead }, editBaseFormRef: { current: { ...initial, name: 'Previous name' } },
    captureLeadRequestIntent, getGlobalSignOutSessionId, buildLeadEditFields, changedLeadFields, uploadLeadFiles,
    parseCurrencyInput: value => Number(value) || undefined, formatCurrencyInput: value => String(value),
    user: { id: 'actor-a' }, session: { access_token: `header.${Buffer.from(JSON.stringify({ sub: 'actor-a', session_id: 'sid-a' })).toString('base64url')}.synthetic` },
    activeOrganization: { organizationId: 'org-a' }, draftKey: edit ? null : 'synthetic-draft', canUploadAttachments: true, canViewProperties: true,
    MAX_PENDING_ATTACHMENTS: 10, MAX_ATTACHMENT_BYTES: 25 * 1024 * 1024,
    file, property, properties: [property], allAssignableUsers: [{ id: 'actor-b' }], teams: [{ id: 'team-b', members: [{ user_id: 'actor-b' }] }],
    pipelines: [{ id: 'pipeline-a', is_default: true }], defaultPipelineId: 'pipeline-a', defaultStageId: 'stage-a',
    getEmptyFormData: () => ({ ...initial, name: '' }), isFormEmpty: () => false,
    useCallback: callback => callback, setFormData: set('formData'), setPendingAttachments: set('files'), setPickedProperties: set('picked'),
    setErrors: set('errors'), setActiveTab: set('activeTab'), setIsSubmitting: set('isSubmitting'), setAttachmentRecovery: set('recovery'),
    setReloadEditOpen: set('reload'),
    setDraftRestored() {}, removeLeadDraft: () => effects.push('draft-removed'),
    validateBasicStep: () => true, validateProfileStep: () => true, validateManagementStep: () => true,
    createLead: { mutateAsync: async body => { requests.push({ mode: 'create', body }); return response.promise; } },
    updateLead: { mutateAsync: async body => { requests.push({ mode: 'edit', body }); return response.promise; } },
    leadAttachmentsAPI: { upload: async (...args) => { uploads.push(args); if (holdUpload) await upload.promise; } },
    onSaved: () => effects.push('saved'), onCreated: () => effects.push('created'), onOpenChange: open => effects.push(open ? 'opened' : 'closed'),
    requiresWonLeadFinancialReview: () => false, toast: Object.fromEntries(['success','warning','error'].map(name => [name, () => effects.push(name)])),
    localStorage: { setItem: () => effects.push('draft-stored') },
  };
  function evaluate(code, extra = {}) {
    // Callback values deliberately capture the current render. Retained callbacks
    // must still consult submissionAttemptRef before React renders busy state.
    const bindings = { ...dependencies, ...state, pendingAttachments: state.files, attachmentRecovery: state.recovery,
      finalTab: edit ? 'interest' : 'management', ...extra };
    const resolving = new Set();
    const resolveDependencies = text => {
      const parsed = ts.createSourceFile('callback.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function walk(node) {
        if (ts.isIdentifier(node)) {
          const name = node.text, declaration = declarations.get(name);
          if (!Object.hasOwn(bindings, name) && declaration && !resolving.has(name)) {
            resolving.add(name); resolveDependencies(declaration.getText(ast));
            bindings[name] = evaluateProduction('const ' + declaration.getText(ast), bindings, name);
          }
        }
        ts.forEachChild(node, walk);
      }
      walk(parsed);
    };
    resolveDependencies(code); return evaluateProduction('const callback = ' + code, bindings, 'callback');
  }
  const handler = (name, extra) => { const declaration = declarations.get(name); assert.ok(declaration, name); return evaluate(declaration.initializer.getText(ast), extra); };
  const jsx = (tag, name, predicate, extra) => evaluate(expression(element(tag, predicate), name), extra);
  return {
    state, requests, uploads, effects, dependencies, file, property, handler, jsx, evaluate,
    submit: () => handler('handleSubmit')({ preventDefault() {} }),
    resolve: () => { const lead = { ...baseLead, ...initial, name: requests.at(-1)?.body.name || initial.name, updated_at: '2026-10-19T10:01:00.000001Z' }; response.resolve(edit ? lead : { id: lead.id, lead, leadVisible: true }); },
    reject: () => response.reject(new Error('Synthetic rejected')), nextResponse: () => { response = deferred(); },
    allowUploads: () => upload.resolve(), retire: () => scope.activate(JSON.stringify(['org-b', 'actor-b', 'sid-b', 'lead-a'])),
  };
}

const mutations = [
  ['property selection', f => f.jsx('PropertyPickerDialog', 'onSelect'), { id: 'property-b', preco: 2000 }],
  ['property removal', f => f.jsx('button', 'onClick', node => attrText(node, 'aria-label').includes('property.'))],
  ['attachment selection', f => f.handler('handleAttachmentSelection'), [{ name: 'late.pdf', size: 1, lastModified: 2 }]],
  ['attachment removal', f => f.jsx('button', 'onClick', node => attrText(node, 'aria-label').includes('file.name'))],
  ['team selector', f => f.jsx('Select', 'onValueChange', node => attrText(node, 'value').includes('formData.team_id')), 'team-b'],
  ['pipeline selector', f => f.jsx('Select', 'onValueChange', node => attrText(node, 'value').includes('formData.pipeline_id')), 'pipeline-b'],
  ['assignee selector', f => f.jsx('Select', 'onValueChange', node => attrText(node, 'value').includes('formData.assigned_user_id')), 'actor-b'],
  ['status selector', f => f.jsx('Select', 'onValueChange', node => attrText(node, 'value').includes('formData.deal_status')), 'lost'],
  ['stage selector', f => f.jsx('Select', 'onValueChange', node => attrText(node, 'value').includes('formData.stage_id')), 'stage-b'],
  ['tag selection', f => f.jsx('TagSelector', 'onSelectTag'), 'tag-b'],
  ['tag removal', f => f.jsx('TagSelector', 'onRemoveTag'), 'tag-a'],
  ['draft discard', f => f.handler('discardDraft')],
  ['tab selector', f => f.jsx('Tabs', 'onValueChange'), 'basic'],
  ['wizard selector', f => f.jsx('FormWizardLayout', 'onStepChange'), 'basic'],
  ['reload confirmation', f => f.jsx('AlertDialogAction', 'onClick')],
  ['reload opening', f => f.jsx('Button', 'onClick', node => node.parent.getText(ast).includes('Recarregar dados atuais'))],
  ['footer back', f => f.jsx('Button', 'onClick', node => attrText(node, 'className').includes('FORM_WIZARD_SECONDARY'))],
  ['footer next', f => f.jsx('Button', 'onClick', node => attrText(node, 'key').includes('btn-avancar'), { activeTab: 'basic' })],
];

for (const edit of [true, false]) {
  const mode = edit ? 'edit' : 'create';
  for (const [field, value] of Object.entries({ name: 'New draft', phone: '+5511888880000', email: 'new@example.invalid', feedback: 'New notes', cpf: '123', valor_interesse: '999', tag_ids: ['tag-b'], lost_reason: 'New reason' })) {
    test(`${mode}: retained updateField cannot change ${field} while saving`, async () => {
      const f = fixture(edit), update = f.handler('updateField'), pending = f.submit(); await turn();
      const before = structuredClone(f.state); update(field, value);
      assert.deepEqual(f.state, before); f.resolve(); await pending;
      assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.name, 'Draft'); assert.ok(f.effects.includes('closed'));
    });
  }
  for (const [name, capture, argument] of mutations) test(`${mode}: queued ${name} callback cannot mutate a submitted draft`, async () => {
    const f = fixture(edit, { withFile: true }), callback = capture(f), pending = f.submit(); await turn();
    const before = structuredClone(f.state), beforeEffects = [...f.effects];
    callback(argument);
    assert.deepEqual(f.state, before); assert.deepEqual(f.effects, beforeEffects); f.resolve(); await pending;
  });

  test(`${mode}: double submit from one render dispatches once`, async () => {
    const f = fixture(edit), submit = f.handler('handleSubmit'), event = { preventDefault() {} };
    const first = submit(event); await submit(event); assert.equal(f.requests.length, 1);
    f.resolve(); await first; assert.equal(f.state.isSubmitting, false);
  });

  test(`${mode}: valid edits made before submission are included in the saved snapshot`, async () => {
    const f = fixture(edit); f.handler('updateField')('name', 'Valid before save');
    const pending = f.submit(); assert.equal(f.requests[0].body.name, 'Valid before save'); f.resolve(); await pending;
    assert.ok(f.effects.includes('saved')); assert.ok(f.effects.includes('closed'));
  });

  test(`${mode}: form capture blocks mutations while busy but permits Tab, Escape and resumed editing`, async () => {
    const f = fixture(edit), callbacks = Object.fromEntries(['onPointerDownCapture','onClickCapture','onChangeCapture','onKeyDownCapture'].map(name => [name, f.jsx('form', name)]));
    const pending = f.submit(); await turn();
    for (const [name, type, key] of [['onPointerDownCapture','pointerdown'],['onClickCapture','click'],['onChangeCapture','change'],['onKeyDownCapture','keydown','a'],['onKeyDownCapture','keydown','Enter'],['onKeyDownCapture','keydown','Tab'],['onKeyDownCapture','keydown','Escape']]) {
      let prevented = 0, stopped = 0;
      callbacks[name]({ type, key, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
      const allowed = key === 'Tab' || key === 'Escape'; assert.equal(prevented, allowed ? 0 : 1); assert.equal(stopped, allowed ? 0 : 1);
    }
    f.reject(); await pending; let blocked = false;
    callbacks.onClickCapture({ type: 'click', preventDefault: () => { blocked = true; }, stopPropagation() {} });
    assert.equal(blocked, false);
  });

  test(`${mode}: stale Enter handler cannot navigate during save`, async () => {
    const f = fixture(edit), keydown = f.handler('handleFormKeyDown', { activeTab: 'basic' }), pending = f.submit(); await turn();
    const tab = f.state.activeTab; let prevented = false;
    keydown({ key: 'Enter', defaultPrevented: false, preventDefault() { prevented = true; }, target: { tagName: 'INPUT', closest: () => null } });
    assert.equal(f.state.activeTab, tab); assert.equal(prevented, true); assert.equal(f.requests.length, 1); f.resolve(); await pending;
  });

  test(`${mode}: stale close handler cannot discard the in-flight form`, async () => {
    const f = fixture(edit), close = f.handler('handleOpenChange'), pending = f.submit(); await turn();
    close(false); assert.deepEqual(f.effects, []); f.resolve(); await pending;
  });

  test(`${mode}: rejection keeps valid draft and files, unlocks editing and permits retry`, async () => {
    const f = fixture(edit, { withFile: true }), before = structuredClone(f.state.formData), pending = f.submit(); await turn();
    f.reject(); await pending;
    assert.equal(f.state.isSubmitting, false); assert.equal(f.dependencies.submissionAttemptRef.current, null);
    assert.deepEqual(f.state.formData, before); assert.equal(f.state.files[0], f.file); assert.deepEqual(f.effects, []);
    f.handler('updateField')('name', 'Retry draft'); assert.equal(f.state.formData.name, 'Retry draft');
    f.nextResponse(); const retry = f.submit(); assert.equal(f.requests[1].body.name, 'Retry draft'); f.resolve(); await retry;
    assert.equal(f.requests.length, 2); assert.ok(f.effects.includes('closed'));
  });

  test(`${mode}: attachment upload holds the same lock until upload completion`, async () => {
    const f = fixture(edit, { withFile: true, holdUpload: true }), update = f.handler('updateField'), pending = f.submit(); f.resolve(); await turn();
    assert.equal(f.uploads.length, 1); assert.equal(f.state.isSubmitting, true); update('name', 'During upload');
    assert.equal(f.state.formData.name, 'Draft'); f.allowUploads(); await pending; assert.equal(f.state.isSubmitting, false);
  });

  test(`${mode}: retired session suppresses success effects and does not erase its draft`, async () => {
    const f = fixture(edit, { withFile: true }), before = structuredClone(f.state.formData), pending = f.submit(); await turn();
    f.retire(); f.resolve(); await pending;
    assert.deepEqual(f.state.formData, before); assert.equal(f.state.files[0], f.file); assert.deepEqual(f.effects, []);
    assert.equal(f.state.isSubmitting, false); assert.equal(f.uploads.length, 0);
  });
}

test('the native form content is inside a disabled fieldset while saving', () => {
  const fieldset = element('fieldset');
  const f = fixture(true); assert.equal(f.evaluate(expression(fieldset, 'disabled'), { isSubmitting: true }), true);
  assert.equal(f.evaluate(expression(fieldset, 'disabled'), { isSubmitting: false }), false);
  for (const node of elements.filter(node => ['Input', 'Textarea', 'InternationalPhoneInput'].includes(node.tagName.getText(ast)))) {
    let parent = node.parent, covered = false;
    while (parent) { if (ts.isJsxElement(parent) && parent.openingElement === fieldset) covered = true; parent = parent.parent; }
    assert.ok(covered, node.getText(ast).slice(0, 90));
  }
});

for (const tag of ['PropertyPickerDialog', 'TagSelector', 'LeadSourceSelect', 'Select']) test(`${tag} exposes a busy disabled state for portal controls`, () => {
  const f = fixture(false);
  for (const node of elements.filter(node => node.tagName.getText(ast) === tag)) {
    assert.equal(f.evaluate(expression(node, 'disabled'), { isSubmitting: true }), true);
  }
});
