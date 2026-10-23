import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Production editor, draft/visit helpers, API and Zod; only hooks/HTTP are synthetic.
// The simulated old API uses its strict decoder boundary before any state change.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ids = { pipeline: '11111111-1111-4111-8111-111111111111', stage: '22222222-2222-4222-8222-222222222222', org: '33333333-3333-4333-8333-333333333333' };
const version = '2026-10-20T10:00:00.123456Z';
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-stage-key-'));
  const aliases = {};
  async function mock(name, source) {
    const file = path.join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(file, source); aliases[`${name}$`] = file;
  }
  const icons = ['GripVertical', 'Trash2', 'Loader2', 'Pencil', 'Check', 'X', 'Plus'];
  await mock('lucide-react', icons.map(name => {
    const file = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase();
    return `export{default as ${name}}from${JSON.stringify(path.join(root, 'node_modules/lucide-react/dist/esm/icons', `${file}.mjs`))};`;
  }).join('\n'));
  await mock('sonner', "export const toast=Object.fromEntries(['success','error','info'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));");
  await mock('@/lib/validation', `export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/pipelines.ts'))};`);
  await mock('@/lib/api/vimob-client', 'export const vimobAPIRequest=(url,options)=>window.h.request(url,options);');
  await mock('@/hooks/use-stages', `import{pipelinesAPI}from'@/lib/api/pipelines';const scopeKey={};
    export const useReorderStages=()=>({scopeKey,captureScopeGuard:()=>()=>true,isPending:false,mutateAsync:input=>pipelinesAPI.reorderStages(input.pipelineId,input.stages,window.h.ids.org,{expectedUserId:'synthetic-actor',expectedSessionId:'synthetic-sid'})});
    const mutation=()=>({isPending:false,isScopeCurrent:()=>true,capture:input=>input,discard:()=>{},isCurrent:()=>true,mutateAsync:async()=>({})});export const useDeleteStage=mutation,useUpdateStage=mutation;`);
  const loader = path.join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const entry = path.join(directory, 'entry.tsx');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';
    import{StagesEditorDialog}from'@/components/features/pipelines/StagesEditorDialog';import{pipelinesAPI}from'@/lib/api/pipelines';
    import{VimobAPIError}from'@/lib/api/vimob-error';import{stagesReorderInputSchema}from'@/lib/validation/pipelines';
    const ids=${JSON.stringify(ids)},version=${JSON.stringify(version)};
    const h=window.h={ids,version,open:true,requests:[],toasts:[],commits:0,stages:[{id:ids.stage,name:'Existing',color:'#123456',position:0,stage_key:'existing',updated_at:version}],archived:[],api:pipelinesAPI,schema:stagesReorderInputSchema};
    h.request=async(url,options)=>{const body=JSON.parse(JSON.stringify(options.body));h.requests.push({url,body,retry:options.retry,organizationId:options.organizationId,expectedUserId:options.expectedUserId,expectedSessionId:options.expectedSessionId});
      if(h.oldAPI&&Object.hasOwn(body,'preserveStageKeys'))throw new VimobAPIError('Synthetic strict decoder',{status:400,code:'invalid_request'});
      if(h.failure)throw new VimobAPIError('Synthetic save failed',{status:h.failure,code:h.failure===409?'stage_conflict':'invalid_request'});
      h.commits++;return{data:body.stages.map((stage,position)=>({id:stage.id,organizationId:ids.org,pipelineId:ids.pipeline,name:stage.name,color:stage.color||'#123456',stageKey:stage.stageKey||h.stages.find(item=>item.id===stage.id)?.stage_key||'legacy_name_key',position,isWon:false,isLost:false,isQualified:false,isActive:true,createdAt:version,updatedAt:version}))};};
    const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(StagesEditorDialog,{open:h.open,onOpenChange:open=>{h.open=open;h.render()},pipelineId:ids.pipeline,pipelineName:'Synthetic pipeline',stages:h.stages,archivedStages:h.archived}));h.render();`);
  const { webpack } = require('next/dist/compiled/webpack/webpack.js');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, aliases['@/lib/api/vimob-client$'])],
      output: { path: directory, filename: 'fixture.js' }, resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [path.join(root, 'node_modules')], alias: { ...aliases, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 120_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('vimob-stage-key-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function open(options = {}, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.setDefaultTimeout(5_000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('dialog').waitFor();
  await page.evaluate(options => { Object.assign(window.h, options); window.h.render(); }, options);
  return page;
}
async function add(page, name, save = true) {
  await page.getByRole('button', { name: 'Nova Coluna', exact: true }).click();
  await page.getByPlaceholder('Nome da coluna...').fill(name);
  if (save) await page.getByRole('button', { name: 'Criar e salvar', exact: true }).click();
}
async function request(page) {
  await page.waitForFunction(() => window.h.requests.length > 0 || window.h.toasts.some(toast => toast.kind === 'error'));
  const state = await page.evaluate(() => ({ request: window.h.requests[0], toasts: window.h.toasts }));
  assert.ok(state.request, `request was rejected before HTTP: ${JSON.stringify(state.toasts)}`);
  return state.request;
}

for (const length of [2, 79, 80, 81, 120]) test(`new ${length}-character column stays within key limit and commits`, async () => {
  const page = await open();
  try {
    await add(page, 'a'.repeat(length));
    const sent = await request(page);
    assert.equal(sent.body.preserveStageKeys, true);
    assert.equal(sent.body.stages[0].stageKey, undefined);
    assert.equal(sent.body.stages[1].stageKey, 'a'.repeat(Math.min(length, 80)));
    assert.equal(sent.body.stages[1].isNew, true);
    assert.equal(sent.body.stages[0].expectedUpdatedAt, version);
    await page.waitForFunction(() => !window.h.open);
    assert.equal(await page.evaluate(() => window.h.commits), 1);
  } finally { await page.close(); }
});

test('active and archived keys reserve a bounded multi-digit collision suffix', async () => {
  const base = 'a'.repeat(80);
  const archived = Array.from({ length: 8 }, (_, index) => ({ id: `archived-${index}`, name: `Archived ${index}`, color: '#123456', position: index, stage_key: `${base.slice(0, 78)}_${index + 2}` }));
  const page = await open({ stages: [{ id: ids.stage, name: 'Existing', color: '#123456', position: 0, stage_key: base, updated_at: version }], archived });
  try {
    await add(page, base);
    const sent = await request(page);
    assert.equal(sent.body.stages[1].stageKey, `${base.slice(0, 77)}_10`);
    assert.equal(sent.body.stages[1].stageKey.length, 80);
  } finally { await page.close(); }
});

test('adding two local drafts with a shared long prefix generates distinct bounded keys', async () => {
  const page = await open();
  try {
    const base = 'a'.repeat(80);
    await add(page, `${base}x`, false);
    await page.getByLabel('Adicionar nova coluna ao rascunho', { exact: true }).click();
    await add(page, `${base}y`);
    const sent = await request(page);
    assert.deepEqual(sent.body.stages.slice(1).map(stage => stage.stageKey), [base, `${base.slice(0, 78)}_2`]);
    assert.equal(new Set(sent.body.stages.map(stage => stage.id)).size, 3);
    await page.waitForFunction(() => !window.h.open);
  } finally { await page.close(); }
});

test('accent and emoji fallback draft keys survive production validation and transport', async () => {
  const page = await open();
  try {
    await add(page, 'Ação 🏠 São Paulo', false);
    await page.getByLabel('Adicionar nova coluna ao rascunho', { exact: true }).click();
    await add(page, '🏠🔥');
    const sent = await request(page);
    assert.deepEqual(sent.body.stages.slice(1).map(stage => stage.stageKey), ['acao_sao_paulo', 'coluna']);
    await page.waitForFunction(() => !window.h.open);
  } finally { await page.close(); }
});

for (const width of [390, 1280]) test(`existing historical long key is omitted while name and exact revision save at ${width}px`, async () => {
  const original = { id: ids.stage, name: 'Existing', color: '#123456', position: 0, stage_key: 'historical_'.repeat(12), updated_at: version };
  const page = await open({ stages: [original] }, width);
  try {
    await page.getByLabel('Editar coluna Existing', { exact: true }).click();
    await page.getByLabel('Nome da coluna Existing', { exact: true }).fill('Renamed column');
    await page.getByLabel('Confirmar edição da coluna Existing', { exact: true }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const sent = await request(page);
    assert.deepEqual(sent.body, { preserveStageKeys: true, stages: [{ id: ids.stage, name: 'Renamed column', color: '#123456', expectedUpdatedAt: version }] });
    await page.waitForFunction(() => !window.h.open);
    assert.equal(await page.evaluate(() => window.h.stages[0].stage_key), original.stage_key);
  } finally { await page.close(); }
});

for (const failure of [400, 409, 'old-api']) test(`${failure} fails safely and preserves a pending long-name draft`, async () => {
  const page = await open(failure === 'old-api' ? { oldAPI: true } : { failure });
  try {
    const name = 'a'.repeat(120);
    await add(page, name);
    const sent = await request(page);
    assert.equal(sent.body.preserveStageKeys, true);
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByPlaceholder('Nome da coluna...').inputValue(), name);
    assert.equal(await page.evaluate(() => window.h.open), true);
    assert.equal(await page.evaluate(() => window.h.commits), 0);
    await page.evaluate(() => { window.h.oldAPI = false; window.h.failure = null; });
    await page.getByRole('button', { name: 'Criar e salvar', exact: true }).click();
    await page.waitForFunction(() => !window.h.open);
    assert.equal(await page.evaluate(() => window.h.requests.length), 2);
    assert.equal(await page.evaluate(() => window.h.commits), 1);
  } finally { await page.close(); }
});

test('reorder transport preserves pins, retry policy and PostgreSQL microseconds', async () => {
  const page = await open();
  try {
    const sent = await page.evaluate(async () => {
      await window.h.api.reorderStages(window.h.ids.pipeline, [{ id: window.h.ids.stage, name: 'Existing', expectedUpdatedAt: window.h.version }], window.h.ids.org, { expectedUserId: 'synthetic-actor', expectedSessionId: 'synthetic-sid' });
      return window.h.requests[0];
    });
    assert.equal(sent.body.preserveStageKeys, true);
    assert.equal(sent.body.stages[0].expectedUpdatedAt, version);
    assert.equal(sent.organizationId, ids.org);
    assert.equal(sent.expectedUserId, 'synthetic-actor');
    assert.equal(sent.expectedSessionId, 'synthetic-sid');
    assert.equal(sent.retry, false);
  } finally { await page.close(); }
});
