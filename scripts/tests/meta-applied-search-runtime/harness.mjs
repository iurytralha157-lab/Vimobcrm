import assert from 'node:assert/strict';
import { after, before } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { fixture, synthetic } from './fixture.mjs';

const require=createRequire(import.meta.url);
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
let directory,browser;
export let page;
export const errors=[],externalRequests=[];
export const trigger=()=>page.getByRole('button',{name:/Abrir filtros avançados/});
export const sidebar=()=>page.getByRole('dialog',{name:'Filtros avançados',exact:true});
export const snapshot=()=>page.evaluate(()=>window.searchFixtureFilters.getFilterSnapshot());

before(async()=>{
  console.log('Meta search fixture: compiling actual consumers/hooks/API contracts');
  directory=await mkdtemp(path.join(tmpdir(),'vimob-meta-applied-search-'));
  const entry=path.join(directory,'fixture.tsx'),mocks=path.join(directory,'synthetic.tsx'),loader=path.join(directory,'typescript-loader.cjs');
  await writeFile(entry,fixture);await writeFile(mocks,synthetic);
  await writeFile(loader,`const ts=require(${JSON.stringify(path.join(repository,'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const names=['contexts/AuthContext','hooks/use-user-permissions','hooks/use-teams','hooks/use-users','hooks/use-tags','hooks/use-stages','hooks/use-team-pipelines','hooks/use-meta-integration','lib/api/pipeline-board','lib/api/integrations','components/shared/layout/AppLayout','components/features/marketing/MarketingTabViews'];
  const aliases=Object.fromEntries(names.map(name=>['@/'+name+'$',mocks]));
  const screenOverride=process.env.VIMOB_META_SCREEN_BASELINE;
  aliases['meta-screen-baseline$']=screenOverride?path.resolve(screenOverride):path.join(repository,'components/features/meta/MetaCampaignsDashboardScreen.tsx');
  // Meta screen's relative report import must use the same inert leaf when
  // running either the checkout or its captured baseline outside the repo.
  aliases['./MetaCampaignDashboard$']=mocks;
  aliases['./MarketingTabViews$']=mocks;
  const {webpack}=require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'./AuthContext$':mocks,'./vimob-client$':mocks,'next/navigation$':mocks,'next/link$':mocks,'@':repository},modules:[path.join(repository,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  console.log('Meta search fixture: bundle ready; compiling actual shared CSS');
  const cssSource=(await readFile(path.join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(cssSource+'\n'+['config/filter-ui.ts','components/shared','components/ui','components/features/marketing'].map(source=>'@source '+JSON.stringify(path.join(repository,source).replaceAll('\\','/'))+';').join('\n'),{from:path.join(repository,'app/meta-search-offline.css')});
  console.log('Meta search fixture: CSS ready; mounting offline browser');
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1024,height:768},timezoneId:'America/Sao_Paulo',reducedMotion:'reduce'});
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>(externalRequests.push(route.request().url()),route.abort()));
  await page.setContent('<style>'+css.css+'</style><div id="app"></div>');
  await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});
  await expect(trigger()).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.searchFixtureFilters.isHydrated)).toBe(true);
},{timeout:600000});

after(async()=>{
  await browser?.close();if(directory){assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.match(path.basename(directory),/^vimob-meta-applied-search-/);await rm(directory,{recursive:true,force:true});}
});

export async function show(view='meta',width=1024){
  await page.setViewportSize({width,height:768});
  await page.evaluate(view=>{window.searchFixtureFilters.clearFilters();window.searchFixtureSetView(view);},view);
  await expect(page.locator('[data-search-fixture-view]')).toHaveAttribute('data-search-fixture-view',view);
  await expect.poll(async()=>(await snapshot()).searchQuery).toBe('');
}
export async function inheritedSearch(){
  await page.evaluate(()=>window.searchFixtureFilters.setSearchQuery('Ana sintética'));
  await expect.poll(async()=>(await snapshot()).searchQuery).toBe('Ana sintética');
}
