import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// These expected outputs are the ef1cefca + Zod 3.25.76 wire-contract oracle.
// CI always checks them against the installed patched Zod. A local comparison can
// additionally execute that exact historical source/package, without installing
// dependencies, using VIMOB_TEST_ZOD3_PACKAGE. Neither loader writes files or
// permits external modules other than the explicitly selected Zod package.
const base = 'ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const currentPackage = process.env.VIMOB_TEST_ZOD4_PACKAGE || 'zod';
const currentZod = require(currentPackage);
const currentVersion = require(`${currentPackage}/package.json`).version;
const legacyPackage = process.env.VIMOB_TEST_ZOD3_PACKAGE;
if (legacyPackage) assert.equal(require(`${legacyPackage}/package.json`).version, '3.25.76');

function modules(zod, historical = false) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    assert(!path.startsWith('../') && !posix.isAbsolute(path), 'Module must stay inside the checkout');
    const source = historical
      ? execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      : readFileSync(join(root, path), 'utf8');
    const exports = {};
    cache.set(path, exports);
    const dependency = (name) => {
      if (name === 'zod') return zod;
      assert(name.startsWith('.') || name.startsWith('@/'), `Unexpected external dependency: ${name}`);
      const stem = name.startsWith('@/') ? name.slice(2) : posix.join(posix.dirname(path), name);
      const target = [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`]
        .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(join(root, candidate)));
      assert(target, `Unresolved trusted source dependency: ${name}`);
      return load(target);
    };
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: path,
    }).outputText;
    new Function('require', 'exports', output)(dependency, exports);
    return exports;
  }
  return load;
}

const current = modules(currentZod);
const legacy = legacyPackage ? modules(require(legacyPackage), true) : undefined;
const id = '11111111-1111-1111-1111-111111111111';
const otherId = '00000000-0000-0000-0000-000000000000';
const revision = '2026-10-27T12:34:56.123456Z';
const metadata = { provider: 'fixture', nested: { flags: [true, null, 3] }, empty: {}, absent: undefined };

function contract(path, name, input, expected) {
  for (const [label, load] of [['patched', current], ...(legacy ? [['ef1 + Zod3', legacy]] : [])]) {
    assert.deepEqual(load(path)[name].parse(input), expected, `${label}: ${name}`);
  }
}

function rejected(path, name, input, issuePath, message) {
  for (const [label, load] of [['patched', current], ...(legacy ? [['ef1 + Zod3', legacy]] : [])]) {
    const result = load(path)[name].safeParse(input);
    assert.equal(result.success, false, `${label}: ${name} must reject`);
    if (issuePath) assert(result.error.issues.some((issue) => (
      JSON.stringify(issue.path) === JSON.stringify(issuePath)
      && (message === undefined || issue.message === message)
    )), `${label}: ${name} issue at ${JSON.stringify(issuePath)}`);
  }
}

test('hotfix executes the patched Zod 4.6.7 root entry point', () => {
  assert.equal(currentVersion, '4.6.7');
});

test('PostgreSQL GUIDs retain nil, legacy version bits, uppercase and trim behavior', () => {
  for (const value of [otherId, id, '11111111-1111-4111-8111-111111111111', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF']) {
    contract('lib/validation/common.ts', 'uuidSchema', `  ${value}  `, value);
  }
  for (const value of ['', 'not-a-guid', `${id}x`, '11111111-1111-1111-1111-11111111111z']) {
    rejected('lib/validation/common.ts', 'uuidSchema', value);
  }
});

test('opaque envelope data remains omittable and preserves explicit undefined/null', () => {
  for (const input of [{}, { data: undefined }, { data: null }, { data: metadata, extra: true }]) {
    contract('lib/validation/common.ts', 'apiUnknownEnvelopeSchema', input, input);
  }
});

test('record envelopes preserve arbitrary metadata but still require an object', () => {
  contract('lib/validation/common.ts', 'apiRecordEnvelopeSchema', { data: metadata }, { data: metadata });
  contract('lib/validation/common.ts', 'apiRecordListEnvelopeSchema', { data: [metadata, {}] }, { data: [metadata, {}] });
  for (const input of [{}, { data: [] }, { data: null }, { data: 'object' }]) {
    rejected('lib/validation/common.ts', 'apiRecordEnvelopeSchema', input, ['data']);
  }
});

test('Meta creative raw payload preserves metadata and the existing creation default', () => {
  contract('lib/validation/schemas.ts', 'metaCreativeAssetSchema', { creative_id: 'fixture' }, { creative_id: 'fixture', raw_payload: {} });
  const input = { creative_id: 'fixture', raw_payload: metadata };
  contract('lib/validation/schemas.ts', 'metaCreativeAssetSchema', input, input);
});

test('recursive lead_meta raw payload still accepts JSON objects, lists, scalars and null', () => {
  for (const payload of [{ nested: [null, { source: 'fixture', count: 1 }] }, ['fixture', true], 1, null]) {
    const input = { data: { id, lead_id: otherId, raw_payload: payload, created_at: revision } };
    contract('lib/validation/auxiliary.ts', 'apiLeadMetaResponseSchema', input, input);
  }
  rejected('lib/validation/auxiliary.ts', 'apiLeadMetaResponseSchema', { data: { id, lead_id: otherId, raw_payload: undefined, created_at: revision } });
});

test('typed record counters retain keys and reject invalid values', () => {
  const input = { data: { [id]: 0, [otherId]: 42, arbitrary_stage_key: 3 } };
  contract('lib/validation/pipelines.ts', 'pipelineStageCountsResponseSchema', input, input);
  rejected('lib/validation/pipelines.ts', 'pipelineStageCountsResponseSchema', { data: { [id]: -1 } });
  rejected('lib/validation/pipelines.ts', 'pipelineStageCountsResponseSchema', { data: { [id]: '1' } });
});

test('permission records keep false and reject nonboolean permissions and unknown root fields', () => {
  const input = { permissions: { can_export: true, can_manage_columns: false } };
  contract('lib/validation/settings.ts', 'replaceUserPermissionsInputSchema', input, input);
  rejected('lib/validation/settings.ts', 'replaceUserPermissionsInputSchema', { permissions: { can_export: 'false' } });
  rejected('lib/validation/settings.ts', 'replaceUserPermissionsInputSchema', { ...input, role: 'admin' });
});

test('automation opaque config can remain absent without materializing a key', () => {
  const node = { id, automation_id: otherId, node_type: 'action', action_type: null, position_x: 0, position_y: 0, created_at: revision };
  contract('lib/validation/automations.ts', 'apiAutomationNodeSchema', node, node);
  const automation = { id, organization_id: otherId, name: 'Fixture', description: null, is_active: true, trigger_type: 'manual', created_by: null, created_at: revision, updated_at: revision };
  contract('lib/validation/automations.ts', 'apiAutomationSchema', automation, automation);
  contract('lib/validation/automations.ts', 'apiAutomationNodeSchema', { ...node, config: null }, { ...node, config: null });
});

test('activity metadata missing remains distinct from explicit null', () => {
  const input = { id, organization_id: otherId, lead_id: id, user_id: null, type: 'note', content: null, created_at: revision };
  contract('lib/validation/crm-support.ts', 'apiActivitySchema', input, input);
  contract('lib/validation/crm-support.ts', 'apiActivitySchema', { ...input, metadata: null }, { ...input, metadata: null });
});

test('Home PATCH updates only supplied fields, without injecting any creation defaults', () => {
  contract('lib/validation/home.ts', 'updateHomePublicationInputSchema', { title: '  Fixture title  ' }, { title: 'Fixture title' });
  for (const input of [
    { isActive: false }, { displayOrder: 0 }, { cardSize: 'wide' }, { accent: 'blue' },
    { startsAt: null }, { endsAt: null }, { targetType: 'all' },
    { targetOrganizationIds: [] }, { targetUserIds: [] }, { targetRoles: [] },
  ]) contract('lib/validation/home.ts', 'updateHomePublicationInputSchema', input, input);
  rejected('lib/validation/home.ts', 'updateHomePublicationInputSchema', {}, [], 'Informe ao menos uma alteração.');
  rejected('lib/validation/home.ts', 'updateHomePublicationInputSchema', { unexpected: true });
});

test('Home creation still supplies defaults and enforces schedule and audience rules', () => {
  const input = { title: 'Fixture title', body: 'Fixture body', ctaLabel: 'Abrir Pipeline', ctaHref: '/crm/pipelines' };
  contract('lib/validation/home.ts', 'createHomePublicationInputSchema', input, {
    ...input, cardSize: 'half', accent: 'orange', displayOrder: 0, isActive: true,
    startsAt: null, endsAt: null, targetType: 'all', targetOrganizationIds: [], targetUserIds: [], targetRoles: [],
  });
  rejected('lib/validation/home.ts', 'updateHomePublicationInputSchema', { startsAt: '2026-10-27T12:00:00Z', endsAt: '2026-10-27T11:00:00Z' }, ['endsAt']);
  rejected('lib/validation/home.ts', 'createHomePublicationInputSchema', { ...input, targetType: 'users' }, ['targetUserIds']);
  rejected('lib/validation/home.ts', 'updateHomePublicationInputSchema', { targetType: 'users', targetUserIds: [id, id] }, ['targetUserIds']);
});

test('cadence optional text preserves absent keys and explicit empty/null normalization', () => {
  const input = { position: 0, type: 'call', title: 'Contato', due_minutes: 60, is_required: false, outcome_required: false };
  contract('lib/validation/cadences.ts', 'stageOperationalCadenceTaskSchema', input, input);
  for (const description of ['', null, undefined]) {
    contract('lib/validation/cadences.ts', 'stageOperationalCadenceTaskSchema', { ...input, description }, { ...input, description: undefined });
  }
  rejected('lib/validation/cadences.ts', 'stageOperationalCadenceTaskSchema', { ...input, description: 'x'.repeat(2_001) }, ['description']);
});

test('dashboard enum and GUID preprocessing preserve historical accepted filters', () => {
  const range = { dateFrom: '2026-10-01', dateTo: '2026-10-27' };
  contract('lib/validation/schedule-dashboard.ts', 'scheduleDashboardQuerySchema', { ...range, eventType: ' VISIT ', teamId: ` ${id} `, userId: 'all' }, { ...range, dateBasis: 'start_time', teamId: id, userId: undefined, eventType: 'visit' });
  rejected('lib/validation/schedule-dashboard.ts', 'scheduleDashboardQuerySchema', { ...range, eventType: 'unknown' }, ['eventType']);
  contract('lib/validation/marketing.ts', 'campaignInsightsQuerySchema', { ...range, teamId: otherId, tagIds: `${id}, ${id}` }, { ...range, teamId: otherId, tagIds: id });
});

test('privacy consent retains the exact message and requires literal true', () => {
  for (const [label, load] of [['patched', current], ...(legacy ? [['ef1 + Zod3', legacy]] : [])]) {
    const consent = load('lib/validation/public-site.ts').publicSiteContactSchema.shape.privacy_accepted;
    assert.equal(consent.parse(true), true, label);
    for (const input of [false, undefined, 'true', 1]) {
      const result = consent.safeParse(input);
      assert.equal(result.success, false, label);
      assert.equal(result.error.issues[0].message, 'Aceite a politica de privacidade para continuar', label);
    }
  }
});

test('reorder request retains the complete legacy API 7e490 stage identity and microsecond revision', () => {
  const input = { stages: [
    { id, name: '  Entrada  ', color: '#abcdef', stageKey: 'entry_alias', expectedUpdatedAt: revision },
    { id: otherId, name: 'Visita', stageKey: 'visit_alias', isNew: true },
  ] };
  contract('lib/validation/pipelines.ts', 'stagesReorderInputSchema', input, { stages: [{ ...input.stages[0], name: 'Entrada' }, input.stages[1]] });
  rejected('lib/validation/pipelines.ts', 'stagesReorderInputSchema', { stages: [{ id, name: 'Entrada' }] }, ['stages', 0, 'expectedUpdatedAt'], 'Atualize as colunas antes de salvar');
  rejected('lib/validation/pipelines.ts', 'stagesReorderInputSchema', { stages: [input.stages[0]], preserveStageKeys: true });
  rejected('lib/validation/pipelines.ts', 'stagesReorderInputSchema', { stages: [{ ...input.stages[0], isNew: true }] }, ['stages', 0, 'expectedUpdatedAt']);
  rejected('lib/validation/pipelines.ts', 'stagesReorderInputSchema', { stages: [input.stages[0], input.stages[0]] }, ['stages', 1, 'id'], 'Etapa duplicada');
});

test('patched array maxima reject oversize payloads before parsing members or accumulating per-item issues', () => {
  const z = currentZod.z;
  let visits = 0;
  const schema = z.array(z.preprocess((value) => { visits++; return value; }, z.object({ value: z.string() }))).max(2);
  const hostile = Array.from({ length: 2_048 }, () => ({}));
  const result = schema.safeParse(hostile);
  assert.equal(result.success, false);
  assert.equal(visits, 0);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
  assert.equal(result.error.issues[0].maximum, 2);
  assert.equal(result.error.issues[0].origin, 'array');
  if (legacyPackage) {
    const old = require(legacyPackage).z.array(require(legacyPackage).z.object({ value: require(legacyPackage).z.string() })).max(2).safeParse(hostile);
    assert.equal(old.success, false);
    assert.equal(old.error.issues.length, hostile.length + 1, 'Baseline reproduces the issue-amplification behavior intentionally removed by patched Zod');
  }
});

test('actual legacy reorder schema rejects an oversized invalid body with one bounded size issue', () => {
  const result = current('lib/validation/pipelines.ts').stagesReorderInputSchema.safeParse({ stages: Array.from({ length: 101 }, () => ({})) });
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
  assert.deepEqual(result.error.issues[0].path, ['stages']);
});
