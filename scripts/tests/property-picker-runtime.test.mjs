import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function evaluateModule(file, dependencies) {
  const output = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(output, { module: testModule, exports: testModule.exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } }, { filename: file });
  return testModule.exports;
}

for (const scenario of [
  { name: 'no permission', permissions: [], allowed: false },
  { name: 'permission loading', permissions: ['property_view'], loading: true, allowed: false },
  { name: 'organization transition', permissions: ['property_view'], status: 'resolving', allowed: false },
  { name: 'signed out', permissions: ['property_view'], signedOut: true, allowed: false },
  { name: 'module disabled', permissions: ['property_view'], module: false, allowed: false },
  { name: 'property view', permissions: ['property_view'], allowed: true },
  { name: 'property manage', permissions: ['property_manage'], allowed: true },
]) {
  test(`picker hook gates requests and retained cache: ${scenario.name}`, async () => {
    let options;
    let requests = 0;
    const helpers = evaluateModule('lib/property-picker-search.ts', {});
    const hooks = evaluateModule('hooks/properties/use-property-picker-search.ts', {
      '@tanstack/react-query': { useInfiniteQuery: value => { options = value; return { data: { pages: [{ properties: [{ id: 'retained-secret' }] }] } }; } },
      '@/contexts/AuthContext': { useAuth: () => ({ user: scenario.signedOut ? null : { id: 'actor-a' }, activeOrganization: { status: scenario.status || 'ready' } }) },
      '@/hooks/use-active-organization': { useOptionalActiveOrganizationId: () => 'org-a' },
      '@/hooks/use-organization-modules': { useOrganizationModules: () => ({ hasModule: () => scenario.module !== false }) },
      '@/hooks/use-user-permissions': { useUserPermissions: () => ({ isLoading: Boolean(scenario.loading), hasPermission: key => scenario.permissions.includes(key) }) },
      '@/hooks/shared/use-tenant-query-access-signature': { useTenantQueryAccessSignature: () => 'synthetic-access' },
      '@/lib/api/properties': { propertiesAPI: { getProperties: async () => { requests += 1; return { data: [], count: 0 }; } } },
      '@/lib/property-picker-search': helpers,
    });
    const result = hooks.usePropertyPickerSearch();
    assert.equal(options.enabled, scenario.allowed);
    if (!scenario.allowed) {
      assert.equal(result.data, undefined);
      assert.equal(result.properties.length, 0);
    }
    await options.queryFn({ pageParam: 0 });
    assert.equal(requests, scenario.allowed ? 1 : 0);
  });
}

describe('actual property picker UI negative flows', () => {
  let temporaryDirectory;
  let browser;
  let page;
  const browserErrors = [];
  before(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'vimob-property-picker-ui-'));
    const entry = path.join(temporaryDirectory, 'fixture.tsx');
    const loader = path.join(temporaryDirectory, 'typescript-loader.cjs');
    const cssLoader = path.join(temporaryDirectory, 'css-loader.cjs');
    const hooks = path.join(temporaryDirectory, 'synthetic-hooks.ts');
    const image = path.join(temporaryDirectory, 'synthetic-image.tsx');
    await writeFile(entry, `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {PropertyPickerDialog} from '@/components/features/properties/PropertyPickerDialog';
      const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
      function Fixture(){const[scenario,setScenario]=useState('error500');window.fixtureScenario=scenario;window.setPickerScenario=setScenario;return <QueryClientProvider client={client}><PropertyPickerDialog properties={[{id:'stale-prop',title:'SEGREDO-PROPS-ORG-ANTIGA'}]} selectedPropertyId="stale-prop" open onSelect={()=>{window.pickerSelectCount=(window.pickerSelectCount||0)+1;}} /></QueryClientProvider>;}
      createRoot(document.getElementById('app')).render(<Fixture/>);`);
    await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
    await writeFile(cssLoader, `module.exports=function(source){const css=source.replace(/:global\\(([^)]+)\\)/g,'$1').replace(/\\.surface\\b/g,'.pickerFixtureSurface');return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default {surface:"pickerFixtureSurface"};';};`);
    await writeFile(image, `import React from 'react';export default function Image({fill,unoptimized,sizes,...props}){return <img {...props}/>;}`);
    await writeFile(hooks, `import {VimobAPIError} from '@/lib/api/vimob-error';
      export const useAuth=()=>({user:{id:'actor-a'},activeOrganization:{organizationId:'org-a',status:window.fixtureScenario==='transition'?'resolving':'ready'}});
      export const useOrganizationModules=()=>({hasModule:()=>true});
      export const useUserPermissions=()=>({isLoading:window.fixtureScenario==='transition',hasPermission:()=>!['transition','denied'].includes(window.fixtureScenario)});
      export const useProperty=()=>({data:null});export const usePropertyTypes=()=>({data:[]});export const usePropertyCities=()=>({data:[]});export const usePropertyNeighborhoods=()=>({data:[]});export const useDebouncedValue=value=>value;
      export const getPropertySiteInfo=async()=>null;
      export const usePropertyPickerSearch=()=>({properties:[{id:'server-match',title:'RESULTADO-SERVIDOR',code:'CODE-42',status:'ativo'}],isError:window.fixtureScenario.startsWith('error'),error:new VimobAPIError('synthetic',{code:'synthetic',status:window.fixtureScenario==='error403'?403:500}),isFetching:false,isLoading:false,hasNextPage:false,refetch:async()=>{window.pickerRetryCount=(window.pickerRetryCount||0)+1;window.setPickerScenario('success');},fetchNextPage:async()=>{throw new Error('Unexpected pagination');}});`);
    const aliases = Object.fromEntries(['contexts/AuthContext','hooks/use-organization-modules','hooks/use-user-permissions','hooks/use-properties','hooks/use-property-types','hooks/use-property-locations','hooks/use-debounced-value','hooks/properties/use-property-picker-search','lib/api/property-support'].map(name=>[`@/${name}$`,hooks]));
    const { webpack } = require('next/dist/compiled/webpack/webpack');
    await new Promise((resolve,reject)=>{
      const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:temporaryDirectory,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'next/image$':image,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader},{test:/\.module\.css$/,use:cssLoader}]},optimization:{minimize:false,usedExports:true}});
      compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
    });
    const sources=['components/features/properties/PropertyPickerDialog.tsx','components/ui',entry];
    const base=(await readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
    const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(`${base}\n${sources.map(source=>`@source "${(path.isAbsolute(source)?source:path.join(root,source)).replaceAll('\\','/')}";`).join('\n')}`,{from:path.join(root,'app/property-picker-fixture.css')});
    browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror',error=>browserErrors.push(error.message));
    await page.route('**/*',route=>route.request().url()==='http://property-picker-fixture.local/'?route.fulfill({contentType:'text/html',body:`<style>${css.css}</style><div id="app"></div>`}):route.abort());
    await page.goto('http://property-picker-fixture.local/');await page.addScriptTag({content:await readFile(path.join(temporaryDirectory,'fixture.js'),'utf8')});
    await page.getByRole('alert').waitFor();
  });
  after(async()=>{
    await browser?.close();
    if(temporaryDirectory){const resolved=path.resolve(temporaryDirectory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('vimob-property-picker-ui-'));await rm(resolved,{recursive:true,force:true});}
  });
  const scenario=async name=>{await page.evaluate(value=>window.setPickerScenario(value),name);await page.waitForTimeout(50);};

  for(const status of [500,403]) test(`HTTP${status} shows retry without false empty state or cached selection`,async()=>{
    await scenario(`error${status}`);
    assert.equal(await page.getByRole('alert').count(),1);
    assert.equal(await page.getByText('Nenhum imóvel encontrado',{exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:/Selecionar CODE-42/}).count(),0);
    if(status===403) assert.ok((await page.getByRole('alert').textContent()).includes('não foi autorizado'));
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
    await page.getByRole('button',{name:/Selecionar CODE-42/}).waitFor();
    assert.equal(await page.getByRole('alert').count(),0);
  });
  test('permission transition and revocation hide retained data with controlled dialog open',async()=>{
    await scenario('transition');
    const loading=page.getByRole('button',{name:'Carregando acesso aos imóveis...',exact:true});
    assert.equal(await loading.isDisabled(),true);assert.equal(await page.getByRole('dialog').count(),0);
    assert.ok(!(await page.locator('body').textContent()).includes('SEGREDO-PROPS'));
    await scenario('denied');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.getByRole('button').count(),0);
    assert.equal(await page.evaluate(()=>window.pickerSelectCount||0),0);
  });
  test('scoped server matches survive text that only matched an imported reference',async()=>{
    await scenario('success');await page.getByRole('textbox',{name:'Buscar imóveis'}).fill('referencia-legada-nao-visivel');
    const result=page.getByRole('button',{name:/Selecionar CODE-42/});assert.equal(await result.count(),1);
    assert.ok(!(await page.locator('body').textContent()).includes('SEGREDO-PROPS'));
    await result.press('Enter');assert.equal(await page.evaluate(()=>window.pickerSelectCount),1);
    assert.deepEqual(browserErrors,[]);
  });
});
