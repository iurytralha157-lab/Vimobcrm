import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { assignContactImportKeys, ContactImportFileError, ignoredContactImportColumns, normalizeContactImportLookup, normalizeContactImportRows, resolveContactImportReference, type ParsedContact } from './contact-import-columns';
import { decodeContactsCSV, parseContactsCSVRecords } from './parse-contacts-csv';
import { contactImportFailureReport, isConfirmedContactImportFailure } from './contact-import-result';
import { buildContactExportCSV } from '@/lib/export-contacts-csv';
import { createImportTagResolver, importTagOutcomeUnknown, resolveImportRowTagsIfValid } from './import-contacts-validation';
import { parseContactTags } from '@/lib/contact-tag-transfer';
import { leadCreateInputSchema } from '@/lib/validation/leads';
import { createTagInputSchema } from '@/lib/validation/crm-support';
import { DEFAULT_TAG_COLOR } from '@/config/tag-colors';
import { countPendingDistribution, createEmptyImportDistributionSummary } from '@/lib/lead-distribution-outcome';
import { resolveContactImportSource } from './contact-import-source';
import { createContactImportRecoveryStore } from './contact-import-recovery';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import type { ImportLeadsResult } from '@/hooks/use-leads';

// Exercise the actual mutation handler without loading spreadsheet ZIP internals.
const source = readFileSync(new URL('./ImportContactsDialog.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('ImportContactsDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations: ts.VariableDeclaration[] = [];
const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node)) declarations.push(node); ts.forEachChild(node, visit); };
visit(ast);
function compileHandler(name: string, dependencies: Record<string, unknown>) {
  const expression = declarations.find((node) => node.name.getText(ast) === name)?.initializer;
  assert.ok(expression);
  const code = ts.transpileModule(`const handler = ${expression.getText(ast)}; return handler;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

const pipelineId = '11111111-1111-4111-8111-111111111111';
const stageId = '22222222-2222-4222-8222-222222222222';
const user1 = '33333333-3333-4333-8333-333333333333';
const user2 = '44444444-4444-4444-8444-444444444444';

function importHarness(rows: ParsedContact[], overrides: Record<string, unknown> = {}) {
  const state = { sent: [] as Record<string, unknown>[], errors: [] as string[], createdTags: 0, result: null as ImportLeadsResult | null };
  const unknownPreparationRowsRef = { current: new Set<number>() };
  const noOp = () => {};
  const resolveDealStatus = compileHandler('resolveDealStatus', { normalizeLookupValue: normalizeContactImportLookup });
  const scopeKey = contactImportScopeKey('55555555-5555-4555-8555-555555555555', 'actor-id', 'session-id')!;
  const dialogScope = createLeadImportScope();
  dialogScope.activate(scopeKey);
  const recovery = createContactImportRecoveryStore();
  const dependencies = {
    isImporting: false, cataloguesPending: false, cataloguesFailed: false, isParsing: false,
    importScopeActiveRef: { current: true },
    importRunRef: { current: null }, dialogScope, scopeKey, sessionId: 'session-id', file: null,
    getVimobAPIAccessTokenUserId: () => 'actor-id', getVimobAPIAccessTokenSessionId: () => 'session-id',
    resolveContactImportSource, contactImportRecovery: recovery,
    ignoredColumns: [],
    selectedPipeline: pipelineId, parsedData: rows, organizationId: '55555555-5555-4555-8555-555555555555',
    user: { id: 'actor-id' },
    selectedSource: 'import', customSource: '', pipelines: [{ id: pipelineId, name: 'Vendas', is_active: true }],
    isLoadingStages: false, stagesError: null, stagesData: [{ id: stageId, name: 'Novo', is_active: true, position: 0 }],
    isAutoDistribute: false, selectedRoundRobin: 'automatic', canSelectDistributionQueue: true, activeRoundRobins: [],
    isLoadingRoundRobins: false, roundRobinsError: null,
    selectedAssignee: 'none', users: [{ id: user1, name: 'João', email: 'one@example.com', is_active: true }, { id: user2, name: 'João', email: 'two@example.com', is_active: true }],
    setIsImporting: noOp, setImportPhase: noOp, setImportResult: (result: ImportLeadsResult | null) => { state.result = result; }, setFailurePage: noOp, unknownPreparationRowsRef,
    setUnknownPreparationRows: noOp,
    setPreparationProgress: noOp, setImportProgress: noOp, createEmptyImportDistributionSummary,
    getStagePosition: (stage: { position?: number }) => stage.position || 0, normalizeLookupValue: normalizeContactImportLookup,
    contactImportTagAdapter: () => ({ load: async () => [], create: async (name: string) => { state.createdTags += 1; return { id: '66666666-6666-4666-8666-666666666666', name, organization_id: '55555555-5555-4555-8555-555555555555' }; } }),
    needsTags: rows.some((row) => Boolean(row.tags)), createImportTagResolver,
    pipelinesAPI: { getStages: async () => [] }, canAssignImportedLeads: true, canManageTags: true,
    resolveContactImportReference, resolveDealStatus, leadCreateInputSchema, parseContactTags, createTagInputSchema,
    DEFAULT_TAG_COLOR, resolveImportRowTagsIfValid, importTagOutcomeUnknown,
    importLeads: { mutateAsync: async ({ rows: prepared }: { rows: Record<string, unknown>[] }) => {
      state.sent = prepared;
      const failed = prepared.filter((row) => row.import_validation_error).length;
      return { total: prepared.length, processed: prepared.length, remaining: 0, created: prepared.length - failed,
        reentered: 0, success: prepared.length - failed, failed, failures: [], reasons: [], unstarted: [], stopped: false, distribution: createEmptyImportDistributionSummary() };
    } },
    lastProgressUpdateRef: { current: 0 }, countPendingDistribution, formatPtBRNumber: String,
    queryClient: { invalidateQueries: async () => {} }, invalidateTagConsumers: async () => {},
    toast: { success: noOp, warning: noOp, info: noOp, error: (message: string) => { state.errors.push(message); } },
    ...overrides,
  };
  const handlerDependencies = { ...dependencies, selectedQueueIssue: compileHandler('selectedQueueIssue', dependencies) };
  const run = compileHandler('handleImport', handlerDependencies) as () => Promise<void>;
  return { state, unknownPreparationRowsRef, recovery, scopeKey, dialogScope, run };
}

test('actual import rejects a homonym before tag creation or a valid lead payload', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', responsavel: 'João', tags: 'Quente' }]);
  await harness.run();
  assert.match(String(harness.state.sent[0].import_validation_error), /ambíguo/);
  assert.equal(harness.state.createdTags, 0);
});

test('actual import propagates explicit IDs and preserves the same row execution key', async () => {
  const key = '77777777-7777-4777-8777-777777777777';
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', responsavel: 'João', assigned_user_id: user2, importRequestKey: key }]);
  await harness.run();
  assert.equal(harness.state.sent[0].assigned_user_id, user2);
  assert.equal(harness.state.sent[0].import_request_key, key);
  assert.equal(harness.state.sent[0].import_validation_error, undefined);
});

test('actual retry button reviews only confirmed pool failures and preserves the key on explicit resubmission', async () => {
  const rows: ParsedContact[] = Array.from({ length: 6 }, (_, index) => ({
    rowNumber: index + 2, nome: `Contato sintético ${index}`,
    importRequestKey: `77777777-7777-4777-8777-${String(index + 1).padStart(12, '0')}`,
  }));
  const failures = [
    { rowNumber: 3, code: 'queue_pool_changed' },
    { rowNumber: 4, code: 'api_timeout' },
    { rowNumber: 5, code: 'lead_import_request_conflict' },
    { rowNumber: 6, code: 'unknown_409' },
    { rowNumber: 7, code: 'queue_pool_changed' },
  ];
  const confirmedFailures = failures.filter(failure => isConfirmedContactImportFailure(failure, new Set([7])));
  assert.deepEqual(confirmedFailures.map(failure => failure.rowNumber), [3]);

  let callback: ts.ArrowFunction | undefined;
  const collect = (node: ts.Node) => {
    if (ts.isArrowFunction(node) && node.body.getText(ast).includes('const rowNumbers = new Set(confirmedFailures.map')) callback = node;
    ts.forEachChild(node, collect);
  };
  collect(ast);
  assert.ok(callback);
  const code = ts.transpileModule(`const handler = ${callback.getText(ast)}; return handler;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let selectedRows = rows;
  const events: unknown[] = [];
  const dependencies = {
    confirmedFailures,
    setParsedData: (update: (current: ParsedContact[]) => ParsedContact[]) => { selectedRows = update(selectedRows); },
    scopeKey: 'retry-scope', contactImportRecovery: { clear: (key: string) => events.push(['clear', key]) },
    setFailurePage: (page: number) => events.push(['page', page]),
    setImportResult: (result: null) => events.push(['result', result]),
    setActiveStep: (step: string) => events.push(['step', step]),
  };
  const review = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as () => void;
  review();
  assert.deepEqual(selectedRows, [rows[1]]);
  assert.equal(selectedRows[0], rows[1]);
  assert.deepEqual(events, [['clear', 'retry-scope'], ['page', 0], ['result', null], ['step', 'review']]);

  const harness = importHarness(selectedRows);
  assert.equal(harness.state.sent.length, 0);
  await harness.run(); // The existing confirmation handler is a separate gesture.
  assert.equal(harness.state.sent.length, 1);
  assert.equal(harness.state.sent[0].import_request_key, rows[1].importRequestKey);
  assert.equal(harness.state.sent[0].import_row_number, 3);
  assert.equal(harness.state.sent[0].import_validation_error, undefined);
});

test('actual import blocks required catalogue errors without sending rows or creating tags', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], { cataloguesFailed: true });
  await harness.run();
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
  assert.match(harness.state.errors[0], /catálogos/);
});

test('actual import waits for the selected distribution queue before creating tags or sending rows', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], {
    isAutoDistribute: true, selectedRoundRobin: '77777777-7777-4777-8777-777777777777', isLoadingRoundRobins: true,
  });
  await harness.run();
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
  assert.match(harness.state.errors[0], /carregamento da fila/);
});

test('actual import rejects a selected queue after a catalogue error even with cached queue data', async () => {
  const queueId = '77777777-7777-4777-8777-777777777777';
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], {
    isAutoDistribute: true, selectedRoundRobin: queueId, activeRoundRobins: [{ id: queueId }], roundRobinsError: new Error('Catalogue unavailable'),
  });
  await harness.run();
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
  assert.match(harness.state.errors[0], /Recarregue as filas/);
});

test('actual import rejects a removed distribution queue without silently using automatic rules', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], {
    isAutoDistribute: true, selectedRoundRobin: '77777777-7777-4777-8777-777777777777', activeRoundRobins: [],
  });
  await harness.run();
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
  assert.match(harness.state.errors[0], /não está mais disponível/);
});

test('actual import rejects explicit queue selection without distribution management permission', async () => {
  const queueId = '77777777-7777-4777-8777-777777777777';
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], {
    isAutoDistribute: true, selectedRoundRobin: queueId, activeRoundRobins: [{ id: queueId }], canSelectDistributionQueue: false,
  });
  await harness.run();
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
  assert.match(harness.state.errors[0], /permissão para selecionar uma fila específica/);
});

test('actual automatic import does not depend on the administrative queue catalogue', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana' }], {
    isAutoDistribute: true, selectedRoundRobin: 'automatic', isLoadingRoundRobins: true, roundRobinsError: new Error('Catalogue unavailable'),
    canSelectDistributionQueue: false,
  });
  await harness.run();
  assert.deepEqual(harness.state.errors, []);
  assert.equal(harness.state.sent.length, 1);
  assert.equal(harness.state.sent[0].auto_distribute, true);
  assert.equal(harness.state.sent[0].round_robin_id, undefined);
});

test('actual import preserves a valid explicit queue independently of its target pipeline', async () => {
  const queueId = '77777777-7777-4777-8777-777777777777';
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana' }], {
    isAutoDistribute: true, selectedRoundRobin: queueId,
    activeRoundRobins: [{ id: queueId, target_pipeline_id: '88888888-8888-4888-8888-888888888888' }],
  });
  await harness.run();
  assert.deepEqual(harness.state.errors, []);
  assert.equal(harness.state.sent.length, 1);
  assert.equal(harness.state.sent[0].round_robin_id, queueId);
  assert.equal(harness.state.sent[0].pipeline_id, pipelineId);
});

test('actual import records uncertain tag preparation and does not send a valid lead request', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], {
    contactImportTagAdapter: () => ({ load: async () => [], create: async () => { throw Object.assign(new Error('Timeout'), { code: 'api_timeout', status: 0 }); } }),
  });
  await harness.run();
  assert.ok(harness.unknownPreparationRowsRef.current.has(2));
  assert.match(String(harness.state.sent[0].import_validation_error), /sem confirmação/);
});

test('a remounted identity scope stops preparation before creating tags or dispatching the batch', async () => {
  const scope = { current: true };
  let created = 0;
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], {
    importScopeActiveRef: scope,
    contactImportTagAdapter: () => ({ load: async () => { scope.current = false; return []; }, create: async () => { created += 1; throw new Error('Should not create'); } }),
  });
  await harness.run();
  assert.equal(created, 0);
  assert.equal(harness.state.sent.length, 0);
  assert.deepEqual(harness.state.errors, []);
  assert.equal(harness.recovery.get(harness.scopeKey)?.pending, false);
  assert.equal(harness.recovery.get(harness.scopeKey)?.rows.length, 1);
});

test('actual import canonicalizes a default custom alias exactly like a CSV source', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana' }, { rowNumber: 3, nome: 'Bruna', fonte: 'Meta Ads' }], { selectedSource: 'custom', customSource: ' Meta Ads ' });
  await harness.run();
  assert.deepEqual(harness.state.sent.map(row => row.source), ['meta', 'meta']);
});

test('actual import blocks reserved default sources and reports reserved row sources before creating tags', async () => {
  for (const source of ['all', 'none', 'undefined', '__all__', 'custom']) {
    const defaultSource = importHarness([{ rowNumber: 2, nome: 'Ana', tags: 'Quente' }], { selectedSource: 'custom', customSource: source });
    await defaultSource.run();
    assert.equal(defaultSource.state.sent.length, 0);
    assert.equal(defaultSource.state.createdTags, 0);
    assert.ok(defaultSource.state.errors.length > 0);
    const rowSource = importHarness([{ rowNumber: 2, nome: 'Ana', fonte: source, tags: 'Quente' }]);
    await rowSource.run();
    assert.match(String(rowSource.state.sent[0].import_validation_error), /Origem/);
    assert.equal(rowSource.state.createdTags, 0);
  }
});

test('actual import retains a settled partial report after scope teardown without updating the old UI', async () => {
  const scope = { current: true };
  const expected: ImportLeadsResult = { total: 2, processed: 1, remaining: 1, created: 1, reentered: 0, success: 1, failed: 0, failures: [], reasons: [], unstarted: [{ index: 1, rowNumber: 3, name: 'Bruna' }], stopped: true, distribution: createEmptyImportDistributionSummary() };
  let receivedSignal: AbortSignal | undefined;
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana', importRequestKey: 'first-key' }, { rowNumber: 3, nome: 'Bruna', importRequestKey: 'second-key' }], {
    importScopeActiveRef: scope,
    importLeads: { mutateAsync: async (input: { signal: AbortSignal; shouldContinue: () => boolean; onProgress: (progress: unknown) => void }) => {
      receivedSignal = input.signal;
      assert.equal(input.shouldContinue(), true);
      scope.current = false;
      assert.equal(input.shouldContinue(), false);
      input.onProgress({ ...expected, distribution: expected.distribution });
      return expected;
    } },
  });
  await harness.run();
  assert.ok(receivedSignal);
  assert.equal(harness.state.result, null);
  assert.deepEqual(harness.recovery.get(harness.scopeKey)?.result, expected);
  assert.equal(harness.recovery.get(harness.scopeKey)?.rows[1].importRequestKey, 'second-key');
  assert.deepEqual(harness.state.errors, []);
});

test('a stale dialog callback cannot send rows after a different identity scope activates', async () => {
  const harness = importHarness([{ rowNumber: 2, nome: 'Ana' }]);
  harness.dialogScope.activate('another-organization');
  await harness.run();
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
});

test('actual CSV file handler reports trailing quoted-cell garbage and never exposes corrupted rows', async () => {
  let rows: ParsedContact[] = [];
  const errors: string[] = [];
  const requestRef = { current: 1 };
  const parse = compileHandler('parseFile', {
    parseRequestRef: requestRef, setFile: () => {}, setParsedData: (value: ParsedContact[]) => { rows = value; },
    setIgnoredColumns: () => {}, setIsParsing: () => {},
    decodeContactsCSV, parseContactsCSVRecords, ContactImportFileError, normalizeContactImportRows,
    ignoredContactImportColumns, assignContactImportKeys, formatPtBRNumber: String,
    crypto: { randomUUID: () => 'key' },
    toast: { error: (value: string) => errors.push(value), success: () => {}, info: () => {} },
    console: { error: () => {} },
  }) as (file: File, requestId: number) => Promise<void>;
  await parse(new File(['Nome;Email\n"Ana"Bruna;ana@example.com'], 'invalid.csv'), 1);
  assert.equal(rows.length, 0);
  assert.match(errors[0], /Linha 2.*após o fechamento/);
  rows = [];
  errors.length = 0;
  let finishRead: (value: ArrayBuffer) => void = () => {};
  const oldFile = { name: 'old.csv', arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finishRead = resolve; }) } as File;
  const oldRead = parse(oldFile, 1);
  requestRef.current += 1; // The real dialog scope cleanup invalidates this generation.
  finishRead(new TextEncoder().encode('Nome;Email\nAna;ana@example.com').buffer);
  await oldRead;
  assert.equal(rows.length, 0);
  assert.deepEqual(errors, []);
});

test('actual failure download reports a CSV protection limit before creating a link', () => {
  const errors: string[] = [];
  const download = compileHandler('downloadFailures', {
    importResult: { failures: [{ rowNumber: 2, name: '=' + 'x'.repeat(256), code: 'invalid_import_row', message: 'Nome inválido' }] },
    unknownPreparationRows: new Set(), buildContactExportCSV, contactImportFailureReport,
    toast: { error: (message: string) => errors.push(message) },
    document: { createElement: () => { throw new Error('Should not create a download'); } },
  }) as () => void;
  assert.doesNotThrow(download);
  assert.match(errors[0], /255|XLSX|texto/i);
});
test('cached preparation yields so a context change stops a large batch before any contact request', async () => {
  const scope = { current: true };
  const rows = Array.from({ length: 120 }, (_, index) => ({ rowNumber: index + 2, nome: `Contato ${index}` }));
  const harness = importHarness(rows, { importScopeActiveRef: scope });
  const timer = setTimeout(() => { scope.current = false; }, 0);
  try { await harness.run(); } finally { clearTimeout(timer); }
  assert.equal(harness.state.sent.length, 0);
  assert.equal(harness.state.createdTags, 0);
  assert.equal(harness.recovery.get(harness.scopeKey)?.preparedRows, 50);
  assert.equal(harness.recovery.get(harness.scopeKey)?.rows.length, 120);
  assert.equal(harness.recovery.get(harness.scopeKey)?.pending, false);
});
test('actual recovery effect cannot restore assignment controls hidden by current permissions', () => {
  const calls: ts.CallExpression[] = [];
  const collect = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, collect); };
  collect(ast);
  const callback = calls.find(node => node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('contactImportRecovery.subscribe'))?.arguments[0];
  assert.ok(callback);
  const code = ts.transpileModule(`const effect = ${callback.getText(ast)}; return effect;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const recovery = createContactImportRecoveryStore();
  recovery.start('scope', { rows: [{ rowNumber: 2, nome: 'Ana' }], file: null,
    destination: { pipeline: pipelineId, assignee: user2, source: 'import', customSource: '', autoDistribute: true, roundRobin: 'restricted-queue' },
    pending: false, phase: null, progress: null, result: null, unknownPreparationRows: [], preparedRows: 1, createdTags: 0 });
  const restored: Record<string, unknown> = {};
  const setters = ['File', 'ParsedData', 'IgnoredColumns', 'PreparationIssue', 'IsParsing', 'SelectedPipeline', 'SelectedAssignee', 'SelectedSource', 'CustomSource', 'ShowCustomSourceInput', 'IsAutoDistribute', 'SelectedRoundRobin', 'IsImporting', 'ImportPhase', 'ImportProgress', 'ImportResult', 'UnknownPreparationRows', 'PreparationProgress', 'ActiveStep'];
  const dependencies = { open: true, scopeKey: 'scope', canAssignImportedLeads: false, canSelectDistributionQueue: false,
    contactImportRecovery: recovery, ...Object.fromEntries(setters.map(name => [`set${name}`, (value: unknown) => { restored[name] = value; }])) };
  const effect = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)) as () => () => void;
  const unsubscribe = effect();
  assert.equal(restored.SelectedAssignee, 'none');
  assert.equal(restored.IsAutoDistribute, false);
  assert.equal(restored.SelectedRoundRobin, 'automatic');
  unsubscribe();
});
