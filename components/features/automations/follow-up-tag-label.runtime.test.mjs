import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { automationEditorSession } from './flow-editor-compatibility.ts';

// Execute the owning serializers/hydrator, not a duplicate mapper. Only React
// Flow ports are inert for SSR; TagNode's label/action markup remains real.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const sources = new Map();
function parse(file) {
  if (!sources.has(file)) sources.set(file, ts.createSourceFile(file,
    readFileSync(root + file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return sources.get(file);
}
function callback(file, receiver, output) {
  const source = parse(file);
  const matches = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'forEach' && node.expression.expression.getText(source) === receiver &&
        node.arguments[0]?.getText(source).includes(`${output}.push`)) matches.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(matches.length, 1, `one actual ${receiver} -> ${output} callback in ${file}`);
  return ts.transpileModule(`globalThis.run = (${matches[0].getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const newSerializer = callback('components/features/automations/FollowUpBuilder.tsx', 'nodes', 'dbNodes');
const editSerializer = callback('components/features/automations/FollowUpBuilderEdit.tsx', 'nodes', 'dbNodes');
const hydrator = callback('components/features/automations/FollowUpBuilderEdit.tsx', 'automation.nodes', 'flowNodes');
function execute(code, environment, node) {
  const context = vm.createContext(environment);
  vm.runInContext(code, context);
  context.run(node);
}
function save(code, node, tags) {
  const dbNodes = [];
  execute(code, { dbNodes, tags, automationEditorSession, whatsappSessionId: '', replaceSessions: false,
    triggerType: 'lead_stage_changed', triggerConfig: { pipeline_id: 'qa-pipeline', to_stage_id: 'qa-stage' } }, node);
  assert.equal(dbNodes.length, 1);
  return JSON.parse(JSON.stringify(dbNodes[0]));
}
function reload(node) {
  const flowNodes = [];
  execute(hydrator, { flowNodes }, node);
  assert.equal(flowNodes.length, 1);
  return JSON.parse(JSON.stringify(flowNodes[0]));
}
const tagComponentFile = 'components/features/automations/nodes/TagNode.tsx';
const compiledTag = ts.transpileModule(parse(tagComponentFile).getFullText(), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const tagModule = { exports: {} };
new Function('require', 'module', 'exports', compiledTag)(name => name === 'reactflow'
  ? { Handle: () => null, Position: { Left: 'left', Right: 'right' } } : require(name), tagModule, tagModule.exports);
const { TagNode } = tagModule.exports;
const markup = node => renderToStaticMarkup(React.createElement(TagNode, { id: node.id, data: node.data }));
const fixture = (action, name = 'QA Tag Revisada') => ({
  id: 'qa-tag-node', type: 'tag', position: { x: 12.4, y: 24.6 },
  data: { tag_id: 'qa-tag-id', tag_action: action, tag_name: name },
});

for (const action of ['add', 'remove']) {
  test(`new ${action} saves selected tag label through JSON and real edit hydration/SSR`, () => {
    const node = fixture(action);
    const saved = save(newSerializer, node, [{ id: 'qa-tag-id', name: 'QA Tag Revisada' }]);
    assert.deepEqual(saved, {
      id: node.id, node_type: 'action', action_type: `${action}_tag`,
      config: { tag_id: 'qa-tag-id', tag_action: action, tag_name: 'QA Tag Revisada', actionType: `${action}_tag` },
      position_x: 12, position_y: 25,
    });
    const reopened = reload(saved);
    assert.equal(reopened.data.tag_name, 'QA Tag Revisada');
    assert.equal(reopened.data.tag_action, action);
    const html = markup(reopened);
    assert.match(html, /QA Tag Revisada/);
    assert.match(html, action === 'add' ? /Adicionar/ : /Remover/);
    assert.doesNotMatch(html, /Clique para configurar/);
  });

  test(`new ${action} prefers current catalog name and matches edit save contract`, () => {
    const node = fixture(action, 'QA Tag Antiga');
    const tags = [{ id: 'other-tag', name: 'Another label' }, { id: 'qa-tag-id', name: 'QA Tag Atual' }];
    const saved = save(newSerializer, node, tags);
    assert.deepEqual(saved, save(editSerializer, node, tags));
    assert.equal(reload(saved).data.tag_name, 'QA Tag Atual');
    assert.match(markup(reload(saved)), /QA Tag Atual/);
  });

  for (const tags of [undefined, []]) {
    test(`new ${action} preserves configured RAM label when catalog ${tags ? 'is empty' : 'has not loaded'}`, () => {
      const node = fixture(action);
      const saved = save(newSerializer, node, tags);
      assert.deepEqual(saved, save(editSerializer, node, tags));
      assert.equal(reload(saved).data.tag_name, 'QA Tag Revisada');
    });
  }

  test(`unconfigured ${action} retains legacy empty label without inventing catalog data`, () => {
    const node = fixture(action, undefined);
    delete node.data.tag_name;
    const saved = save(newSerializer, node, []);
    assert.deepEqual(saved, save(editSerializer, node, []));
    assert.equal(reload(saved).data.tag_name, '');
    assert.match(markup(reload(saved)), /Clique para configurar/);
  });

  test(`existing persisted ${action} label still reloads without changing tag identity/action`, () => {
    const saved = save(editSerializer, fixture(action), [{ id: 'qa-tag-id', name: 'QA Tag Revisada' }]);
    const reopened = reload(saved);
    assert.equal(reopened.data.tag_id, 'qa-tag-id');
    assert.equal(reopened.data.tag_action, action);
    assert.match(markup(reopened), /QA Tag Revisada/);
  });
}

test('start node payload remains separate from tag presentation metadata', () => {
  const saved = save(newSerializer, { id: 'qa-start', type: 'start', position: { x: 0, y: 0 }, data: {} }, []);
  assert.deepEqual(saved.config, { trigger_type: 'lead_stage_changed', pipeline_id: 'qa-pipeline', to_stage_id: 'qa-stage' });
  assert.equal(saved.action_type, null);
  assert.equal(saved.node_type, 'trigger');
});
