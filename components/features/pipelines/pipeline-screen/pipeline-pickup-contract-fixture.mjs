import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Reuse the existing real Board/Card/Radix/Chromium harness without importing
// its test cases. Only setup/helpers are evaluated; no product module is mocked
// here. Replace the old harness's synthetic global gate with the expression
// actually wired by PipelinesScreen to PipelineBoard.
export async function createPickupContractHarness() {
  const boardFixtureURL = new URL('./pipeline-board-interactions.runtime.test.mjs', import.meta.url);
  const screenURL = new URL('../PipelinesScreen.tsx', import.meta.url);
  const screenSource = await readFile(screenURL, 'utf8');
  const screen = ts.createSourceFile(fileURLToPath(screenURL), screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer, binding;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(screen) === 'isDragDisabled') initializer = node.initializer;
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(screen) === 'PipelineBoard') {
      binding = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(screen) === 'isDragDisabled');
    }
    ts.forEachChild(node, visit);
  }
  visit(screen);
  assert.ok(initializer, 'Screen must have an explicit drag gate to exercise');
  assert.equal(binding?.initializer?.expression?.getText(screen), 'isDragDisabled', 'exercise the gate actually passed to Board');
  const expression = initializer.getText(screen);

  const fixtureSource = await readFile(boardFixtureURL, 'utf8');
  const fixture = ts.createSourceFile(fileURLToPath(boardFixtureURL), fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const firstTest = fixture.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(fixture) === 'test');
  assert.ok(firstTest, 'reuse only harness setup and helpers before the first case');
  let prefix = fixtureSource.slice(0, firstTest.getFullStart());
  const bindings = new Map();
  for (const declaration of fixture.statements.filter(ts.isImportDeclaration).reverse()) {
    const imported = await import(declaration.moduleSpecifier.text);
    const clause = declaration.importClause;
    if (clause?.name) bindings.set(clause.name.text, imported.default);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const item of clause.namedBindings.elements) bindings.set(item.name.text, imported[item.propertyName?.text || item.name.text]);
    }
    prefix = prefix.slice(0, declaration.getFullStart()) + prefix.slice(declaration.end);
  }
  prefix = prefix.replaceAll('import.meta.url', JSON.stringify(boardFixtureURL.href));
  const marker = '  await writeFile(entry, entrySource);';
  assert.equal(prefix.split(marker).length, 2, 'known harness assembly boundary');
  const substitution = `
    const screenGate=(canOperateLeads,moveContract)=>(${expression});
    entrySource='const screenGate='+screenGate.toString()+';\\n'+entrySource;
    if(!entrySource.includes('isDragDisabled:!!h.disabled,nowMs:'))throw Error('Missing real Board gate');
    entrySource=entrySource.replace('isDragDisabled:!!h.disabled,nowMs:', 'isDragDisabled:screenGate(h.canOperateLeads!==false,h.moveContract||{query:{isError:false}}),nowMs:');
  `;
  prefix = prefix.replace(marker, substitution + marker);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const harness = await new AsyncFunction(...bindings.keys(), prefix + '\nreturn {openBoard,keyboardReady};')(...bindings.values());
  return { ...harness, expression };
}

