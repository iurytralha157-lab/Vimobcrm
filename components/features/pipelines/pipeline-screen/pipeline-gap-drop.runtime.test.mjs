import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { closestCenter, pointerWithin } from '@dnd-kit/core';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const adapterPath = resolve(process.env.PIPELINE_GAP_DRAG_SOURCE || join(repository, 'components/features/pipelines/pipeline-screen/PipelineDragBoard.tsx'));
const source = await readFile(adapterPath, 'utf8');
const ast = ts.createSourceFile(adapterPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
console.info('PIPELINE_GAP_SOURCE', JSON.stringify({ path: adapterPath, sha256: createHash('sha256').update(source).digest('hex') }));

function declaration(name, tree = ast) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) found = `const ${node.getText(tree)};`;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(tree).replace(/^export /, '');
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(found, `actual adapter declaration ${name} must exist`);
  return found;
}

function evaluate(name, context, tree = ast) {
  const compiled = ts.transpileModule(declaration(name, tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return Function(...Object.keys(context), `${compiled}\nreturn ${name};`)(...Object.values(context));
}

const collisions = evaluate('collisions', { closestCenter, pointerWithin });
const capabilityPath = join(repository, 'lib/lead-operation-capability.ts');
const capabilityAST = ts.createSourceFile(capabilityPath, await readFile(capabilityPath, 'utf8'), ts.ScriptTarget.Latest, true);
const leadProgressCapability = evaluate('leadProgressCapability', {}, capabilityAST);
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const lead = (id, stageId) => ({ id, stage_id: stageId, can_operate: true });

function dropAt({ same = false, sourceIndex = 0, y = 113, heights = [100, 100, 100], allowed = true, x = 100 }) {
  const destination = { id: 'destination', leads: heights.map((_, index) => lead(`target-${index}`, 'destination')) };
  const origin = same ? destination : { id: 'origin', leads: [lead('moving', 'origin')] };
  const active = origin.leads[sourceIndex]; active.can_operate = allowed;
  const stages = same ? [destination] : [origin, destination];
  const containers = [], rects = new Map();
  const add = (id, data, measured) => { containers.push({ id, data: { current: data }, disabled: false }); rects.set(id, measured); };
  add('pipeline-stage:destination', { kind: 'stage', stageId: 'destination' }, rect(0, 0, 280, 500));
  let top = 10;
  destination.leads.forEach((row, index) => { add(row.id, { kind: 'lead', stageId: destination.id, index }, rect(10, top, 260, heights[index])); top += heights[index] + 6; });
  const activeRect = rect(x - 20, y - 20, 40, 40);
  const hits = collisions({ active: { id: active.id }, pointerCoordinates: { x, y }, collisionRect: activeRect,
    droppableContainers: containers, droppableRects: rects });
  const hit = hits[0], container = containers.find(item => item.id === hit?.id);
  const start = { draggableId: active.id, type: 'DEFAULT', mode: 'FLUID', source: { droppableId: origin.id, index: sourceIndex } };
  let result;
  const finish = evaluate('finish', { stages, disabled: false, source: { current: start }, keyboardTarget: { current: null }, leadProgressCapability,
    setActiveId() {}, onDragEnd: value => { result = value; } });
  finish({ active: { id: active.id, rect: { current: { translated: activeRect } } }, collisions: hits,
    over: container ? { id: container.id, data: container.data, rect: rects.get(container.id) } : null });
  return { result, hits };
}

test('actual pointer collision and finish insert into a cross-column gap', () => {
  const { result, hits } = dropAt({});
  assert.equal(hits[0]?.id, 'pipeline-stage:destination', 'exercise the column-only gap path');
  assert.deepEqual(result.destination, { droppableId: 'destination', index: 1 });
});

test('actual pointer gaps exclude the active row for same-column upward and downward movement', () => {
  assert.equal(dropAt({ same: true, sourceIndex: 2 }).result.destination?.index, 1);
  assert.equal(dropAt({ same: true, sourceIndex: 0, y: 219 }).result.destination?.index, 1);
});

test('gaps use the measured card heights and the position above the first card', () => {
  assert.equal(dropAt({ heights: [64, 150, 80], y: 77 }).result.destination?.index, 1);
  assert.equal(dropAt({ y: 5 }).result.destination?.index, 0);
});

test('empty and terminal space retain their insertion boundaries', () => {
  assert.equal(dropAt({ heights: [], y: 50 }).result.destination?.index, 0);
  assert.equal(dropAt({ y: 400 }).result.destination?.index, 3);
  assert.equal(dropAt({ same: true, sourceIndex: 0, y: 400 }).result.destination?.index, 2);
});

test('direct card hits, outside drops and lost operation permission retain their behavior', () => {
  assert.equal(dropAt({ y: 30 }).result.destination?.index, 0);
  assert.equal(dropAt({ x: 400 }).result.destination, null);
  assert.equal(dropAt({ allowed: false }).result.destination, null);
});

test('the actual Screen permits a visible gap in a partial column and still blocks its terminal drop', async () => {
  const screenPath = join(repository, 'components/features/pipelines/PipelinesScreen.tsx');
  const screen = ts.createSourceFile(screenPath, await readFile(screenPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const modelPath = join(repository, 'components/features/pipelines/pipeline-screen/model.ts');
  const model = ts.createSourceFile(modelPath, await readFile(modelPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const isUnsafePartialStageDrop = evaluate('isUnsafePartialStageDrop', {}, model);
  for (const [y, expectedMoves, expectedWarnings] of [[113, 1, 0], [400, 0, 1]]) {
    const result = dropAt({ y }).result, moves = [], warnings = [];
    const stages = [{ id: 'origin', leads: [lead('moving', 'origin')] },
      { id: 'destination', has_more: true, leads: [0, 1, 2].map(index => lead(`target-${index}`, 'destination')) }];
    const handleDragEnd = evaluate('handleDragEnd', { stages, stageAutomations: [], canOperateLeads: true, leadProgressCapability,
      dragMoveSnapshotRef: { current: { revision: { leadId: 'moving', sourceStageId: 'origin' },
        operation: { isCurrent: () => true }, queryKeyId: 'board' } }, isDraggingRef: { current: true },
      pipelineBoardQueryKeyId: 'board', pipelineBoardQueryKey: ['stages-with-leads', 'synthetic-org'],
      queryClient: { invalidateQueries() { assert.fail('valid drag must not need an access refresh'); } },
      useCallback: callback => callback, isUnsafePartialStageDrop,
      getOptimisticDealStatusForStage: () => null, getOptimisticAutomationDealStatusForStage: () => null,
      setPendingLostMove() { assert.fail('ordinary column is not lost'); }, setLostReasonLead() {},
      toast: { error: assert.fail, warning: text => warnings.push(text) }, executeLeadMove: async value => moves.push(value),
    }, screen);
    await handleDragEnd(result);
    assert.equal(moves.length, expectedMoves, `actual Screen mutation count at y=${y}`);
    assert.equal(warnings.length, expectedWarnings, `actual Screen partial-end warning count at y=${y}`);
    if (moves.length) assert.equal(moves[0].destination.index, 1);
  }
});

let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-gap-'));
  const entry = join(directory, 'entry.js'), card = join(directory, 'lead-card.js'), loader = join(directory, 'tsx-loader.cjs');
  // Only card contents/auth/actions are synthetic. The production adapter,
  // sortable measurements, transforms, placeholder, overlay and sensors are real.
  await writeFile(card, `import React from'react';export function LeadCard({lead,dragPresentation:p}){return React.createElement('article',{ref:p.innerRef,'data-lead':lead.id,style:{height:lead.height,flexShrink:0,background:'#eee',boxSizing:'border-box',...p.style}},React.createElement('button',{ref:p.handleRef,...p.handleProps,style:{display:'block',width:'100%',height:'100%',border:0,padding:0,background:'transparent'}},lead.id))}`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const source=${JSON.stringify(source)};module.exports=function(s){if(require('node:path').basename(this.resourcePath)==='PipelineDragBoard.tsx')s=source.replace('onDragStart={begin}','onDragOver={e=>{window.h.over=e.over?.id}} onDragMove={e=>{window.h.debug={over:e.over?.id,collisions:e.collisions?.map(c=>({id:c.id,index:c.data?.pipelineInsertionIndex}))}}} onDragStart={begin}');return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{PipelineDragBoard,PipelineDropColumn,PipelineSortableLeadCard}from${JSON.stringify(join(repository, 'components/features/pipelines/pipeline-screen/PipelineDragBoard.tsx'))};
    const root=createRoot(document.getElementById('root'));const h=window.h={dragging:false,stages:[{id:'a',name:'A',leads:[96,112,80].map((height,index)=>({id:'a'+index,stage_id:'a',can_operate:true,height}))},{id:'b',name:'B',leads:[96,112,80].map((height,index)=>({id:'b'+index,stage_id:'b',can_operate:true,height}))}]};
    h.render=()=>root.render(React.createElement(PipelineDragBoard,{stages:h.stages,disabled:!!h.disabled,onDragStart:()=>{h.dragging=true},onDragEnd:result=>{h.dragging=false;h.drop=result},renderOverlay:id=>React.createElement('div',{'data-overlay':id,style:{width:264,height:80,background:'orange'}},id)},React.createElement('main',{style:{display:'flex',gap:20}},h.stages.map(stage=>React.createElement(PipelineDropColumn,{key:stage.id,stage,className:'stage'},stage.leads.map((lead,index)=>React.createElement(PipelineSortableLeadCard,{key:lead.id,stageId:stage.id,lead,index,onClick:()=>{},isDragDisabled:false})))))));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'gap.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: {
        '@/components/features/leads/LeadCard': card, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'gap.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.ok(dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('vimob-pipeline-gap-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Chromium: gap drop preserves the real sortable placeholder and transformed card behavior', { timeout: 20_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  await page.route('**/*', route => route.abort());
  try {
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: 'body{margin:20px}.stage{width:280px;height:440px;display:flex;flex-direction:column;gap:6px;padding:8px;overflow:auto;box-sizing:border-box;background:#fafafa}' });
    await page.addScriptTag({ content: bundle });
    const column = page.locator('[data-pipeline-drop-column="a"]');
    await column.locator('article').last().waitFor();
    const first = await column.locator('article').nth(0).boundingBox();
    const second = await column.locator('article').nth(1).boundingBox();
    const moving = column.locator('article').nth(2), start = await moving.boundingBox();
    const pointer = { x: start.x + start.width / 2, y: start.y + 20 };
    await page.mouse.move(pointer.x, pointer.y); await page.mouse.down();
    await page.mouse.move(pointer.x + 8, pointer.y, { steps: 2 });
    await page.waitForFunction(() => window.h.dragging);
    assert.equal(await page.locator('[data-overlay="a2"]').count(), 1);
    assert.equal(await moving.evaluate(element => getComputedStyle(element).opacity), '0.25', 'source stays as the sortable placeholder');
    await page.mouse.move(pointer.x, first.y + first.height / 2, { steps: 8 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-pipeline-drop-column="a"] article')]
      .some(element => element.dataset.lead !== 'a2' && element.style.transform));
    const gapY = (first.y + first.height + second.y) / 2;
    await page.mouse.move(pointer.x, gapY, { steps: 4 });
    await page.waitForFunction(() => window.h.over === 'pipeline-stage:a');
    await page.mouse.up(); await page.waitForFunction(() => !window.h.dragging);
    const drop = await page.evaluate(() => window.h.drop);
    console.info('PIPELINE_GAP_BROWSER_DROP', JSON.stringify(drop));
    assert.deepEqual(drop.destination, { droppableId: 'a', index: 1 });
    assert.equal(await column.locator('article').count(), 3, 'the fixture did not mutate or remove a card');
    await page.locator('[data-overlay]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-overlay]').count(), 0);
  } finally { await page.close(); }
});
