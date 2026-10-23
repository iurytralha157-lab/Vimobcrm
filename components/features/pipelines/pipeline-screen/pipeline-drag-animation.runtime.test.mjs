import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// Real adapter, sensors, sortable nodes and overlay. The parent only simulates
// synchronous optimistic cache placement / a cold contract check / rollback.
// No CRM requests, service, credentials or operational database are used.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const adapterPath = process.env.PIPELINE_DRAG_ANIMATION_SOURCE_FILE || join(repository, 'components/features/pipelines/pipeline-screen/PipelineDragBoard.tsx');
const adapterSource = await readFile(adapterPath, 'utf8');
const adapterHash = createHash('sha256').update(adapterSource).digest('hex');
const expectedSubscriptions = adapterSource.includes('subscribeReducedMotion') ? 1 : 0;
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-drag-animation-'));
  const entry = join(directory, 'entry.js'), card = join(directory, 'card.js'), loader = join(directory, 'loader.cjs');
  await writeFile(card, `import React from'react';export function LeadCard({lead,dragPresentation:p}){return React.createElement('article',{ref:p.innerRef,'data-lead':lead.id,style:{height:lead.height,flexShrink:0,background:'#eee',boxSizing:'border-box',...p.style}},React.createElement('button',{ref:p.handleRef,...p.handleProps,style:{display:'block',width:'100%',height:'100%',border:0,padding:0,background:'transparent'}},lead.id))}`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const adapter=${JSON.stringify(adapterSource)};module.exports=function(s){if(require('node:path').basename(this.resourcePath)==='PipelineDragBoard.tsx')s=adapter;return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{PipelineDragBoard,PipelineDropColumn,PipelineSortableLeadCard}from${JSON.stringify(join(repository, 'components/features/pipelines/pipeline-screen/PipelineDragBoard.tsx'))};
    const root=createRoot(document.getElementById('root'));const h=window.h;Object.assign(h,{dragging:false,mode:'warm',calls:[],stages:[{id:'a',name:'A',leads:[96,112,80].map((height,index)=>({id:'a'+index,stage_id:'a',can_operate:true,height}))},{id:'b',name:'B',leads:[96,112,80].map((height,index)=>({id:'b'+index,stage_id:'b',can_operate:true,height}))}]});
    h.original=structuredClone(h.stages);h.commit=result=>{if(!result.destination)return;const lead=h.stages.flatMap(s=>s.leads).find(l=>l.id===result.draggableId);const next=h.stages.map(s=>({...s,leads:s.leads.filter(l=>l.id!==result.draggableId)}));next.find(s=>s.id===result.destination.droppableId).leads.splice(result.destination.index,0,{...lead,stage_id:result.destination.droppableId});h.stages=next;h.render()};
    h.rollback=()=>{h.stages=structuredClone(h.original);h.render()};h.unmount=()=>root.unmount();h.commitPending=()=>{h.commit(h.pending);h.pending=null};
    h.render=()=>root.render(React.createElement(PipelineDragBoard,{stages:h.stages,disabled:!!h.disabled,onDragStart:()=>{h.dragging=true},onDragEnd:result=>{h.dragging=false;h.calls.push(result);if(h.mode==='warm')h.commit(result);else h.pending=result},renderOverlay:id=>React.createElement('div',{'data-overlay':id,style:{height:96,background:'orange'}},id)},React.createElement('main',{style:{display:'flex',gap:20}},h.stages.map(stage=>React.createElement(PipelineDropColumn,{key:stage.id,stage,className:'stage'},stage.leads.map((lead,index)=>React.createElement(PipelineSortableLeadCard,{key:lead.id,stageId:stage.id,lead,index,onClick:()=>{},isDragDisabled:false})))))));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'animation.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: {
        '@/components/features/leads/LeadCard': card, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'animation.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.ok(dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('vimob-drag-animation-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function openBoard({ reducedMotion = 'no-preference', width = 960 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 720 }, reducedMotion });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: 'body{margin:20px}.stage{width:280px;height:440px;display:flex;flex-direction:column;gap:6px;padding:8px;overflow:auto;box-sizing:border-box;background:#fafafa}' });
  await page.evaluate(() => {
    window.h = { animations: [], motionListeners: 0 };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      window.h.animations.push({ animation, node: this, frames, options });
      return animation;
    };
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = matchMedia(query), add = result.addEventListener.bind(result), remove = result.removeEventListener.bind(result);
      result.addEventListener = (event, ...args) => { if (query === '(prefers-reduced-motion: reduce)' && event === 'change') window.h.motionListeners++; return add(event, ...args); };
      result.removeEventListener = (event, ...args) => { if (query === '(prefers-reduced-motion: reduce)' && event === 'change') window.h.motionListeners--; return remove(event, ...args); };
      return result;
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.locator('[data-lead="a0"]').waitFor();
  await page.waitForFunction(expected => window.h.motionListeners === expected, expectedSubscriptions);
  return page;
}

async function startMove(page, id = 'a0', destination = 'b1') {
  const source = await page.locator(`[data-lead="${id}"]`).boundingBox();
  const target = await page.locator(`[data-lead="${destination}"]`).boundingBox();
  await page.mouse.move(source.x + 40, source.y + 20); await page.mouse.down();
  await page.mouse.move(source.x + 48, source.y + 20, { steps: 2 });
  await page.waitForFunction(() => window.h.dragging);
  await page.mouse.move(target.x + 40, target.y + 5, { steps: 4 });
}

async function settled(page) {
  await page.waitForFunction(() => !window.h.dragging && !document.querySelector('[data-overlay]'));
}

test('warm synchronous optimistic placement settles through one 160ms transform animation', { timeout: 20_000 }, async () => {
  const page = await openBoard();
  try {
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.animations.length === 1);
    const transition = await page.evaluate(() => {
      const record = window.h.animations[0];
      return { duration: record.options.duration, keys: Object.keys(record.frames[0]), overlays: document.querySelectorAll('[data-overlay]').length,
        destination: document.querySelector('[data-pipeline-drop-column="b"] [data-lead="a0"]')?.style.opacity,
        calls: window.h.calls.length, dragging: window.h.dragging, state: record.animation.playState,
        inert: Boolean(document.querySelector('[data-overlay]')?.closest('[inert]')), listeners: window.h.motionListeners };
    });
    assert.equal(transition.duration, 160); assert.deepEqual(transition.keys, ['transform']);
    assert.equal(transition.overlays, 1); assert.equal(transition.destination, '0');
    assert.equal(transition.calls, 1); assert.equal(transition.dragging, false); assert.equal(transition.state, 'running');
    assert.equal(transition.inert, true); assert.equal(transition.listeners, 1);
    await settled(page);
    assert.equal(await page.locator('[data-pipeline-drop-column="b"] [data-lead="a0"]').count(), 1);
    assert.equal(await page.locator('[data-lead="a0"]').evaluate(node => getComputedStyle(node).opacity), '1');
  } finally { await page.close(); }
});

test('fast rollback cancels obsolete settling and never leaves a ghost over a rejected destination', { timeout: 20_000 }, async () => {
  const page = await openBoard();
  try {
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.animations.length === 1);
    await page.evaluate(() => window.h.rollback());
    await page.waitForFunction(() => document.querySelector('[data-pipeline-drop-column="a"] [data-lead="a0"]'));
    // DOM retirement can happen between frames. Assert the next presented frame,
    // while the old 160ms animation would still be running without cancellation.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const stale = await page.evaluate(() => ({ state: window.h.animations[0].animation.playState,
      overlays: document.querySelectorAll('[data-overlay]').length, opacity: getComputedStyle(document.querySelector('[data-lead="a0"]')).opacity }));
    assert.equal(stale.overlays, 0, 'rollback must remove the obsolete overlay as its destination node is retired');
    assert.notEqual(stale.state, 'running'); assert.equal(stale.opacity, '1');
    assert.equal(await page.evaluate(() => window.h.calls.length), 1, 'visual cancellation cannot submit a second movement');
  } finally { await page.close(); }
});

test('a second gesture retires the prior drop ghost while retaining one active overlay', { timeout: 20_000 }, async () => {
  const page = await openBoard();
  try {
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.animations.length === 1);
    await startMove(page, 'a1', 'b2');
    assert.equal(await page.locator('[data-overlay]').count(), 1);
    assert.equal(await page.locator('[data-overlay="a1"]').count(), 1);
    await page.keyboard.press('Escape'); await page.mouse.up(); await settled(page);
    const calls = await page.evaluate(() => window.h.calls.map(item => item.reason));
    assert.deepEqual(calls, ['DROP', 'CANCEL']);
  } finally { await page.close(); }
});

test('settling never intercepts a repeat pointer gesture on the same lead', { timeout: 20_000 }, async () => {
  const page = await openBoard();
  try {
    await page.evaluate(() => { window.h.mode = 'cold'; });
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.animations.length === 1);
    const ghostPointerEvents = await page.locator('[data-overlay]').evaluate(node => getComputedStyle(node.parentElement.parentElement).pointerEvents);
    assert.equal(ghostPointerEvents, 'none');
    await startMove(page); await page.mouse.up(); await settled(page);
    assert.equal(await page.evaluate(() => window.h.calls.length), 2);
    assert.equal(await page.locator('[data-lead="a0"]').evaluate(node => getComputedStyle(node).opacity), '1');
  } finally { await page.close(); }
});

test('cold compatibility check keeps the original node until the parent explicitly accepts the move', { timeout: 20_000 }, async () => {
  const page = await openBoard();
  try {
    await page.evaluate(() => { window.h.mode = 'cold'; });
    await startMove(page); await page.mouse.up(); await settled(page);
    assert.equal(await page.locator('[data-pipeline-drop-column="a"] [data-lead="a0"]').count(), 1);
    assert.equal(await page.locator('[data-pipeline-drop-column="b"] [data-lead="a0"]').count(), 0);
    assert.equal(await page.evaluate(() => window.h.calls.length), 1);
    await page.evaluate(() => window.h.commitPending());
    await page.locator('[data-pipeline-drop-column="b"] [data-lead="a0"]').waitFor();
    assert.equal(await page.locator('[data-overlay]').count(), 0, 'late parent placement cannot replay the gesture or ghost');
  } finally { await page.close(); }
});

test('reduced motion disables settling and sortable/keyboard movement transitions with one listener', { timeout: 20_000 }, async () => {
  const page = await openBoard({ reducedMotion: 'reduce' });
  try {
    await startMove(page); await page.mouse.up(); await settled(page);
    assert.equal(await page.evaluate(() => window.h.animations.length), 0);
    assert.equal(await page.evaluate(() => window.h.motionListeners), 1);
    await page.locator('[data-lead="a1"] button').focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => window.h.dragging);
    const overlayTransition = await page.locator('[data-overlay]').evaluate(node => getComputedStyle(node.parentElement.parentElement).transitionDuration);
    assert.equal(overlayTransition, '0s');
    await page.keyboard.press('Escape'); await settled(page);
    await page.evaluate(() => window.h.unmount());
    assert.equal(await page.evaluate(() => window.h.motionListeners), 0);
  } finally { await page.close(); }
});

test('changing the motion preference and unmounting during a drop cleans the animation and subscription', { timeout: 20_000 }, async () => {
  const page = await openBoard();
  try {
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.animations.length === 1);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await settled(page);
    assert.notEqual(await page.evaluate(() => window.h.animations[0].animation.playState), 'running');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => window.h.rollback());
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.animations.length === 2);
    await page.evaluate(() => window.h.unmount());
    assert.equal(await page.locator('[data-overlay]').count(), 0);
    assert.equal(await page.evaluate(() => window.h.motionListeners), 0);
    assert.notEqual(await page.evaluate(() => window.h.animations[1].animation.playState), 'running');
  } finally { await page.close(); }
});

test('drop presentation measurement with 300 synthetic sortable cards', { timeout: 30_000 }, async () => {
  const page = await openBoard();
  try {
    await page.evaluate(() => {
      window.h.stages = window.h.stages.map(stage => ({ ...stage, leads: Array.from({ length: 150 }, (_, index) => ({ ...stage.leads[index % 3], id: `${stage.id}${index}` })) }));
      window.h.render();
      window.h.longTasks = [];
      window.h.observer = new PerformanceObserver(list => window.h.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
      window.h.observer.observe({ type: 'longtask', buffered: false });
      const mutation = new MutationObserver(() => {
        if (!window.h.dropStarted || window.h.insertedAt || !document.querySelector('[data-pipeline-drop-column="b"] [data-lead="a0"]')) return;
        window.h.insertedAt = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => { window.h.paintedAt = performance.now(); }));
      });
      mutation.observe(document.getElementById('root'), { childList: true, subtree: true });
      window.h.mutationObserver = mutation;
      document.addEventListener('pointerup', () => { if (window.h.dragging) window.h.dropStarted = performance.now(); }, { capture: true });
    });
    await page.waitForFunction(() => document.querySelectorAll('article').length === 300);
    await startMove(page); await page.mouse.up();
    await page.waitForFunction(() => window.h.paintedAt);
    await settled(page);
    const metrics = await page.evaluate(() => {
      window.h.observer.disconnect(); window.h.mutationObserver.disconnect();
      return { cards: document.querySelectorAll('article').length, dropToDomMs: window.h.insertedAt - window.h.dropStarted,
        dropToTwoFramesMs: window.h.paintedAt - window.h.dropStarted,
        longTasksAfterDrop: window.h.longTasks.filter(entry => entry.start >= window.h.dropStarted),
        animations: window.h.animations.map(entry => ({ duration: entry.options.duration, playState: entry.animation.playState })),
        movementCallbacks: window.h.calls.length, listeners: window.h.motionListeners };
    });
    assert.equal(metrics.cards, 300); assert.equal(metrics.movementCallbacks, 1);
    assert.ok(metrics.dropToDomMs >= 0); assert.ok(metrics.dropToTwoFramesMs >= metrics.dropToDomMs);
    const record = { adapterPath, adapterHash, ...metrics, limits: 'Isolated Chromium, synthetic card contents and synchronous parent placement; no API, real phone, full LeadCard rendering or production latency.' };
    console.info('PIPELINE_DROP_PRESENTATION_METRICS', JSON.stringify(record));
    if (process.env.PIPELINE_DRAG_ANIMATION_METRICS_FILE) await writeFile(resolve(process.env.PIPELINE_DRAG_ANIMATION_METRICS_FILE), JSON.stringify(record, null, 2));
  } finally { await page.close(); }
});
