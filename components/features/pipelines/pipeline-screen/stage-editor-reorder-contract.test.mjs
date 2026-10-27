import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
globalThis.fetch = async () => { throw new Error('REGRESSION_NETWORK_FORBIDDEN'); };

function evaluateModule(path, resolveDependency) {
  const exports = {};
  const output = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', output)(resolveDependency, exports);
  return exports;
}
const common = evaluateModule('lib/validation/common.ts', require);
const schemas = evaluateModule('lib/validation/pipelines.ts', (name) => name === './common' ? common : require(name));
const reliability = evaluateModule('lib/pipeline-reliability.ts', require);

function findExpression(path, select) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    const selected = select(node, ast);
    if (selected) expression = selected;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, path);
  return expression.getText(ast);
}
const stagesExpression = findExpression('components/features/pipelines/pipeline-screen/PipelineDialogs.tsx', (node, ast) => {
  if (!ts.isJsxSelfClosingElement(node) || node.tagName.getText(ast) !== 'StagesEditorDialog') return;
  const attribute = node.attributes.properties.find((value) => ts.isJsxAttribute(value) && value.name.getText(ast) === 'stages');
  return attribute && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
});
const editorPath = 'components/features/pipelines/StagesEditorDialog.tsx';
const declaration = (name) => findExpression(editorPath, (node, ast) => (
  ts.isVariableDeclaration(node) && node.name.getText(ast) === name ? node.initializer : undefined
));
const mapProps = new Function('stages', 'PIPELINE_STAGE_COLOR_FALLBACK', `return (${stagesExpression});`);
const editorSave = new Function('sourceStages', 'stagesForSave', 'buildUniqueStageKey', ts.transpileModule(
  `const originalStagesByID = ${declaration('originalStagesByID')}; return (${declaration('stagesToSave')});`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText);

const organization = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pipeline = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const revision = '2026-10-27T12:00:00.123456Z';
const sourceRows = [0, 1].map((index) => ({
  id: index ? '22222222-2222-4222-8222-222222222222' : '11111111-1111-4111-8111-111111111111',
  name: index ? 'Contato' : 'Entrada', color: '#123456', position: index,
  stage_key: index ? 'contact_alias' : 'entry_alias', updated_at: revision,
  total_lead_count: 0, leads: [],
}));
function harness() {
  const requests = [];
  const { pipelinesAPI } = evaluateModule('lib/api/pipelines.ts', (name) => {
    if (name === '@/lib/validation') return { ...common, ...schemas };
    if (name === '@/lib/pipeline-reliability') return reliability;
    if (name === './vimob-client') return { vimobAPIRequest: async (path, options) => {
      const body = JSON.parse(JSON.stringify(options.body));
      // Exact request fields understood by the existing API 7e490c7.
      assert.deepEqual(Object.keys(body), ['stages']);
      for (const stage of body.stages) assert(Object.keys(stage).every((key) => (
        ['id', 'name', 'color', 'stageKey', 'isNew', 'expectedUpdatedAt'].includes(key)
      )));
      requests.push({ path, ...options, body });
      return { data: body.stages.map((stage, position) => ({
        id: stage.id, organizationId: organization, pipelineId: pipeline, name: stage.name,
        color: stage.color, stageKey: stage.stageKey, position,
        isWon: false, isLost: false, isQualified: false, isActive: true,
        createdAt: revision, updatedAt: '2026-10-27T12:00:00.123457Z',
      })) };
    } };
    throw new Error(`Unexpected production dependency: ${name}`);
  });
  const props = mapProps(sourceRows.map((stage) => ({ ...stage })), '#6b7280');
  const save = (values, originals = props) => pipelinesAPI.reorderStages(pipeline,
    editorSave(originals, values, () => { throw new Error('An existing alias must be preserved'); }), organization);
  return { requests, props, save };
}

test('PipelineDialogs forwards the exact stage revision required by the existing save contract', () => {
  const f = harness();
  assert.deepEqual(f.props.map((stage) => stage.updated_at), [revision, revision]);
});

test('real editor and transport reorder existing IDs with exact microseconds and original aliases', async () => {
  const f = harness();
  await f.save([...f.props].reverse());
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.path, `/v1/pipelines/${pipeline}/stages/reorder`);
  assert.equal(request.method, 'POST'); assert.equal(request.organizationId, organization);
  assert.deepEqual(request.body.stages.map((stage) => stage.id), sourceRows.map((stage) => stage.id).reverse());
  assert.deepEqual(request.body.stages.map((stage) => stage.stageKey), sourceRows.map((stage) => stage.stage_key).reverse());
  assert(request.body.stages.every((stage) => stage.expectedUpdatedAt === revision && !stage.isNew));
  assert.equal(request.body.preserveStageKeys, undefined);
});

test('editing names and colors still updates the same column identity', async () => {
  const f = harness();
  await f.save([{ ...f.props[1], name: 'Contato atualizado', color: '#654321' }, f.props[0]]);
  assert.equal(f.requests[0].body.stages[0].id, sourceRows[1].id);
  assert.equal(f.requests[0].body.stages[0].stageKey, sourceRows[1].stage_key);
  assert.equal(f.requests[0].body.stages[0].expectedUpdatedAt, revision);
});

test('only genuinely new draft IDs use the existing isNew contract', async () => {
  const f = harness();
  await f.save([...f.props, { id: '33333333-3333-4333-8333-333333333333', name: 'Visita', color: '#123456', stage_key: 'visit_alias' }]);
  assert(f.requests[0].body.stages.slice(0, 2).every((stage) => !stage.isNew && stage.expectedUpdatedAt === revision));
  assert.equal(f.requests[0].body.stages[2].isNew, true);
  assert.equal(f.requests[0].body.stages[2].expectedUpdatedAt, undefined);
});

test('a missing revision or unsupported legacy alias still prevents any request', async () => {
  const f = harness();
  const missing = f.props.map((stage) => ({ ...stage, updated_at: undefined }));
  await assert.rejects(f.save(missing, missing), /expectedUpdatedAt/);
  const oversized = f.props.map((stage) => ({ ...stage, stage_key: 'x'.repeat(81) }));
  await assert.rejects(f.save(oversized, oversized), /stageKey/);
  assert.equal(f.requests.length, 0);
});
