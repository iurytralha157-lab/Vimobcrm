import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real React layout/unmount, visit hook and StageSettings save handler. The
// provider-access guard and deferred service are synthetic; network is blocked.
const require = createRequire(import.meta.url), ts = require('typescript');
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-editor-visit-'));
  const settings = ts.createSourceFile('StageSettingsDialog.tsx', await readFile(join(repository,
    'components/features/pipelines/StageSettingsDialog.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let save;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(settings) === 'handleSaveGeneral') save = node.getText(settings);
    ts.forEachChild(node, visit);
  };
  visit(settings); assert.ok(save);
  const helperPath = join(repository, 'hooks/pipelines/use-pipeline-editor-visit.ts');
  const helper = await readFile(process.env.PIPELINE_EDITOR_VISIT_SOURCE_FILE || helperPath, 'utf8');
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const helper=${JSON.stringify(helper)};module.exports=function(source){if(this.resourcePath===${JSON.stringify(helperPath)})source=helper;return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  await writeFile(entry, `import React,{useState,useRef,useMemo,useLayoutEffect}from'react';import{createRoot}from'react-dom/client';import{usePipelineEditorVisit}from${JSON.stringify(helperPath)};
    const h=window.h={requests:[],notices:[],closed:[],props:{scope:{org:'a',actor:'a',sid:'a',allowed:true,nonce:0},stage:'a',open:true,shown:true}};
    const toast=Object.fromEntries(['error','success'].map(kind=>[kind,message=>h.notices.push({kind,message})]));
    const stageGeneralChanges=()=>({name:'Changed'}),stageSettingsRevision=()=> 'revision-a',getStructuredErrorMessage=error=>error.message,PIPELINE_STAGE_COLOR_FALLBACK='#123456';
    function Editor({scopeKey,captureScopeGuard,stageId,open}){
      const stage={id:stageId,name:'Previous',color:'#123456'},editorVisit=usePipelineEditorVisit(scopeKey,JSON.stringify([open,stage.id]),captureScopeGuard);
      const[generalBase,setGeneralBase]=useState(stage),[name,setName]=useState('Changed'),[color]=useState('#123456'),[isQualified]=useState(false);
      const[savingOperation,setSavingOperation]=useState(null),isSaving=savingOperation?.visit===editorVisit.key,saveInFlightRef=useRef(null),[generalError,setGeneralError]=useState(null),canEditPipeline=true;
      const onStageUpdate=()=>h.closed.push({stage:stageId,sid:scopeKey.sid});
      const updateStage={mutateAsync:input=>new Promise((resolve,reject)=>h.requests.push({input,resolve,reject}))};
      const ${save};
      h.save=handleSaveGeneral;h.capture=()=>editorVisit.capture();h.state=()=>({isSaving,name,error:generalError,base:generalBase,owner:saveInFlightRef.current});
      return <div hidden={!open}><input aria-label='Name' value={name} onChange={event=>setName(event.target.value)}/><button onClick={()=>void handleSaveGeneral()} disabled={isSaving}>Save</button><span role='status'>{isSaving?'Saving':'Ready'}</span>{generalError&&<p role='alert'>{generalError}</p>}</div>;
    }
    function Fixture(){const[props,setProps]=useState(h.props);h.update=patch=>setProps(old=>({...old,...patch}));h.switch=patch=>setProps(old=>({...old,scope:{...old.scope,...patch}}));
      const s=props.scope,scopeKey=useMemo(()=>({org:s.org,actor:s.actor,sid:s.sid,allowed:s.allowed}),[s.org,s.actor,s.sid,s.allowed]);
      const lease=useMemo(()=>({active:true}),[scopeKey]);useLayoutEffect(()=>{h.lease=lease;return()=>{lease.active=false}},[lease]);
      const captureScopeGuard=()=>()=>lease.active&&h.lease===lease;
      return props.shown?<Editor scopeKey={scopeKey} captureScopeGuard={captureScopeGuard} stageId={props.stage} open={props.open}/>:<p>Unmounted</p>;
    }
    h.resolve=index=>h.requests[index].resolve({id:h.requests[index].input.id,name:'Saved',color:'#123456'});h.reject=index=>h.requests[index].reject(Error('Synthetic rejected response'));createRoot(document.getElementById('app')).render(<Fixture/>);`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error || Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('vimob-pipeline-editor-visit-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function mount() {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="app"></div></body></html>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
  return page;
}
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

for (const change of [{ sid: 'b' }, { actor: 'b' }, { org: 'b' }, { allowed: false }]) {
  test(`real layout retires an editor operation after ${JSON.stringify(change)}`, async () => {
    const page = await mount();
    try {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForFunction(() => window.h.requests.length === 1);
      await page.evaluate(change => window.h.switch(change), change); await frames(page);
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), false);
      await page.getByRole('textbox', { name: 'Name' }).fill('New visit draft');
      await page.evaluate(() => window.h.resolve(0)); await frames(page);
      assert.deepEqual(await page.evaluate(() => [window.h.notices, window.h.closed]), [[], []]);
      assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'New visit draft');
    } finally { await page.close(); }
  });
}

test('same-SID token refresh preserves the legitimate editor operation', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.evaluate(() => window.h.switch({ nonce: 1 })); await frames(page);
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.h.resolve(0)); await frames(page);
    assert.equal(await page.evaluate(() => window.h.notices.filter(item => item.kind === 'success').length), 1);
    assert.equal(await page.evaluate(() => window.h.closed.length), 1);
  } finally { await page.close(); }
});

for (const mode of ['selection-aba', 'opening-aba', 'unmount']) {
  test(`real layout retires the pending completion on ${mode}`, async () => {
    const page = await mount();
    try {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.evaluate(() => { window.h.original = window.h.capture(); });
      await page.evaluate(mode => window.h.update(mode === 'selection-aba' ? { stage: 'b' } : mode === 'opening-aba' ? { open: false } : { shown: false }), mode);
      await frames(page);
      if (mode !== 'unmount') { await page.evaluate(() => window.h.update({ stage: 'a', open: true })); await frames(page); }
      assert.equal(await page.evaluate(() => window.h.original.isCurrent()), false);
      await page.evaluate(() => window.h.resolve(0)); await frames(page);
      assert.deepEqual(await page.evaluate(() => [window.h.notices, window.h.closed]), [[], []]);
    } finally { await page.close(); }
  });
}

test('ACK of A cannot unlock B or erase its error/draft in a surviving React editor', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.evaluate(() => window.h.switch({ sid: 'b' })); await frames(page);
    await page.getByRole('textbox', { name: 'Name' }).fill('Draft B');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => window.h.requests.length === 2);
    await page.evaluate(() => window.h.resolve(0)); await frames(page);
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Draft B');
    assert.deepEqual(await page.evaluate(() => [window.h.notices, window.h.closed]), [[], []]);
    await page.evaluate(() => window.h.reject(1)); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), false);
    assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), 'Draft B');
    assert.match(await page.getByRole('alert').innerText(), /Synthetic rejected response/);
  } finally { await page.close(); }
});
