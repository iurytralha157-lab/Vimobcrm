import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { shouldInitializeLeadForm } from '../../../../lib/lead-edit-session.ts';

const ts = createRequire(import.meta.url)('typescript');
function declaration(path, predicate) {
  const file = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  let result;
  function visit(node) { if (predicate(node)) result = node.getText(file); ts.forEachChild(node, visit); }
  visit(file);
  assert.ok(result);
  return result;
}
function execute(source, deps, result) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return Function(...Object.keys(deps), `${compiled}; return ${result};`)(...Object.values(deps));
}
const bulk = declaration('../ContactsScreen.tsx', (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'handleBulkDelete');
function bulkFixture(ids, contacts, extra = {}) {
  const requests = [], selections = [], notices = [];
  const action = execute(`const ${bulk}`, {
    canDeleteLeads: true, isContactsTransitioning: false, periodError: null,
    selectedIds: new Set(ids), contacts: contacts.map(id => ({ id })),
    deleteScope: { capture: () => () => true },
    deleteScopeKey: 'current',
    bulkDeleteLeads: { isPending: false, mutateAsync: async input => { requests.push(input); return { deletedIds: input, failures: [], unstartedIds: [] }; } },
    setSelectedIds: value => selections.push(value), setBulkDeleteDialogOpen: () => {},
    toast: value => notices.push(value), getErrorMessage: error => error.message,
    ...extra,
  }, 'handleBulkDelete');
  return { action, requests, selections, notices };
}
test('actual bulk handler blocks hidden selections before any deletion request', async () => {
  const f = bulkFixture(['old-1', 'old-2'], ['new-1', 'new-2']);
  await f.action();
  assert.equal(f.requests.length, 0);
  assert.deepEqual([...f.selections[0]], []);
  assert.equal(f.notices[0].title, 'A seleção mudou');
});
test('actual bulk handler deletes only reviewed visible IDs and retains failed IDs', async () => {
  const requests = [];
  const f = bulkFixture(['a', 'b'], ['a', 'b'], { bulkDeleteLeads: { isPending: false, mutateAsync: async ids => { requests.push(ids); return { deletedIds: ['a'], failures: [{ id: 'b' }], unstartedIds: [] }; } } });
  await f.action();
  assert.deepEqual(requests, [['a', 'b']]);
  assert.deepEqual([...f.selections[0]], ['b']);
});
test('actual bulk handler blocks transitions and invalid periods', async () => {
  for (const state of [{ isContactsTransitioning: true }, { periodError: 'invalid' }, { canDeleteLeads: false }]) {
    const f = bulkFixture(['a'], ['a'], state);
    await f.action();
    assert.equal(f.requests.length, 0);
  }
});

const requestDelete = declaration('../ContactsScreen.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'requestContactDelete');
const individualDelete = declaration('../ContactsScreen.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleDeleteContact');
const openDetails = declaration('../ContactsScreen.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'openLeadDetails');
function individualFixture(extra = {}) {
  const requests = [], targets = [], scopes = [], details = [], notices = [];
  const deps = {
    canDeleteLeads: true, isContactsTransitioning: false, periodError: null,
    contacts: [{ id: 'a' }], deleteContactId: 'a', deleteContactScope: 'current', selectionScope: 'current',
    deleteLead: { isPending: false, mutateAsync: async id => requests.push(id) },
    deleteScope: { capture: () => () => true },
    deleteScopeKey: 'current',
    setDeleteContactId: id => targets.push(id), setDeleteContactScope: scope => scopes.push(scope),
    setSelectedContactId: id => details.push(id), setSelectedIds: () => {}, toast: value => notices.push(value),
    ...extra,
  };
  return {
    request: execute(`const ${requestDelete}`, deps, 'requestContactDelete'),
    confirm: execute(`const ${individualDelete}`, deps, 'handleDeleteContact'),
    open: execute(`const ${openDetails}`, deps, 'openLeadDetails'),
    requests, targets, scopes, details, notices,
  };
}

test('actual individual actions cannot open a placeholder or hidden contact', () => {
  for (const state of [{ isContactsTransitioning: true }, { periodError: 'invalid' }, { contacts: [{ id: 'b' }] }]) {
    const f = individualFixture(state);
    f.request('a'); f.open('a');
    assert.deepEqual(f.targets, []);
    assert.deepEqual(f.details, []);
  }
  const f = individualFixture();
  f.request('a'); f.open('a');
  assert.deepEqual(f.targets, ['a']);
  assert.deepEqual(f.scopes, ['current']);
  assert.deepEqual(f.details, ['a']);
});

test('actual individual confirmation blocks transitions, changed scope and missing targets', async () => {
  for (const state of [{ isContactsTransitioning: true }, { periodError: 'invalid' }, { selectionScope: 'new' }, { contacts: [{ id: 'b' }] }]) {
    const f = individualFixture(state);
    await f.confirm();
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.targets, [null]);
    assert.equal(f.notices[0].title, 'A listagem mudou');
  }
  for (const state of [{ canDeleteLeads: false }, { deleteLead: { isPending: true } }]) {
    const f = individualFixture(state);
    await f.confirm();
    assert.deepEqual(f.requests, []);
  }
});

test('actual individual confirmation submits only the currently reviewed target', async () => {
  const f = individualFixture();
  await f.confirm();
  assert.deepEqual(f.requests, ['a']);
  assert.deepEqual(f.targets, [null]);
});

const initializer = declaration('../../leads/CreateLeadDialog.tsx', node => ts.isCallExpression(node) && node.expression.getText() === 'useEffect' && node.arguments[0]?.getText().includes('shouldInitializeLeadForm'));
test('actual editor effect preserves dirty fields and files when a changed server snapshot arrives', () => {
  const initializedFormRef = { current: null }, editBaseFormRef = { current: null }, editBaseLeadRef = { current: null };
  const forms = [], attachments = [];
  const run = (open, snapshot) => execute(`${initializer};`, {
    useEffect: callback => callback(), open, initializedFormRef, editBaseFormRef, editBaseLeadRef,
    activeOrganization: { organizationId: 'org' }, user: { id: 'user' }, leadSummary: { id: 'lead' },
    draftKey: null, conversationId: null, isEditMode: true, isLoadingEditLead: false,
    defaultStageId: null, defaultPipelineId: null, contactPhone: null, contactName: null, isFormEmpty: () => false,
    persistedLead: snapshot, editableLead: snapshot, pipelines: [{ id: 'pipeline' }],
    shouldInitializeLeadForm, getEmptyFormData: () => ({ name: snapshot.name }),
    setAttachmentRecovery: () => {}, setDraftRestored: () => {}, setErrors: () => {},
    setDialogPosition: () => {}, dialogPositionRef: { current: null },
    setPendingAttachments: value => attachments.push(value), setFormData: value => forms.push(value), setActiveTab: () => {},
  }, 'undefined');
  run(true, { id: 'lead', name: 'Original', updated_at: 'v1' });
  run(true, { id: 'lead', name: 'External update', updated_at: 'v2' });
  assert.deepEqual(forms, [{ name: 'Original' }]);
  assert.equal(attachments.length, 1);
  assert.equal(editBaseLeadRef.current.updated_at, 'v1');
  run(false, { id: 'lead', name: 'External update', updated_at: 'v2' });
  run(true, { id: 'lead', name: 'External update', updated_at: 'v2' });
  assert.equal(forms[1].name, 'External update');
});
