import assert from 'node:assert/strict';
import { after, before } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { fixture } from './fixture.mjs';

const require = createRequire(import.meta.url);
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const proof = process.env.VIMOB_CONTACTS_SIDEBAR_PROOF_DIR || null;
let directory, browser;
export let page;
export const errors = [];
export const externalRequests = [];
export const sidebar = () => page.getByRole('dialog', { name:'Filtros avançados', exact:true });
export const trigger = () => page.getByRole('button', { name:/Abrir filtros avançados/ });
export const search = () => page.getByRole('textbox', { name:'Buscar nos registros', exact:true });

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(),'vimob-contacts-sidebar-runtime-'));
  if(proof)await mkdir(proof,{recursive:true});
  const hooks=path.join(directory,'synthetic-hooks.tsx'),entry=path.join(directory,'fixture.tsx'),loader=path.join(directory,'typescript-loader.cjs');
  await writeFile(entry,fixture);
  await writeFile(loader,`const ts=require(${JSON.stringify(path.join(repository,'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  await writeFile(hooks,`import {useSyncExternalStore} from 'react';
    window.sidebarFixturePath='/crm/contacts';window.sidebarFixtureOrg='10000000-0000-4000-8000-000000000001';
    const subscribe=fn=>{window.addEventListener('sidebar-fixture-scope',fn);return()=>window.removeEventListener('sidebar-fixture-scope',fn);};
    export const usePathname=()=>useSyncExternalStore(subscribe,()=>window.sidebarFixturePath);
    export const useAuth=()=>{const org=useSyncExternalStore(subscribe,()=>window.sidebarFixtureOrg),actor=useSyncExternalStore(subscribe,()=>window.sidebarFixtureActor??'20000000-0000-4000-8000-000000000001'),permissions=useSyncExternalStore(subscribe,()=>window.sidebarFixturePermissions);return{user:{id:actor},profile:{id:actor},activeOrganization:{organizationId:org},tenantContext:{organizationId:org,memberRole:'admin',permissions:permissions??['lead_view_all'],enabledModules:['crm','whatsapp']},isSuperAdmin:true};};
    export const useUserPermissions=()=>({isLoading:false,hasPermission:()=>true});
    export const useOrganizationModules=()=>({isLoading:false,hasModule:()=>true});
    export const useWhatsAppUnreadCount=()=>({data:3});
    export const useCreateTag=()=>({isPending:false,mutateAsync:()=>{throw Error('No data mutation in fixture');}});
    export const useTeams=()=>({data:[],isLoading:false,isFetching:false,isSuccess:true});export const useOrganizationUsers=useTeams;
  `);
  const aliases=Object.fromEntries(['hooks/use-user-permissions','hooks/use-organization-modules','hooks/use-whatsapp-conversations','hooks/use-tags','hooks/use-teams','hooks/use-users','contexts/AuthContext'].map(name=>['@/'+name+'$',hooks]));
  const {webpack}=require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'./AuthContext$':hooks,'next/navigation$':hooks,'@':repository},modules:[path.join(repository,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const productCss=(await readFile(path.join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['config/filter-ui.ts','components/shared','components/ui','components/features/chat/FloatingChatButton.tsx','components/features/chat/FilterAwareMobileChatSurface.tsx','components/features/contacts/contacts-screen/ContactsToolbar.tsx','scripts/tests/contacts-sidebar-runtime/fixture.mjs'];
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(productCss+'\n'+sources.map(source=>'@source '+JSON.stringify(path.join(repository,source).replaceAll('\\','/'))+';').join('\n'),{from:path.join(repository,'app/sidebar-offline-fixture.css')});
  const font=await readFile(path.join(repository,'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'));
  const fontCss="@font-face{font-family:'Geist Offline';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,"+font.toString('base64')+")} :root{--font-geist-sans:'Geist Offline'}";
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1024,height:720},hasTouch:true,timezoneId:'America/Sao_Paulo'});
  page.setDefaultTimeout(4000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url()==='http://contacts-sidebar-fixture.local/'
    ?route.fulfill({contentType:'text/html',body:'<style>'+fontCss+css.css+'</style><div id="app"></div>'})
    :(externalRequests.push(route.request().url()),route.abort()));
  await page.goto('http://contacts-sidebar-fixture.local/');
  await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});
  await page.evaluate(()=>document.fonts.ready);
  await trigger().waitFor();
},{timeout:300000});

after(async()=>{
  await browser?.close();
  if(directory){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.match(path.basename(target),/^vimob-contacts-sidebar-runtime-/);await rm(target,{recursive:true,force:true});}
});

export async function show({width=1024,height=720,presentation='sidebar',theme='light',...config}={}){
  await page.setViewportSize({width,height});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(config=>{window.sidebarFixturePath='/crm/contacts';window.sidebarFixtureOrg='10000000-0000-4000-8000-000000000001';delete window.sidebarFixtureActor;delete window.sidebarFixturePermissions;window.dispatchEvent(new Event('sidebar-fixture-scope'));localStorage.clear();window.showSidebarFixture(config);},{presentation,theme,...config});
  await expect(trigger()).toBeVisible();
  await expect(page.locator('[data-fixture-mobile]')).toHaveAttribute('data-fixture-mobile',String(width<768));
  await expect.poll(()=>page.evaluate(()=>window.sidebarFilters.isHydrated)).toBe(true);
  const revision=await page.evaluate(()=>{const value=window.sidebarFilters.filterApplicationRevision;window.sidebarFilters.clearFilters();return value;});
  await expect.poll(()=>page.evaluate(()=>window.sidebarFilters.filterApplicationRevision)).not.toBe(revision);
  await expect.poll(()=>page.evaluate(()=>window.sidebarFilters.searchQuery)).toBe('');
}
export async function open(){await trigger().click();await expect(sidebar()).toBeVisible();}
export async function save(name){if(proof)await page.screenshot({path:path.join(proof,name+'.png'),fullPage:true});}
export async function state(){return page.evaluate(()=>window.sidebarFilters.getFilterSnapshot());}
export async function bounds(locator){const rect=await locator.boundingBox();assert.ok(rect,'rendered geometry');return rect;}
