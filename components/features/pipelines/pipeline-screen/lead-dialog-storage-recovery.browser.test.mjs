import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real React boundary, Button and Radix dialog; only the failing lead child,
// parent boundary and browser storage errors are synthetic. No API or service.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const productPath = join(repository, 'components/features/pipelines/pipeline-screen/LeadDialogErrorBoundary.tsx');
const sourcePath = process.env.LEAD_DIALOG_BOUNDARY_SOURCE || productPath;
const artifacts = process.env.LEAD_DIALOG_STORAGE_ARTIFACT_DIR;
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-storage-recovery-'));
  if (artifacts) await mkdir(artifacts, { recursive: true });
  const loader = join(directory, 'tsx-loader.cjs');
  const entry = join(directory, 'entry.js');
  const icon = join(directory, 'icon.js');
  await writeFile(icon, `export{default as X}from${JSON.stringify(join(repository, 'node_modules/lucide-react/dist/esm/icons/x.mjs'))};`);
  await writeFile(loader, `const fs=require('node:fs');const ts=require(${JSON.stringify(require.resolve('typescript'))});
    module.exports=function(source){if(this.resourcePath===${JSON.stringify(productPath)})source=fs.readFileSync(${JSON.stringify(sourcePath)},'utf8');
    return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';
    import{LeadDialogErrorBoundary}from${JSON.stringify(productPath)};
    const h=window.h={parentCaught:0,closed:0,reads:0,writes:0,key:0,ordinary:window.__ordinary===true};
    Object.defineProperty(window,'sessionStorage',{configurable:true,get(){
      if(window.__storageMode==='getter')throw new DOMException('Synthetic storage denied','SecurityError');
      return{getItem(){h.reads++;if(window.__storageMode==='read')throw new DOMException('Synthetic read denied','SecurityError');return null;},
      setItem(){h.writes++;throw new DOMException('Synthetic quota exceeded','QuotaExceededError');}};
    }});
    class Parent extends React.Component{state={error:false};static getDerivedStateFromError(){return{error:true};}
      componentDidMount(){h.mountedKey=h.key;}componentDidCatch(){h.parentCaught++;}render(){return this.state.error?React.createElement('div',{'data-testid':'parent-fallback'},'Parent fallback'):this.props.children;}}
    function LeadChild(){throw new Error(h.ordinary?'Synthetic ordinary lead failure':'ChunkLoadError: Failed to load chunk /_next/static/chunks/lead.js');}
    const root=createRoot(document.getElementById('root'));
    h.render=()=>root.render(React.createElement(Parent,{key:h.key},React.createElement(LeadDialogErrorBoundary,
      {leadId:'synthetic-'+h.key,onClose(){h.closed++;root.render(React.createElement('p',{'data-testid':'closed'},'Lead closed'));}},React.createElement(LeadChild))));
    h.remount=()=>{h.key++;h.render();};h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'boundary.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@': repository, 'lucide-react$': icon } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error)
      : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'boundary.js'), 'utf8');
  const postcss = require('postcss');
  const tailwind = require('@tailwindcss/postcss');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8'))
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = [productPath, join(repository, 'components/ui')]
    .map(path => `@source "${path.replaceAll('\\', '/')}";`).join('\n');
  css = (await postcss([tailwind({ base: repository })]).process(`${globals}\n${sources}`,
    { from: join(repository, 'app/globals.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 120_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('vimob-lead-storage-recovery-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function openBoundary(width, mode, ordinary = false) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 768 }, reducedMotion: 'reduce' });
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><main id="root"></main></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate(({ mode, ordinary }) => { window.__storageMode = mode; window.__ordinary = ordinary; }, { mode, ordinary });
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => document.querySelector('[role="dialog"], [data-testid="parent-fallback"]'));
  return page;
}

for (const width of [390, 1366]) {
  for (const mode of ['getter', 'read', 'write']) {
    test(`real React retains local recovery with storage ${mode} failure at ${width}px`, { timeout: 30_000 }, async () => {
      const page = await openBoundary(width, mode);
      try {
        const state = await page.evaluate(() => ({ parentCaught: window.h.parentCaught, reads: window.h.reads,
          writes: window.h.writes, parentFallback: !!document.querySelector('[data-testid="parent-fallback"]') }));
        assert.equal(state.parentCaught, 0, 'Storage failure must never escape to the parent boundary');
        assert.equal(state.parentFallback, false);
        assert.equal(state.reads, mode === 'getter' ? 0 : 1);
        assert.equal(state.writes, mode === 'write' ? 1 : 0);
        const dialog = page.getByRole('dialog');
        assert.equal(await dialog.getByRole('heading', { name: 'Aplicativo atualizado' }).count(), 1);
        assert.equal(await dialog.getByRole('button', { name: 'Recarregar', exact: true }).count(), 1);
        const box = await dialog.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'Local fallback fits its viewport');
        if (artifacts && mode === 'getter') await page.screenshot({ path: join(artifacts, `storage-denied-${width}.png`) });
        await page.evaluate(() => window.h.remount());
        await page.waitForFunction(() => window.h.mountedKey === 1 && !!document.querySelector('[role="dialog"], [data-testid="parent-fallback"]'));
        assert.equal(await page.evaluate(() => window.h.parentCaught), 0);
        assert.equal(await page.getByRole('dialog').count(), 1, 'Remount retains the same local fallback without auto navigation');
        const navigated = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
        await page.getByRole('button', { name: 'Recarregar', exact: true }).click();
        await navigated;
        assert.equal(await page.locator('#root').count(), 0, 'Explicit reload performs native browser navigation despite denied storage');
      } finally {
        await page.close();
      }
    });
  }

  test(`ordinary errors stay local and close normally with denied storage at ${width}px`, { timeout: 30_000 }, async () => {
    const page = await openBoundary(width, 'getter', true);
    try {
      assert.equal(await page.evaluate(() => window.h.parentCaught), 0);
      assert.equal(await page.getByRole('heading', { name: 'Não foi possível abrir o lead' }).count(), 1);
      await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await page.getByTestId('closed').waitFor();
      assert.equal(await page.evaluate(() => window.h.closed), 1);
      assert.equal(await page.getByRole('dialog').count(), 0);
    } finally {
      await page.close();
    }
  });
}
