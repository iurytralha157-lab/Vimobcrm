import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('@playwright/test');
let browser, bundle;

before(async () => {
  const directory = process.env.QUEUE_NAME_EVIDENCE_DIR || await mkdtemp(path.join(tmpdir(), 'vimob-queue-name-'));
  await mkdir(directory, { recursive: true });
  const entry = path.join(directory, 'fixture.tsx'), loader = path.join(directory, 'loader.cjs');
  await writeFile(entry, `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {DistributionQueueBasicSection} from '@/components/features/round-robin/distribution-queue-editor/DistributionQueueBasicSection';
import {createEmptyDistributionQueueFormData} from '@/lib/round-robin/distribution-queue-form';
import {distributionDraftKey,saveDistributionDraft,readDistributionDraftRecovery} from '@/lib/round-robin/pending-draft';
function Fixture(){const [name,setName]=useState('Nome sintético');const key=distributionDraftKey('org-synthetic','actor-synthetic');window.fixture={setName,persist:()=>saveDistributionDraft(sessionStorage,key,{...createEmptyDistributionQueueFormData(),name}),restore:()=>{const recovered=readDistributionDraftRecovery(sessionStorage,key);if(recovered?.status==='ready')setName(recovered.form.name);return recovered}};return <DistributionQueueBasicSection open name={name} strategy="simple" targetPipelineId="" targetStageId="" pipelines={[]} stages={[]} onToggle={()=>{}} onNameChange={setName} onStrategyChange={()=>{}} onPipelineChange={()=>{}} onStageChange={()=>{}}/>};createRoot(document.getElementById('app')).render(<Fixture/>);
`);
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function openFixture() {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://queue-name-fixture.local/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="app"></div>' }) : route.abort());
  await page.goto('http://queue-name-fixture.local/');
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => Boolean(window.fixture));
  return { page, field: page.getByLabel('Nome da fila *', { exact: true }), errors };
}

for (const amount of [64, 120]) test(`Basic keeps ${amount} emoji name characters without UTF-16 truncation`, async () => {
  const { page, field, errors } = await openFixture();
  try {
    await field.fill('😀'.repeat(amount));
    assert.equal(await field.inputValue(), '😀'.repeat(amount));
    assert.notEqual(await field.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Basic reports the 1/2/119/120/121 code-point bounds for ASCII and supplementary names', async () => {
  const { page, field, errors } = await openFixture();
  try {
    for (const character of ['a', '😀']) for (const amount of [1, 2, 119, 120, 121]) {
      const name = character.repeat(amount);
      await field.fill(name);
      assert.equal(await field.inputValue(), name);
      const invalid = amount < 2 || amount > 120;
      assert.equal(await field.getAttribute('aria-invalid') === 'true', invalid, `${amount} ${character}`);
      if (invalid) {
        const errorId = await field.getAttribute('aria-describedby');
        assert.ok(errorId);
        assert.match(await page.locator(`[id="${errorId}"]`).innerText(), /2.*120/);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Basic preserves a legacy over-limit name for correction and never splits an inserted pair', async () => {
  const { page, field, errors } = await openFixture();
  try {
    await page.evaluate(() => window.fixture.setName('😀'.repeat(121)));
    await page.waitForFunction(() => document.querySelector('input')?.value.length === 242);
    assert.equal(await field.getAttribute('aria-invalid'), 'true');
    await field.focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Backspace');
    assert.equal(await field.inputValue(), '😀'.repeat(120));
    assert.notEqual(await field.getAttribute('aria-invalid'), 'true');
    await field.fill('a'.repeat(119)); await page.keyboard.press('Control+End'); await page.keyboard.insertText('🚀');
    assert.equal(await field.inputValue(), 'a'.repeat(119) + '🚀');
    assert.notEqual(await field.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Basic and the actual draft helpers recover valid and invalid Unicode text verbatim', async () => {
  const { page, field, errors } = await openFixture();
  try {
    for (const name of ['😀'.repeat(64), '😀'.repeat(120), '😀'.repeat(121), 'a'.repeat(121), '  AB  ']) {
      await field.fill(name);
      assert.equal(await field.inputValue(), name);
      assert.equal(await page.evaluate(() => window.fixture.persist()), true);
      await field.fill('Outro nome');
      const recovered = await page.evaluate(() => window.fixture.restore());
      assert.equal(recovered?.status, 'ready');
      assert.equal(recovered.form.name, name);
      await page.waitForFunction(name => document.querySelector('input')?.value === name, name);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
