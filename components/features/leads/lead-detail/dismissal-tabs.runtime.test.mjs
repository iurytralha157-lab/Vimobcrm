import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { evaluateProduction } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';

const source = ts.createSourceFile('LeadDetailDialog.tsx', readFileSync('components/features/leads/LeadDetailDialog.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
  const pickers = find(source, node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'Popover' && expression(node, 'open') === 'tagPopoverOpen');
  assert.equal(pickers.length, 2);
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

test('mobile tabs have one tab stop and matching labelled panel containers', () => {
  const buttons = find(source, node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'button' && attribute(node, 'role')?.initializer?.getText() === '"tab"');
  assert.equal(buttons.length, 1);
  const button = buttons[0];
  for (const isActive of [false, true]) assert.equal(evaluate(expression(button, 'tabIndex'), { isActive }), isActive ? 0 : -1);
  for (const id of ['summary', 'actions', 'history']) {
    const values = { mobileTabsId: 'synthetic-tabs', tab: { id } };
    const controlledId = evaluate(expression(button, 'aria-controls'), values);
    const panel = find(source, node => ts.isJsxOpeningElement(node) && attribute(node, 'role')?.initializer?.getText() === '"tabpanel"'
      && evaluate(expression(node, 'id'), values) === controlledId)[0];
    assert.ok(panel, id);
    assert.equal(evaluate(expression(panel, 'aria-labelledby'), values), evaluate(expression(button, 'id'), values));
    assert.equal(evaluate(expression(panel, 'hidden'), { mobileActiveTab: id }), false);
    assert.equal(evaluate(expression(panel, 'hidden'), { mobileActiveTab: 'other' }), true);
  }
});

for (const [from, key, expected] of [[0, 'ArrowRight', 1], [2, 'ArrowRight', 0], [0, 'ArrowLeft', 2], [1, 'ArrowLeft', 0], [1, 'Home', 0], [0, 'End', 2]]) {
  test(`mobile tab keyboard ${key} from ${from} selects and focuses ${expected}`, () => {
    const tablist = find(source, node => ts.isJsxOpeningElement(node) && attribute(node, 'role')?.initializer?.getText() === '"tablist"')[0];
    let selected, focused, prevented = false;
    const buttons = Array.from({ length: 3 }, (_, index) => ({ focus: () => { focused = index; } }));
    const onKeyDown = evaluate(expression(tablist, 'onKeyDown'), { mobileTabs: [{ id: 'summary' }, { id: 'actions' }, { id: 'history' }], setActiveTab: id => { selected = id; } });
    onKeyDown({ key, target: buttons[from], currentTarget: { querySelectorAll: () => buttons }, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true); assert.equal(focused, expected);
    assert.equal(selected, ['summary', 'actions', 'history'][expected]);
  });
}

test('mobile tab keyboard leaves Tab, Enter and outside targets to native navigation', () => {
  const tablist = find(source, node => ts.isJsxOpeningElement(node) && attribute(node, 'role')?.initializer?.getText() === '"tablist"')[0];
  const onKeyDown = evaluate(expression(tablist, 'onKeyDown'), { mobileTabs: [], setActiveTab: () => assert.fail('must not change tabs') });
  for (const key of ['Tab', 'Enter', 'ArrowRight']) onKeyDown({ key, target: {}, currentTarget: { querySelectorAll: () => [] }, preventDefault: () => assert.fail('must preserve native behavior') });
});
