import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const ts = require('typescript');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const component = 'components/features/pipelines/StagesEditorDialog.tsx';
const sourcePath = process.env.PIPELINE_STAGE_EDITOR_SOURCE || join(repository, component);
const source = await readFile(sourcePath, 'utf8');
const version = '2026-10-16T12:00:00.123456Z';
console.info('PIPELINE_INLINE_SAVE_SOURCE', JSON.stringify({ path: sourcePath, sha256: createHash('sha256').update(source).digest('hex') }));
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-inline-save-'));
  const aliases = {};
  async function mock(name, code) {
    const file = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(file, code); aliases[`${name}$`] = file;
  }
  const names = new Set();
  for (const file of [component, ...(await readdir(join(repository, 'components/ui'))).filter(file => file.endsWith('.tsx')).map(file => `components/ui/${file}`)]) {
    const tree = ts.createSourceFile(file, await readFile(join(repository, file), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'lucide-react') {
      for (const element of statement.importClause?.namedBindings?.elements || []) names.add((element.propertyName || element.name).text);
    }
  }
  await mock('lucide-react', `import React from'react';${[...names].map(name => `export const ${name}=props=>React.createElement('svg',{...props,'aria-hidden':true});`).join('')}`);
  await mock('sonner', `export const toast=Object.fromEntries(['error','success','info'].map(kind=>[kind,text=>window.h.toasts.push({kind,text})]));`);
  await mock('@/hooks/use-stages', `import React from'react';const scopeKey={};function useMutation(){const[pending,setPending]=React.useState(false);return{scopeKey,captureScopeGuard:()=>()=>true,isPending:pending,capture:input=>input,discard(){},isCurrent:()=>true,isScopeCurrent:()=>true,mutateAsync:async input=>{setPending(true);try{return await window.h.mutate(input)}finally{setPending(false)}}}}export const useReorderStages=useMutation;export const useDeleteStage=useMutation;export const useUpdateStage=useMutation;`);
  const loader = join(directory, 'tsx-loader.cjs');
  const instrumented = source.replace('  const handleSave = async () => {', '  window.h.reorder=handleDragEnd; window.h.setEditingColor=setEditingColor; window.h.setNewColor=setNewColor;\n  const handleSave = async () => {');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const source=${JSON.stringify(instrumented)};module.exports=function(s){if(require('node:path').basename(this.resourcePath)==='StagesEditorDialog.tsx')s=source;return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{StagesEditorDialog}from'@/components/features/pipelines/StagesEditorDialog';const pipeline='33333333-3333-4333-8333-333333333333';const h=window.h={open:true,calls:[],toasts:[],pending:null,stages:[{id:'11111111-1111-4111-8111-111111111111',name:'Entrada',color:'#123456',stage_key:'entrada',position:0,updated_at:${JSON.stringify(version)}},{id:'22222222-2222-4222-8222-222222222222',name:'Contato',color:'#654321',stage_key:'contato',position:1,updated_at:${JSON.stringify(version)}}]};
    h.mutate=payload=>{h.calls.push(payload);return new Promise((resolve,reject)=>{h.pending={resolve:()=>resolve({}),reject:(status=503)=>reject(Object.assign(Error('Falha sintética '+status),{status}))}})};const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(StagesEditorDialog,{open:h.open,pipelineId:pipeline,pipelineName:'Vendas',stages:h.stages,onOpenChange:open=>{h.open=open;h.render()}}));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'inline-save.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'inline-save.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('vimob-pipeline-inline-save-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function open() {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: '[role="dialog"],[role="alertdialog"]{position:fixed;inset:20px;overflow:auto;background:white;padding:20px}[role="dialog"][data-state="closed"],[role="alertdialog"][data-state="closed"]{display:none}' });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Editar coluna Entrada', exact: true }).waitFor();
  return page;
}
async function edit(page, name = 'Entrada revista', color = '#abcdef') {
  await page.getByRole('button', { name: 'Editar coluna Entrada', exact: true }).click();
  await page.getByLabel('Nome da coluna Entrada', { exact: true }).fill(name);
  await page.getByLabel('Cor da coluna Entrada', { exact: true }).fill(color);
}
async function reorder(page) {
  // Exercise the production reorder handler and React draft state directly;
  // pointer/keyboard sensors are covered by the unchanged board suites.
  await page.evaluate(() => window.h.reorder({ source: { index: 0 }, destination: { index: 1 } }));
  await page.waitForFunction(() => document.querySelector('[data-rfd-draggable-id]')?.getAttribute('data-rfd-draggable-id') === window.h.stages[1].id);
}
async function save(page) {
  await page.getByRole('button', { name: /^(Salvar|Fechar|Criar e salvar)$/ }).click();
}
async function submitted(page) {
  await page.waitForFunction(() => window.h.calls.length > 0);
  return await page.evaluate(() => window.h.calls.at(-1).stages);
}

test('editing alone exposes Save and commits name and color without the inline checkmark', async () => {
  const page = await open();
  try {
    await edit(page);
    assert.equal(await page.getByRole('button', { name: 'Salvar', exact: true }).count(), 1);
    await save(page); const stages = await submitted(page);
    assert.equal(stages[0].name, 'Entrada revista'); assert.equal(stages[0].color, '#abcdef');
    assert.equal(stages[0].expectedUpdatedAt, version); assert.equal(stages[0].isNew, false);
    assert.equal(await page.getByLabel('Nome da coluna Entrada', { exact: true }).isDisabled(), true);
    await page.evaluate(() => window.h.pending.resolve()); await page.waitForFunction(() => !window.h.open);
  } finally { await page.close(); }
});

test('reorder plus unconfirmed edit sends the edited fields in the same ordered batch', async () => {
  const page = await open();
  try {
    await reorder(page); await edit(page); await save(page); const stages = await submitted(page);
    assert.deepEqual(stages.map(stage => stage.name), ['Contato', 'Entrada revista']);
    assert.equal(stages[1].color, '#abcdef'); assert.equal(stages[1].expectedUpdatedAt, version);
    assert(stages.every(stage => stage.expectedUpdatedAt === version));
  } finally { await page.close(); }
});

test('pending new column plus unconfirmed edit share one batch and only existing rows carry CAS', async () => {
  const page = await open();
  try {
    await edit(page); await page.getByRole('button', { name: 'Nova Coluna', exact: true }).click();
    await page.getByPlaceholder('Nome da coluna...').fill('Visita');
    await page.getByLabel('Cor da nova coluna', { exact: true }).fill('#aabbcc');
    await save(page); const stages = await submitted(page);
    assert.deepEqual(stages.map(stage => stage.name), ['Entrada revista', 'Contato', 'Visita']);
    assert.equal(stages[0].color, '#abcdef'); assert.equal(stages[0].expectedUpdatedAt, version);
    assert.equal(stages[2].isNew, true); assert.equal(stages[2].expectedUpdatedAt, undefined); assert.equal(stages[2].color, '#aabbcc');
  } finally { await page.close(); }
});

for (const invalid of [{ name: 'x' }, { name: 'x'.repeat(121) }, { color: 'invalid' }]) {
  test(`invalid pending fields stop the entire reordered batch: ${JSON.stringify(invalid)}`, async () => {
    const page = await open();
    try {
      await reorder(page); await edit(page, invalid.name || 'Entrada revista');
      if (invalid.color) await page.evaluate(color => window.h.setEditingColor(color), invalid.color);
      await save(page);
      assert.equal(await page.evaluate(() => window.h.calls.length), 0);
      assert.equal(await page.evaluate(() => window.h.open), true);
      assert.equal(await page.getByLabel('Nome da coluna Entrada', { exact: true }).inputValue(), invalid.name || 'Entrada revista');
      assert.equal(await page.evaluate(() => window.h.toasts.at(-1)?.kind), 'error');
    } finally { await page.close(); }
  });
}

test('invalid new column color also prevents sending the pending existing edit', async () => {
  const page = await open();
  try {
    await edit(page); await page.getByRole('button', { name: 'Nova Coluna', exact: true }).click();
    await page.getByPlaceholder('Nome da coluna...').fill('Visita');
    await page.evaluate(() => window.h.setNewColor('invalid')); await save(page);
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
    assert.equal(await page.getByPlaceholder('Nome da coluna...').inputValue(), 'Visita');
    assert.equal(await page.getByLabel('Nome da coluna Entrada', { exact: true }).inputValue(), 'Entrada revista');
  } finally { await page.close(); }
});

for (const status of [503, 409]) test(`failed batch ${status} retains inline fields, new column, order and original revision for retry`, async () => {
  const page = await open();
  try {
    await reorder(page); await edit(page); await page.getByRole('button', { name: 'Nova Coluna', exact: true }).click();
    await page.getByPlaceholder('Nome da coluna...').fill('Visita'); await save(page); await submitted(page);
    await page.evaluate(status => window.h.pending.reject(status), status); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Nome da coluna Entrada', { exact: true }).inputValue(), 'Entrada revista');
    assert.equal(await page.getByLabel('Cor da coluna Entrada', { exact: true }).inputValue(), '#abcdef');
    assert.equal(await page.getByPlaceholder('Nome da coluna...').inputValue(), 'Visita');
    await save(page); await page.waitForFunction(() => window.h.calls.length === 2);
    const stages = await page.evaluate(() => window.h.calls[1].stages);
    assert.deepEqual(stages.map(stage => stage.name), ['Contato', 'Entrada revista', 'Visita']);
    assert.equal(stages[1].expectedUpdatedAt, version); assert.equal(stages[1].color, '#abcdef');
    assert.equal(await page.evaluate(() => window.h.open), true);
  } finally { await page.close(); }
});

test('remote refetch keeps the inline draft and original revision and blocks saving until explicit reload', async () => {
  const page = await open();
  try {
    await edit(page); await page.evaluate(() => {
      window.h.stages = window.h.stages.map(stage => ({ ...stage, name: stage.name + ' remoto', updated_at: '2026-10-16T12:00:00.123457Z' })); window.h.render();
    });
    await page.getByText(/Seu rascunho foi mantido/).waitFor();
    assert.equal(await page.getByLabel('Nome da coluna Entrada', { exact: true }).inputValue(), 'Entrada revista');
    assert.equal(await page.getByLabel('Cor da coluna Entrada', { exact: true }).inputValue(), '#abcdef');
    assert.equal(await page.getByRole('button', { name: /^(Salvar|Fechar)$/ }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.h.calls.length), 0);
    await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).click();
    await page.getByText('Entrada remoto', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Nome da coluna Entrada', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Fechar', exact: true }).isEnabled(), true);
  } finally { await page.close(); }
});
