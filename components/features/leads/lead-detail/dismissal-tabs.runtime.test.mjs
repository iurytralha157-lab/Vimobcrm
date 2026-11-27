import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';

const source = ts.createSourceFile('LeadDetailDialog.tsx', readFileSync('components/features/leads/LeadDetailDialog.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tabBar = ts.createSourceFile('LeadDetailTabBar.tsx', readFileSync('components/features/leads/lead-detail/LeadDetailTabBar.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const layout = ts.createSourceFile('LeadDetailLayout.tsx', readFileSync('components/features/leads/lead-detail/LeadDetailLayout.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const loss = ts.createSourceFile('LostReasonDialog.tsx', readFileSync('components/features/leads/LostReasonDialog.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(ast, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(ast); return found;
}
function attribute(node, name) { return node.attributes.properties.find(property => property.name?.getText() === name); }
function expression(node, name) { const value = attribute(node, name)?.initializer; return value && ts.isJsxExpression(value) ? value.expression?.getText() : undefined; }
const evaluate = (code, values) => evaluateProduction(`const result = ${code}`, values, 'result');

for (const allowed of [false, true]) for (const pending of [false, true]) test(`both tag pickers can close with allowed=${allowed}, pending=${pending}`, () => {
  // One tag picker renderer serves mobile and desktop.
  const pickers = find(source, node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'Popover' && expression(node, 'open') === 'tagPopoverOpen');
  assert.equal(pickers.length, 1);
  for (const picker of pickers) {
    let open = true;
    const change = evaluate(expression(picker, 'onOpenChange'), { canOperateLead: allowed, isTagMutationPending: pending, setTagPopoverOpen: value => { open = value; } });
    change(false); assert.equal(open, false);
    change(true); assert.equal(open, allowed && !pending);
  }
});

test('loss reason text is disabled during persistence for controlled and default callers', () => {
  const textareas = find(loss, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'Textarea');
  assert.equal(textareas.length, 1);
  const disabled = expression(textareas[0], 'disabled');
  assert.ok(disabled, 'the editable loss reason must share the persistence lock');
  assert.equal(evaluate(disabled, { loading: true }), true);
  assert.equal(evaluate(disabled, { loading: false }), false);
});

const tabIds = ['atividades', 'imoveis', 'arquivos', 'dados', 'transferir', 'origem'];
const domId = (prefix, id, part) => `${prefix}-${id}-${part}`;

test('lead tabs have one tab stop and matching labelled panel containers', () => {
  const buttons = find(tabBar, node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'button' && attribute(node, 'role')?.initializer?.getText() === '"tab"');
  assert.equal(buttons.length, 1);
  const button = buttons[0];
  for (const selected of [false, true]) assert.equal(evaluate(expression(button, 'tabIndex'), { selected }), selected ? 0 : -1);
  // Both layouts render the active panel with the ids the tab points to.
  const panels = find(layout, node => ts.isJsxOpeningElement(node) && attribute(node, 'role')?.initializer?.getText() === '"tabpanel"');
  assert.equal(panels.length, 2);
  for (const id of tabIds) {
    const tabValues = { leadDetailTabDomId: domId, idPrefix: 'synthetic-tabs', tab: { id } };
    const panelValues = { leadDetailTabDomId: domId, props: { tabIdPrefix: 'synthetic-tabs', activeTab: id } };
    for (const panel of panels) {
      assert.equal(evaluate(expression(panel, 'id'), panelValues), evaluate(expression(button, 'aria-controls'), tabValues), id);
      assert.equal(evaluate(expression(panel, 'aria-labelledby'), panelValues), evaluate(expression(button, 'id'), tabValues), id);
    }
  }
});

const keyHandler = (tabs, onChange) => {
  const declaration = find(tabBar, node => ts.isVariableDeclaration(node) && node.name.getText() === 'onKeyDown')[0];
  assert.ok(declaration);
  return evaluate(declaration.initializer.getText(), { tabs, onChange });
};

for (const [from, key, expected] of [[0, 'ArrowRight', 1], [5, 'ArrowRight', 0], [0, 'ArrowLeft', 5], [1, 'ArrowLeft', 0], [3, 'Home', 0], [0, 'End', 5]]) {
  test(`lead tab keyboard ${key} from ${from} selects and focuses ${expected}`, () => {
    let selected, focused, prevented = false;
    const buttons = Array.from({ length: tabIds.length }, (_, index) => ({ focus: () => { focused = index; } }));
    const onKeyDown = keyHandler(tabIds.map(id => ({ id })), id => { selected = id; });
    onKeyDown({ key, target: buttons[from], currentTarget: { querySelectorAll: () => buttons }, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); assert.equal(focused, expected);
    assert.equal(selected, tabIds[expected]);
  });
}

test('lead tab keyboard leaves Tab, Enter and outside targets to native navigation', () => {
  const onKeyDown = keyHandler([], () => assert.fail('must not change tabs'));
  for (const key of ['Tab', 'Enter', 'ArrowRight']) onKeyDown({ key, target: {}, currentTarget: { querySelectorAll: () => [] }, preventDefault: () => assert.fail('must preserve native behavior') });
});
