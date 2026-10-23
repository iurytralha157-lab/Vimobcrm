import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const {chromium} = require('@playwright/test');
let directory, browser, bundle, css;

before(async () => {
  directory = process.env.FORM_WIZARD_STEP_EVIDENCE_DIR || await mkdtemp(path.join(tmpdir(), 'vimob-step-navigation-'));
  await mkdir(directory, {recursive: true});
  // Exercise the shared layout with the consumers' real panel contracts, not
  // their unrelated transports. Preserve Property's actual own-scroll effect.
  const propertyPath = path.join(root, 'components/features/properties/PropertyFormScreen.tsx');
  const propertySource = await readFile(propertyPath, 'utf8');
  const ast = ts.createSourceFile(propertyPath, propertySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let propertyScrollEffect;
  const visit = node => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
        node.expression.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('`property-tab-${activeTab}`')) {
      propertyScrollEffect = node.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(propertyScrollEffect, 'Property own-scroll effect must remain covered');
  const entry = path.join(directory, 'fixture.tsx');
  await writeFile(entry, `
import React,{StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FormWizardLayout} from '@/components/shared/forms/FormWizardLayout';
import {Tabs,TabsContent} from '@/components/ui/tabs';
import {FORM_WIZARD_DIALOG_CLASS_NAME} from '@/config/form-wizard';
const definitions=[{id:'basic',label:'Nome e destino'},{id:'rules',label:'Critérios de entrada'},{id:'review',label:'Revisão'}];
function Fixture(){
  const kind=new URLSearchParams(location.search).get('kind')||'distribution';
  const [activeTab,setActiveTab]=useState('basic'),[render,setRender]=useState(0);
  window.stepFixture={setActiveTab,rerender:()=>setRender(n=>n+1)};
  ${propertyScrollEffect}
  const prefix=kind==='property'?'property':'fixture';
  const panel=<><h2>{definitions.find(step=>step.id===activeTab).label}</h2><label htmlFor="step-field">Campo da etapa</label><input id="step-field" autoFocus={kind==='distribution'} defaultValue="Sintético"/><div style={{height:1000}}>Conteúdo sintético extenso {render}</div><label htmlFor="end-field">Último campo</label><input id="end-field"/></>;
  const contents=kind==='site'||kind==='property'
    ? definitions.map(step=><TabsContent key={step.id} id={prefix+'-panel-'+step.id} value={step.id}>{panel}</TabsContent>)
    : <div role="tabpanel" id={prefix+'-panel-'+activeTab} aria-labelledby={prefix+'-tab-'+activeTab} tabIndex={0}>{panel}</div>;
  const layout=<FormWizardLayout steps={definitions.map(step=>({...step,buttonId:prefix+'-tab-'+step.id,panelId:prefix+'-panel-'+step.id}))} activeStep={activeTab} onStepChange={setActiveTab}
    focusContentOnStepChange={kind==='distribution'} showNews={false} aside={<p>Prévia sintética</p>}
    footer={<><button type="button" id="back" disabled={activeTab==='basic'} onClick={()=>setActiveTab(definitions[definitions.findIndex(step=>step.id===activeTab)-1].id)}>Voltar</button>{activeTab==='review'?<span><button type="button" id="save">Salvar</button></span>:<button type="button" id="next" onClick={()=>setActiveTab(definitions[definitions.findIndex(step=>step.id===activeTab)+1].id)}>Avançar</button>}</>}>{contents}</FormWizardLayout>;
  return <><button id="external" onClick={()=>setActiveTab('rules')}>Ação externa</button><section aria-label="Editor sintético" className={'fixed left-3 top-3 '+FORM_WIZARD_DIALOG_CLASS_NAME}>{kind==='site'||kind==='property'?<Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">{layout}</Tabs>:layout}</section></>;
}
createRoot(document.getElementById('app')).render(<StrictMode><Fixture/></StrictMode>);
`);
  const loader = path.join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const stub = path.join(directory, 'news.tsx');
  await writeFile(stub, 'export const ProductUpdatesDialog=()=>null;');
  const {webpack} = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({mode:'development', target:'web', devtool:false, entry, output:{path:directory,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/components/features/news$':stub,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false,usedExports:true}});
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats.toString({all:false,errors:true}))) : resolve()));
  });
  bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');
  const source = (await readFile(path.join(root, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/shared/forms/FormWizardLayout.tsx','components/ui','config/form-wizard.ts'].map(file => path.join(root,file)).concat(entry);
  css = (await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(source + '\n' +
    sources.map(file => '@source "' + file.replaceAll('\\','/') + '";').join('\n'), {from:path.join(root,'app/form-wizard-step-fixture.css')})).css;
  await writeFile(path.join(directory, 'fixture.css'), css);
  browser = await chromium.launch({headless:true});
});

after(async () => { await browser?.close(); });

async function openFixture(width, height, kind='distribution') {
  const page = await browser.newPage({viewport:{width,height}}), errors=[], network=[];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url(); network.push(url);
    return url.startsWith('http://step-navigation-fixture.local/')
      ? route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="app"></div></body></html>'})
      : route.abort();
  });
  await page.goto('http://step-navigation-fixture.local/?kind='+kind);
  await page.addScriptTag({content:bundle});
  await page.waitForFunction(() => Boolean(window.stepFixture));
  await page.getByLabel('Campo da etapa').waitFor();
  await page.waitForTimeout(60);
  return {page,errors,network};
}

async function scrollDown(page) {
  return page.evaluate(() => {
    const grid=document.querySelector('[data-form-wizard] > div'), content=document.querySelector('[data-form-wizard-content]');
    const scroller=innerWidth<768?grid:content;
    scroller.scrollTop=500;
    return {top:scroller.scrollTop,clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight};
  });
}

async function position(page) {
  return page.evaluate(() => {
    const grid=document.querySelector('[data-form-wizard] > div'), content=document.querySelector('[data-form-wizard-content]');
    const scroller=innerWidth<768?grid:content;
    const panel=[...content.querySelectorAll('[role="tabpanel"]')].find(node=>!node.hidden && node.getBoundingClientRect().height>0);
    return {top:scroller.scrollTop,scrollBounds:scroller.getBoundingClientRect().toJSON(),panelBounds:panel.getBoundingClientRect().toJSON(),
      panelFocused:document.activeElement===panel,activeId:document.activeElement?.id,selected:document.querySelector('[aria-selected="true"]')?.id};
  });
}

function assertExposed(state) {
  assert.ok(state.panelBounds.top>=state.scrollBounds.top-1 && state.panelBounds.top<state.scrollBounds.bottom,
    `new panel top=${state.panelBounds.top}, scroller=${state.scrollBounds.top}..${state.scrollBounds.bottom}, scrollTop=${state.top}`);
}

for (const [width,height] of [[320,640],[375,320],[1440,900]]) {
  test(`opt-in Next/Back exposes and focuses new panel at ${width}x${height}`, async () => {
    const {page,errors,network}=await openFixture(width,height);
    try {
      assert.ok((await scrollDown(page)).top>0);
      await page.locator('#next').click();
      const next=await position(page);
      await page.screenshot({path:path.join(directory,`next-${width}x${height}.png`)});
      assertExposed(next); assert.equal(next.panelFocused,true,'Next must move focus from its footer button into the new panel');
      await scrollDown(page); await page.locator('#back').click();
      const previous=await position(page);
      assertExposed(previous); assert.equal(previous.panelFocused,true,'Back must focus the previous panel: '+JSON.stringify(previous));
      assert.deepEqual(errors,[]); assert.ok(network.every(url=>url.startsWith('http://step-navigation-fixture.local/')));
    } finally { await page.close(); }
  });

  test(`opt-in tab click/arrows retain tablist focus at ${width}x${height}`, async () => {
    const {page,errors}=await openFixture(width,height);
    try {
      const rules=page.getByRole('tab',{name:'Critérios de entrada',exact:true});
      await rules.click(); assert.equal(await rules.evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('ArrowRight');
      const review=page.getByRole('tab',{name:'Revisão',exact:true});
      assert.equal(await review.getAttribute('aria-selected'),'true');
      assert.equal(await review.evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('Home');
      assert.equal(await page.getByRole('tab',{name:'Nome e destino',exact:true}).evaluate(node=>node===document.activeElement),true);
      assert.deepEqual(errors,[]);
    } finally { await page.close(); }
  });
}

for (const kind of ['teams','site','property']) {
  for (const [width,height] of [[320,640],[1440,900]]) {
    test(`${kind} default contract resets actual scroller without claiming footer focus at ${width}x${height}`, async () => {
      const {page,errors}=await openFixture(width,height,kind);
      try {
        assert.ok((await scrollDown(page)).top>0);
        await page.locator('#next').click();
        const state=await position(page);
        if (kind==='property') assert.ok(state.top<=16,'Property own tab effect may expose its small navigation inset, but cannot retain the old 500px scroll');
        else assert.equal(state.top,0,'default consumers also need the actual responsive scroller reset');
        assert.equal(state.activeId,'next','default opt-out must preserve consumer-owned focus');
        assert.deepEqual(errors,[]);
      } finally { await page.close(); }
    });
  }
}

test('StrictMode initial mount and same-step render keep input focus and existing scroll', async () => {
  const {page,errors}=await openFixture(320,640);
  try {
    const field=page.getByLabel('Campo da etapa');
    assert.equal(await field.evaluate(node=>node===document.activeElement),true,'mount must not focus the panel');
    const before=await scrollDown(page);
    await page.evaluate(()=>window.stepFixture.rerender());
    await page.waitForTimeout(40);
    assert.equal((await position(page)).top,before.top,'ordinary renders must not reset the current scroll');
    assert.equal(await field.evaluate(node=>node===document.activeElement),true);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test('opt-in programmatic changes from a field do not steal its focus', async () => {
  const {page,errors}=await openFixture(1440,900);
  try {
    const field=page.getByLabel('Campo da etapa'); await field.focus();
    await page.evaluate(()=>window.stepFixture.setActiveTab('rules'));
    await page.waitForTimeout(40);
    assert.equal(await field.evaluate(node=>node===document.activeElement),true);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test('keyboard navigation focuses the new panel even when Next is removed at Review', async () => {
  const {page,errors}=await openFixture(320,640);
  try {
    await page.locator('#next').focus(); await page.keyboard.press('Enter');
    assert.equal((await position(page)).panelFocused,true);
    await page.locator('#next').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#next').count(),0,'Review replaces Next with its final action');
    const state=await position(page);
    assert.equal(state.selected,'fixture-tab-review');
    assert.equal(state.panelFocused,true,'a removed navigation control must not strand focus on body');
    assertExposed(state); assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});
