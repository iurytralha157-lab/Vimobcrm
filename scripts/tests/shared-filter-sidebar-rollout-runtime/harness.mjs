import assert from 'node:assert/strict';
import { after, before } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { fixture } from './fixture.mjs';

const require=createRequire(import.meta.url);
export const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const proof=process.env.VIMOB_FILTER_ROLLOUT_PROOF_DIR;
let directory,browser,pointerSession;
export let page;
export const errors=[],externalRequests=[];
export const trigger=()=>page.getByRole('button',{name:/Abrir filtros avançados/});
export const sidebar=()=>page.getByRole('dialog',{name:'Filtros avançados',exact:true});
export const search=()=>page.getByRole('textbox',{name:'Buscar nos registros',exact:true});
export const state=()=>page.evaluate(()=>window.rolloutState());

before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'vimob-filter-rollout-'));
  if(proof)await mkdir(proof,{recursive:true});
  const entry=path.join(directory,'fixture.tsx'),loader=path.join(directory,'typescript-loader.cjs'),hooks=path.join(directory,'hooks.tsx');
  await writeFile(entry,fixture);
  await writeFile(loader,`const ts=require(${JSON.stringify(path.join(repository,'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  await writeFile(hooks,`import {useSyncExternalStore} from 'react';
    window.rolloutPath='/crm/dashboard';window.rolloutOrg='10000000-0000-4000-8000-000000000001';
    const subscribe=fn=>{window.addEventListener('rollout-scope',fn);return()=>window.removeEventListener('rollout-scope',fn);};
    export const usePathname=()=>useSyncExternalStore(subscribe,()=>window.rolloutPath);
    export const useAuth=()=>{const org=useSyncExternalStore(subscribe,()=>window.rolloutOrg);return{user:{id:'20000000-0000-4000-8000-000000000001'},activeOrganization:{organizationId:org},tenantContext:{organizationId:org,memberRole:'admin',permissions:['lead_view_all'],enabledModules:['crm','whatsapp']},isSuperAdmin:true};};
    export const useUserPermissions=()=>({isLoading:false,hasPermission:()=>true});export const useOrganizationModules=()=>({isLoading:false,hasModule:()=>true});
    export const useWhatsAppUnreadCount=()=>({data:3});export const useCreateTag=()=>({isPending:false,mutateAsync:()=>{throw Error('No mutation in rollout fixture');}});
    export const useTeams=()=>({data:[],isLoading:false,isFetching:false,isSuccess:true});export const useOrganizationUsers=useTeams;
  `);
  const aliases=Object.fromEntries(['hooks/use-user-permissions','hooks/use-organization-modules','hooks/use-whatsapp-conversations','hooks/use-tags','hooks/use-teams','hooks/use-users','contexts/AuthContext'].map(n=>['@/'+n+'$',hooks]));
  const {webpack}=require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'./AuthContext$':hooks,'next/navigation$':hooks,'@':repository},modules:[path.join(repository,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const productCss=(await readFile(path.join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['config/filter-ui.ts','components/shared','components/ui','components/features/chat/FloatingChatButton.tsx','components/features/marketing/MarketingScopeFilters.tsx','components/features/whatsapp/conversations/ConversationFilters.tsx','scripts/tests/shared-filter-sidebar-rollout-runtime/fixture.mjs'];
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(productCss+'\n'+sources.map(s=>'@source '+JSON.stringify(path.join(repository,s).replaceAll('\\','/'))+';').join('\n'),{from:path.join(repository,'app/rollout-offline-fixture.css')});
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1024,height:740},hasTouch:true,timezoneId:'America/Sao_Paulo'});
  page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='http://filter-rollout.local/'
    ?route.fulfill({contentType:'text/html',body:'<style>'+css.css+'</style><div id="app"></div>'})
    :(externalRequests.push(route.request().url()),route.abort()));
  await page.goto('http://filter-rollout.local/');await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});
  await trigger().waitFor().catch(e=>{throw new AggregateError([e,...errors.map(m=>Error(m))],'Rollout fixture did not mount');});
},{timeout:300000});

after(async()=>{
  await browser?.close();if(directory){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.match(path.basename(target),/^vimob-filter-rollout-/);await rm(target,{recursive:true,force:true});}
});

export async function show({width=1024,height=740,...config}={}){
  await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(config=>{sessionStorage.clear();localStorage.clear();window.rolloutPath='/crm/dashboard';window.rolloutOrg='10000000-0000-4000-8000-000000000001';window.dispatchEvent(new Event('rollout-scope'));window.showRollout(config);},config);
  await expect(trigger()).toBeVisible();await expect(page.locator('[data-rollout-mobile]')).toHaveAttribute('data-rollout-mobile',String(width<768));
  await expect.poll(()=>page.evaluate(()=>window.rolloutFilters.isHydrated)).toBe(true);
  await expect.poll(async()=>(await state()).snapshot.source).toBe(null);
}
export async function open(){await trigger().click();await expect(sidebar()).toBeVisible();}
export async function save(name){if(proof)await page.screenshot({path:path.join(proof,name+'.png'),fullPage:true});}

// Responsive width does not imply a mouse. Keep touch for the interaction cases,
// and enable genuine mouse capabilities only while checking CSS hover rules.
export async function withMousePointer(run){
  // Detaching a CDP session resets its emulation override, so retain it until
  // browser teardown while restoring touch after each individual hover check.
  pointerSession??=await page.context().newCDPSession(page);
  try{
    await pointerSession.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await run();
  }finally{
    await pointerSession.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    assert.deepEqual(await page.evaluate(()=>({hover:matchMedia('(hover:hover)').matches,fine:matchMedia('(pointer:fine)').matches,touchPoints:navigator.maxTouchPoints})),{hover:false,fine:false,touchPoints:1});
  }
}
