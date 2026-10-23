import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Execute the production UI handlers. Services and React setters are synthetic;
// hook/transport access checks have their own runtime suites. No network or DB.
const sources = {
  settings: 'components/features/pipelines/StageSettingsDialog.tsx',
  editor: 'components/features/pipelines/StagesEditorDialog.tsx',
  screen: 'components/features/pipelines/PipelinesScreen.tsx',
};
const cases = [
  ['settings', 'handleSaveGeneral', 'saveInFlightRef'],
  ['settings', 'handleArchive', 'saveInFlightRef'],
  ['editor', 'handleSave', 'saveInFlightRef'],
  ['editor', 'handleRestoreStage', 'restoreInFlight'],
  ['screen', 'handleCreatePipeline', 'createPipelineInFlightRef'],
  ['screen', 'handleCreateStage', 'createStageInFlightRef'],
  ['screen', 'handleStageName', 'stageNameUpdateInFlightRef'],
];

function declaration(path, name) {
  const tree = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(result, `${path}: ${name}`);
  return `const ${result};`;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function sharedState() {
  const rename = new Map();
  // The pre-fix handler used a Set; retain its behavior for a reproducible RED.
  rename.add = id => rename.set(id, true);
  return {
    writes: [], notices: [], requests: [], state: {},
    refs: {
      saveInFlightRef: { current: false }, restoreInFlight: { current: false },
      createPipelineInFlightRef: { current: false }, createStageInFlightRef: { current: false },
      stageNameUpdateInFlightRef: { current: rename },
      editingStageBaseRef: { current: { id: 'stage-a', name: 'Previous', updatedAt: 'revision-a' } },
    },
  };
}

function fixture(area, name, shared = sharedState()) {
  const gate = deferred(), key = {}, access = { current: true };
  const editorVisit = { key, capture: () => ({ visit: key, isCurrent: () => access.current }) };
  const stage = { id: 'stage-a', name: 'Previous', pipeline_id: 'pipeline-a', updated_at: 'revision-a' };
  const setters = [
    'setIsSaving', 'setSavingOperation', 'setGeneralBase', 'setGeneralError', 'setArchiveOpen', 'setArchiveError',
    'setSaveError', 'setDraftStages', 'setEditingId', 'setEditingName', 'setEditingColor', 'setIsAdding', 'setNewName',
    'setRestoreError', 'setRestoredStageIds', 'setRestoringStageId', 'setRestoringOperation',
    'handleSelectPipeline', 'setNewPipelineDialogOpen', 'setNewPipelineName', 'setNewStageDialogOpen',
    'setNewStageName', 'setNewStageColor', 'setEditingStageId', 'setSavingStageNameId', 'setSavingStageName',
    'onOpenChange', 'onStageUpdate',
  ];
  const write = (field, value) => {
    const previous = shared.state[field] ?? (field === 'setRestoredStageIds' ? new Set() : null);
    shared.state[field] = typeof value === 'function' ? value(previous) : value;
    shared.writes.push({ field, value: shared.state[field] });
  };
  const mutate = (...args) => { shared.requests.push(args); return gate.promise; };
  const dependencies = {
    ...Object.fromEntries(setters.map(field => [field, value => write(field, value)])), ...shared.refs,
    editorVisit, createPipelineVisit: editorVisit, createStageVisit: editorVisit, stageNameVisit: editorVisit,
    open: true, isMutating: false, isDraftStale: false, canSave: name !== 'handleRestoreStage', isAdding: false, editingId: null,
    editingName: '', editingColor: '', stages: [stage], sourceStages: [stage],
    readStageFields: () => null, pendingNewStageName: '', newColor: '#123456',
    createDraftStage: () => { throw Error('No synthetic draft insertion in this case'); },
    toStageEditorSaveValues: value => value, buildUniqueStageKey: () => 'stage-a',
    reorderStages: { mutateAsync: mutate }, restoreStageMutation: { mutateAsync: mutate },
    archivedStages: [stage], generalBase: stage, stage, canEditPipeline: true, isSaving: false, isBusy: false,
    name: 'Changed', color: '#123456', isQualified: false,
    stageGeneralChanges: () => ({ name: 'Changed' }), stageSettingsRevision: () => 'revision-a',
    updateStage: { mutateAsync: mutate }, updateStageName: { mutateAsync: mutate },
    pipelineId: 'pipeline-a', selectedPipelineId: 'pipeline-a', newPipelineName: 'Created', newStageName: 'Created',
    newPipelineDialogOpen: true, newStageDialogOpen: true,
    newStageColorValidation: { success: true, data: '#123456' },
    createPipeline: { mutateAsync: mutate }, createStage: { mutateAsync: mutate },
    editingStageName: 'Changed', activeOrganization: { organizationId: 'org-a' }, activeOrganizationId: 'org-a',
    pipelinesAPI: { updateStage: mutate },
    queryClient: { invalidateQueries: value => { shared.writes.push({ field: 'invalidateQueries', value }); return Promise.resolve(); } },
    PIPELINE_STAGE_COLOR_FALLBACK: '#123456', VimobAPIError: class extends Error {},
    getErrorMessage: error => error.message, getStructuredErrorMessage: error => error.message,
    getPipelineErrorMessage: error => error.message,
    toast: Object.fromEntries(['success', 'error', 'warning', 'info'].map(kind => [kind, message => shared.notices.push({ kind, message })])),
    handleOpenChange: value => write('handleOpenChange', value),
  };
  const code = ts.transpileModule(declaration(sources[area], name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const handler = Function(...Object.keys(dependencies), `${code};return ${name};`)(...Object.values(dependencies));
  return { gate, key, access, shared, run: () => handler(name === 'handleStageName' || name === 'handleRestoreStage'
    ? 'stage-a' : { preventDefault() {} }) };
}

for (const [area, name] of cases) for (const outcome of ['confirmed', 'rejected']) {
  test(`${area}/${name}: retired visit cannot publish ${outcome} completion`, async () => {
    const f = fixture(area, name);
    const pending = f.run();
    assert.equal(f.shared.requests.length, 1);
    f.access.current = false;
    f.shared.writes.length = 0; f.shared.notices.length = 0;
    if (outcome === 'confirmed') f.gate.resolve({ id: 'created', name: 'Changed', color: '#123456' });
    else f.gate.reject(Error('Deferred synthetic failure'));
    await pending;
    assert.deepEqual(f.shared.writes, [], 'a late reply must not close, reset or overwrite the current editor');
    assert.deepEqual(f.shared.notices, [], 'a retired visit must remain silent');
  });
}

for (const [area, name] of cases) {
  test(`${area}/${name}: same visit still publishes its confirmed result`, async () => {
    const f = fixture(area, name);
    const pending = f.run();
    assert.equal(f.shared.requests.length, 1);
    f.shared.writes.length = 0; f.shared.notices.length = 0;
    // Refreshing a token within the same SID keeps the visit guard current.
    f.gate.resolve({ id: 'created', name: 'Changed', color: '#123456' });
    await pending;
    assert.ok(f.shared.writes.length > 0);
    assert.equal(f.shared.notices.filter(item => item.kind === 'success').length, 1);
  });
}

for (const [area, name, busyRef] of cases) {
  test(`${area}/${name}: reply A cannot release the busy operation of visit B`, async () => {
    const a = fixture(area, name);
    const pendingA = a.run();
    assert.equal(a.shared.requests.length, 1);
    a.access.current = false;
    const b = fixture(area, name, a.shared);
    const pendingB = b.run();
    assert.equal(b.shared.requests.length, 2, 'a retired busy state must not prevent the next access from saving');
    const ownerB = busyRef === 'stageNameUpdateInFlightRef' ? b.shared.refs[busyRef].current.get('stage-a') : b.shared.refs[busyRef].current;
    b.shared.writes.length = 0; b.shared.notices.length = 0;
    a.gate.resolve({ id: 'old-created', name: 'Old reply', color: '#654321' });
    await pendingA;
    assert.deepEqual(b.shared.writes, []);
    assert.deepEqual(b.shared.notices, []);
    assert.equal(busyRef === 'stageNameUpdateInFlightRef' ? b.shared.refs[busyRef].current.get('stage-a') : b.shared.refs[busyRef].current, ownerB);
    b.gate.resolve({ id: 'new-created', name: 'Changed', color: '#123456' });
    await pendingB;
    assert.equal(b.shared.notices.filter(item => item.kind === 'success').length, 1);
  });
}
