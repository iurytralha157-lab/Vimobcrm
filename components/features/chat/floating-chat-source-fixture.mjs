import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const cache = new Map();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export function parse(path) {
  if (!cache.has(path)) cache.set(path, ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  return cache.get(path);
}
export function nodes(path, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(typeof path === 'string' ? parse(path) : path); return found;
}
export function declaration(path, name) {
  const found = nodes(path, node => (ts.isVariableDeclaration(node) && node.name.getText() === name)
    || (ts.isFunctionDeclaration(node) && node.name?.text === name));
  assert.equal(found.length, 1, `${path}: unique declaration ${name}`);
  return found[0];
}
export function value(path, name, dependencies = {}) {
  const node = declaration(path, name);
  return evaluate(ts.isVariableDeclaration(node) ? node.initializer.getText() : node.getText().replace(/^export /, ''), dependencies, ts.isFunctionDeclaration(node) ? name : undefined);
}
export function evaluate(expression, dependencies = {}, result) {
  const source = result ? `${expression}; return ${result};` : `return (${expression});`;
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const jsx = (type, props) => ({ type, props });
  const require = name => {
    assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' };
  };
  return Function('require', 'exports', ...Object.keys(dependencies), code)(require, {}, ...Object.values(dependencies));
}
export function callback(path, name, dependencies = {}) {
  const node = declaration(path, name);
  const initializer = node.initializer;
  const expression = ts.isCallExpression(initializer) && initializer.expression.getText() === 'useCallback'
    ? initializer.arguments[0] : initializer;
  return evaluate(expression.getText(), dependencies);
}
export function calls(path, name) { return nodes(path, node => ts.isCallExpression(node) && node.expression.getText() === name); }
export function jsx(path, tag, predicate = () => true) {
  return nodes(path, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    && node.tagName.getText() === tag && predicate(node));
}
export function prop(node, name, dependencies = {}) {
  const item = node.attributes.properties.find(attribute => attribute.name?.getText() === name);
  if (!item) return undefined;
  if (!item.initializer) return true;
  if (ts.isStringLiteral(item.initializer)) return item.initializer.text;
  assert.ok(ts.isJsxExpression(item.initializer) && item.initializer.expression, name);
  return evaluate(item.initializer.expression.getText(), dependencies);
}
export function propText(node, name) {
  const item = node.attributes.properties.find(attribute => attribute.name?.getText() === name);
  return item?.initializer?.getText() ?? '';
}
export const cn = (...items) => items.filter(Boolean).join(' ');
export function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
export function effect(path, marker) {
  const matches = calls(path, 'useEffect').filter(call => call.arguments[0]?.getText().includes(marker));
  assert.equal(matches.length, 1, marker); return matches[0].arguments[0];
}

export function hookFixture(path, dependencies = {}) {
  const ast = parse(path);
  const source = ast.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
    .map(node => node.getText().replace(/^export /, '')).join('\n');
  const slots = []; let cursor = 0;
  const changed = (a, b) => !a || !b || b.some((item, index) => item !== a[index]);
  const react = {
    useCallback: fn => fn,
    useMemo(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useLayoutEffect(setup, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: setup() }; } },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
  };
  const exported = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))?.name.text;
  const hook = evaluate(source, { ...react, ...dependencies }, exported);
  return { render(...args) { cursor = 0; return hook(...args); }, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}
