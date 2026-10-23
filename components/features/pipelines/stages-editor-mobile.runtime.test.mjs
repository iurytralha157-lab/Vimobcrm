import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real editor, Radix ScrollArea/dialogs, Pangea DnD and compiled app CSS.
// Mutations are synthetic; every external request is blocked.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifacts = resolve(process.env.PIPELINE_VISUAL_ARTIFACT_DIR || join(tmpdir(), 'vimob-stages-editor-mobile-artifacts'));
const longName = 'Qualificação e acompanhamento de oportunidades imobiliárias com atendimento especializado e revisão documental'.padEnd(120, 'x');
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-stages-editor-mobile-'));
  await mkdir(artifacts, { recursive: true });
  const aliases = {};
  async function mock(name, source) {
    const file = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(file, source);
    aliases[`${name}$`] = file;
  }
  const icons = ['GripVertical', 'Trash2', 'Loader2', 'Pencil', 'Check', 'X', 'Plus'];
  await mock('lucide-react', icons.map(name => {
    const file = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase();
    return `export{default as ${name}}from${JSON.stringify(join(repository, 'node_modules/lucide-react/dist/esm/icons', `${file}.mjs`))};`;
  }).join('\n'));
  await mock('sonner', "export const toast=Object.fromEntries(['success','error','info'].map(kind=>[kind,message=>window.h.toasts.push({kind,message})]));");
  await mock('@/hooks/use-stages', `
    const scopeKey={};const mutation=kind=>({scopeKey,captureScopeGuard:()=>()=>true,isPending:false,capture:input=>({...input}),discard:()=>{},isCurrent:()=>true,isScopeCurrent:()=>true,mutateAsync:async input=>{window.h.calls.push({kind,input});return{}}});
    export const useReorderStages=()=>mutation('save');export const useDeleteStage=()=>mutation('delete');export const useUpdateStage=()=>mutation('restore');`);
  const loader = join(directory, 'tsx-loader.cjs');
  const sourceOverride = process.env.STAGES_EDITOR_SOURCE_FILE ? await readFile(process.env.STAGES_EDITOR_SOURCE_FILE, 'utf8') : null;
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const override=${JSON.stringify(sourceOverride)};module.exports=function(source){if(override&&require('node:path').basename(this.resourcePath)==='StagesEditorDialog.tsx')source=override;return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{StagesEditorDialog}from'@/components/features/pipelines/StagesEditorDialog';
    const h=window.h={open:true,calls:[],toasts:[],stages:[
      {id:'11111111-1111-4111-8111-111111111111',name:${JSON.stringify(longName)},lead_count:999999,color:'#ff4529',position:0,stage_key:'qualified',updated_at:'2026-10-17T12:00:00.123456Z'},
      {id:'22222222-2222-4222-8222-222222222222',name:'Contato',lead_count:0,color:'#123456',position:1,stage_key:'contact',updated_at:'2026-10-17T12:00:00.123457Z'},
      {id:'33333333-3333-4333-8333-333333333333',name:'Visita',lead_count:24,color:'#123456',position:2,stage_key:'visit',updated_at:'2026-10-17T12:00:00.123458Z'}]};
    const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(StagesEditorDialog,{open:h.open,onOpenChange:open=>{h.open=open;h.render()},pipelineId:'44444444-4444-4444-8444-444444444444',pipelineName:'Pipeline sintética com nome longo para verificar contenção',stages:h.stages}));h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'editor.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'editor.js'), 'utf8');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/pipelines/StagesEditorDialog.tsx', 'components/ui'].map(file => `@source "${join(repository, file).replaceAll('\\', '/')}";`).join('\n');
  css = (await postcss([tailwind({ base: repository })]).process(`${globals}\n${sources}`, { from: join(repository, 'app/globals.css') })).css;
  const geist = await readFile(join(repository, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'));
  css += `@font-face{font-family:Geist;src:url(data:font/woff2;base64,${geist.toString('base64')}) format('woff2');font-weight:100 900} :root{--font-geist-sans:Geist}`;
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('vimob-stages-editor-mobile-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function open(width, height = 844) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(5_000);
  await page.route('**/*', route => route.abort());
  await page.setContent('<html class="light"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('dialog').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function geometry(page) {
  return page.getByRole('dialog').evaluate(dialog => {
    const viewport = dialog.querySelector('[data-radix-scroll-area-viewport]');
    const bounds = node => { const { x, y, width, height, right, bottom } = node.getBoundingClientRect(); return { x, y, width, height, right, bottom }; };
    const controls = [...viewport.querySelectorAll('button,input')].map(node => ({ label: node.getAttribute('aria-label') || node.getAttribute('placeholder'), ...bounds(node),
      hit: document.elementFromPoint(node.getBoundingClientRect().x + node.clientWidth / 2, node.getBoundingClientRect().y + node.clientHeight / 2)?.closest('button,input') === node }));
    const names = [...viewport.querySelectorAll('[data-rfd-draggable-id] span[title]')];
    return { dialog: bounds(dialog), viewport: bounds(viewport), viewportOverflow: viewport.scrollWidth > viewport.clientWidth + 1,
      wrapperDisplay: getComputedStyle(viewport.firstElementChild).display, controls,
      fonts: names.map(node => ({ size: getComputedStyle(node).fontSize, family: getComputedStyle(node).fontFamily })),
      headerControls: [...dialog.querySelectorAll('button')].filter(node => !viewport.contains(node)).map(node => ({ label: node.textContent, ...bounds(node) })),
      rows: [...viewport.querySelectorAll('[data-rfd-draggable-id]')].map(bounds) };
  });
}

async function assertContained(page, label, controls = true) {
  const result = await geometry(page);
  await writeFile(join(artifacts, `${process.env.STAGES_EDITOR_MEASUREMENT_LABEL || 'after'}-${label}.json`), JSON.stringify(result, null, 2));
  await page.screenshot({ path: join(artifacts, `${process.env.STAGES_EDITOR_MEASUREMENT_LABEL || 'after'}-${label}.png`) });
  assert.equal(result.viewportOverflow, false, `horizontal overflow: ${JSON.stringify(result)}`);
  assert.ok(result.viewport.x >= result.dialog.x && result.viewport.right <= result.dialog.right, 'viewport remains within dialog');
  for (const control of result.headerControls) assert.ok(control.x >= result.dialog.x - 1 && control.right <= result.dialog.right + 1, `dialog control clipped: ${JSON.stringify(control)}`);
  for (const row of result.rows) assert.ok(row.x >= result.viewport.x - 1 && row.right <= result.viewport.right + 1, `row escaped viewport: ${JSON.stringify(result)}`);
  if (controls) for (const control of result.controls) {
    assert.ok(control.x >= result.viewport.x - 1 && control.right <= result.viewport.right + 1, `control clipped: ${JSON.stringify(control)}`);
    assert.ok(control.hit, `control is not hit-testable: ${JSON.stringify(control)}`);
  }
}

for (const width of [320, 360, 390, 1280]) test(`column actions remain visible through view, edit and add at ${width}px`, { timeout: 30_000 }, async () => {
  const page = await open(width);
  try {
    await assertContained(page, `view-${width}`);
    for (const font of (await geometry(page)).fonts) {
      assert.equal(font.size, width < 640 ? '14px' : '16px');
      assert.match(font.family, /Geist/);
    }
    const name = page.getByLabel(`Editar coluna ${longName}`, { exact: true });
    await name.click();
    const edit = page.getByLabel(`Nome da coluna ${longName}`, { exact: true });
    assert.equal(await edit.inputValue(), longName);
    await assertContained(page, `edit-${width}`);
    await edit.fill('Nome temporário');
    await page.getByLabel(`Cancelar edição da coluna ${longName}`, { exact: true }).click();
    await name.waitFor();
    assert.equal(await page.getByText('Nome temporário', { exact: true }).count(), 0);
    await page.getByLabel(`Excluir coluna ${longName}`, { exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Nova Coluna', exact: true }).click();
    await page.getByPlaceholder('Nome da coluna...').fill('Nova coluna sintética');
    await assertContained(page, `add-${width}`);
    await page.getByLabel('Cancelar nova coluna', { exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.h.calls), []);
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForFunction(() => !window.h.open);
    assert.equal(await page.getByRole('dialog').count(), 0);
  } finally { await page.close(); }
});

test('mobile edited and new columns preserve save payload and original revisions', { timeout: 30_000 }, async () => {
  const page = await open(320);
  try {
    await page.getByLabel(`Editar coluna ${longName}`, { exact: true }).click();
    await page.getByLabel(`Nome da coluna ${longName}`, { exact: true }).fill('Qualificados');
    await page.getByLabel(`Confirmar edição da coluna ${longName}`, { exact: true }).click();
    await page.getByRole('button', { name: 'Nova Coluna', exact: true }).click();
    await page.getByPlaceholder('Nome da coluna...').fill('Nova coluna sintética');
    await page.getByLabel('Adicionar nova coluna ao rascunho', { exact: true }).click();
    await page.getByLabel('Editar coluna Nova coluna sintética', { exact: true }).waitFor();
    await assertContained(page, 'draft-320');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForFunction(() => !window.h.open);
    const calls = await page.evaluate(() => window.h.calls);
    assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'save');
    assert.equal(calls[0].input.stages[0].name, 'Qualificados');
    assert.equal(calls[0].input.stages[0].expectedUpdatedAt, '2026-10-17T12:00:00.123456Z');
    assert.equal(calls[0].input.stages[0].isNew, false);
    assert.equal(calls[0].input.stages[3].name, 'Nova coluna sintética');
    assert.equal(calls[0].input.stages[3].isNew, true);
    assert.equal(calls[0].input.stages[3].expectedUpdatedAt, undefined);
  } finally { await page.close(); }
});

