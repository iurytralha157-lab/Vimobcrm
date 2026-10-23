import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Bundle the actual React dialogs, Radix controls and realtime bus. Only the
// transport/auth boundaries are synthetic; no server or database is contacted.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let directory, browser, page;
const errors = [];
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-tags-ui-'));
  const loader = path.join(directory, 'loader.cjs');
  const entry = path.join(directory, 'fixture.tsx');
  const stubs = path.join(directory, 'boundaries.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  await writeFile(stubs, `import React from 'react';
    let organizationId='org-a';const subscribers=new Set();
    export const setScope=id=>{organizationId=id;subscribers.forEach(listener=>listener());};
    const subscribe=listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);};
    export const useAuth=()=>({activeOrganization:{organizationId:React.useSyncExternalStore(subscribe,()=>organizationId)},user:{id:'synthetic-viewer'},session:{user:{id:'synthetic-viewer'}}});
    export const ManagementToolbarPortal=({children})=><>{children}</>;
    export const getPublicErrorMessage=()=> 'Esta tag mudou';
    export const stringifyErrorMessage=error=>error.message;
    export class VimobAPIError extends Error{};
    export const getVimobAPIAccessTokenSessionId=()=> 'synthetic-session';export const getVimobAPIAccessTokenUserId=()=> 'synthetic-viewer';export const getGlobalSignOutSessionId=()=> 'synthetic-session';
    export const invalidateLeadHistorySoon=()=>{};export const useLeadUpdateCache=()=>({});
    export const toast={success:()=>{},error:()=>{},info:()=>{}};
    const deferAssociation=(lead,tag,org)=>new Promise(resolve=>{window.fixture.requestOrg=org;window.fixture.completeAssociation=()=>resolve({error:null});});
    export const leadsAPI={addLeadTag:deferAssociation,removeLeadTag:deferAssociation};
    export const tags=[{id:'tag-a',name:'Quente',color:'#ff0000',updated_at:'2026-10-12T10:00:00Z',lead_count:2},{id:'tag-b',name:'Investidor',color:'#008000',updated_at:'2026-10-12T10:00:00Z',lead_count:1}];
    export const tagsAPI={list:async org=>{window.fixture.tagReads.push(org);return tags;}};
    export const useTags=()=>({data:tags,isLoading:false,isError:false,isFetching:false,refetch:()=>new Promise(resolve=>{window.fixture.resolveReload=()=>resolve({data:tags.map(tag=>({...tag,name:tag.name+' atualizada'})),isError:false});})});
    const mutation={isPending:false,mutateAsync:async()=>{throw new Error('revision conflict')}};
    export const useCreateTag=()=>mutation;export const useUpdateTag=()=>mutation;export const useDeleteTag=()=>mutation;
    export const useTagUsage=()=>({isFetching:false,isError:false,data:{updated_at:'changed',lead_count:2,usages:window.fixture?.allTagDependencies?['distribution_rule','distribution_auto_tags','automation','automation_execution','stage_automation','meta_form','webhook'].map(kind=>({kind,count:125})):[]},refetch:async()=>({})});
  `);
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {TagsTab} from '@/components/features/crm-management/TagsTab';
    import {LeadRealtimeBus,notifyLeadRealtimeChange} from '@/contexts/LeadRealtimeBus';
    import {useAddLeadTag,useRemoveLeadTag} from '@/hooks/use-leads';
    import {invalidateTagConsumers} from '@/lib/tags/management';
    import {setScope,useAuth} from './boundaries';
    import {useTags as useRealTags} from ${JSON.stringify(path.join(root,'hooks/use-tags.ts'))};
    const client=new QueryClient();
    window.fixture={client,emit:notifyLeadRealtimeChange,invalidateTagConsumers,setScope,associationEvents:[],tagReads:[]};
    window.addEventListener('vimob:lead-realtime-change',event=>window.fixture.associationEvents.push(event.detail));
    function MutationProbe(){const {activeOrganization}=useAuth();const add=useAddLeadTag();const remove=useRemoveLeadTag();window.fixture.renderedOrg=activeOrganization.organizationId;window.fixture.addTag=add.mutateAsync;window.fixture.removeTag=remove.mutateAsync;return null;}
    function CountObserver({management}){useRealTags({reconcileCounts:management});return <output data-testid={management?'management-count-observer':'regular-count-observer'} />;}
    function FixtureApp(){const [regular,setRegular]=React.useState(false);const [management,setManagement]=React.useState(false);window.fixture.setCountObservers=(nextRegular,nextManagement)=>{setRegular(nextRegular);setManagement(nextManagement);};return <><LeadRealtimeBus/><MutationProbe/><TagsTab/>{regular&&<CountObserver management={false}/>} {management&&<CountObserver management={true}/>}</>;}
    createRoot(document.getElementById('app')).render(<QueryClientProvider client={client}><FixtureApp/></QueryClientProvider>);
  `);
  const aliases = Object.fromEntries(['contexts/AuthContext', 'hooks/use-tags', 'lib/api/tags', 'lib/api/leads', 'lib/api/vimob-client', 'lib/api/vimob-error', 'lib/auth/global-sign-out', 'hooks/use-optimistic-lead-history', 'hooks/leads/use-lead-update-cache', 'components/features/crm-management/ManagementToolbar'].map(name => [`@/${name}$`, stubs]));
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode:'development', target:'web', devtool:false, entry, output:{path:directory,filename:'fixture.js'}, resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases,'sonner$':stubs,'@':root},modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false,usedExports:true} });
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const repositoryPath = root.replaceAll('\\', '/');
  const productCss = (await readFile(path.join(root, 'app/globals.css'), 'utf8'))
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const cssSources = ['components/features/crm-management/TagsTab.tsx', 'components/ui'];
  const css = await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(
    `${productCss}\n${cssSources.map(source=>`@source "${repositoryPath}/${source}";`).join('\n')}`,
    {from:path.join(root,'app/tags-fixture.css')},
  );
  browser = await chromium.launch({headless:true});
  page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/*', route=>route.request().url()==='http://tags-fixture.local/'?route.fulfill({contentType:'text/html',body:`<style>${css.css}</style><div id="app"></div>`}):route.abort());
  await page.goto('http://tags-fixture.local/');
  await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});
  await page.getByRole('button',{name:'Nova tag',exact:true}).waitFor();
});

test('deletion dependencies remain inside a short viewport with reachable actions in both themes', async()=>{
  try {
    for(const [theme,width,height] of [['light',360,300],['dark',768,320]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(theme=>{document.documentElement.className=theme;window.fixture.allTagDependencies=true;},theme);
      await page.getByRole('button',{name:'Excluir tag Quente',exact:true}).click();
      const dialog=page.getByRole('alertdialog');
      const bounds=await dialog.boundingBox();
      assert.ok(bounds && bounds.y>=0 && bounds.y+bounds.height<=height,`${theme}: dialog must fit the viewport: ${JSON.stringify(bounds)}`);
      assert.equal(await dialog.getByRole('listitem').count(),7);
      const dimensions=await dialog.evaluate(element=>({viewport:element.clientHeight,content:element.scrollHeight}));
      assert.ok(dimensions.content>dimensions.viewport,'the real dependency content must require scrolling');
      const cancel=dialog.getByRole('button',{name:'Cancelar',exact:true});
      await cancel.scrollIntoViewIfNeeded();
      const actionBounds=await cancel.boundingBox();
      assert.ok(actionBounds && actionBounds.y>=0 && actionBounds.y+actionBounds.height<=height,'cancel must be reachable after scrolling');
      await cancel.click();
      assert.equal(await dialog.count(),0);
    }
  } finally {
    await page.setViewportSize({width:1280,height:720});
    if(await page.getByRole('alertdialog').count()) await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.evaluate(()=>{document.documentElement.className='';window.fixture.allTagDependencies=false;});
  }
});
after(async()=>{
  await browser?.close();
  if(directory){const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('vimob-tags-ui-'));await rm(resolved,{recursive:true,force:true});}
});

test('an old edit reload cannot replace a new tag draft after cancel', async()=>{
  await page.getByRole('button',{name:'Editar tag Quente',exact:true}).click();
  await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.getByRole('button',{name:'Recarregar dados da tag'}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Nova tag',exact:true}).click();
  await page.getByLabel('Nome',{exact:true}).fill('Novo rascunho');
  await page.evaluate(()=>window.fixture.resolveReload());
  await page.waitForTimeout(30);
  assert.equal(await page.getByLabel('Nome',{exact:true}).inputValue(),'Novo rascunho');
  assert.equal(await page.getByRole('heading',{name:'Nova tag',exact:true}).count(),1);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('an old list reload cannot close the next deletion confirmation', async()=>{
  // Recover the fixture dialog if the preceding regression failed pre-fix.
  if(await page.getByRole('dialog').count()) await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Excluir tag Quente',exact:true}).click();
  await page.getByRole('button',{name:'Atualizar lista',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Excluir tag Investidor',exact:true}).click();
  await page.evaluate(()=>window.fixture.resolveReload());
  await page.waitForTimeout(30);
  assert.equal(await page.getByRole('alertdialog').count(),1);
  assert.match(await page.getByRole('alertdialog').innerText(),/Investidor/);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('reopening the same object starts a separate edit and deletion session', async()=>{
  await page.getByRole('button',{name:'Editar tag Quente',exact:true}).click();
  await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.getByRole('button',{name:'Recarregar dados da tag'}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Editar tag Quente',exact:true}).click();
  await page.getByLabel('Nome',{exact:true}).fill('Outro rascunho da mesma tag');
  await page.evaluate(()=>window.fixture.resolveReload());
  await page.waitForTimeout(30);
  assert.equal(await page.getByLabel('Nome',{exact:true}).inputValue(),'Outro rascunho da mesma tag');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Excluir tag Quente',exact:true}).click();
  await page.getByRole('button',{name:'Atualizar lista',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Excluir tag Quente',exact:true}).click();
  await page.evaluate(()=>window.fixture.resolveReload());
  await page.waitForTimeout(30);
  assert.equal(await page.getByRole('alertdialog').count(),1);
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('association, creation and deletion events refresh tag counts only in their tenant', async()=>{
  for(const reason of ['lead.tagged','lead.untagged','lead.created','lead.deleted']){
    await page.evaluate(reason=>{
      window.fixture.client.clear();
      for(const org of ['org-a','org-b'])for(const root of ['tags','tag-usage'])window.fixture.client.setQueryData([root,org,'tag-a'],{count:2});
      window.fixture.emit({organizationId:'org-a',leadId:'lead-a',reason});
    },reason);
    await page.waitForTimeout(230);
    const states=await page.evaluate(()=>['org-a','org-b'].map(org=>['tags','tag-usage'].map(root=>window.fixture.client.getQueryState([root,org,'tag-a']).isInvalidated)));
    assert.deepEqual(states,[[true,true],[false,false]],reason);
  }
});

test('WhatsApp message traffic leaves tag counts untouched', async()=>{
  await page.evaluate(()=>{
    window.fixture.client.clear();
    window.fixture.client.setQueryData(['tags','org-a'],{count:2});
    window.fixture.emit({organizationId:'org-a',leadId:'lead-a',reason:'lead.whatsapp_activity'});
  });
  await page.waitForTimeout(230);
  assert.equal(await page.evaluate(()=>window.fixture.client.getQueryState(['tags','org-a']).isInvalidated),false);
  assert.deepEqual(errors,[]);
});

test('association mutations completing after an org switch retain the original tenant and void return', async()=>{
  for(const operation of ['addTag','removeTag']){
    await page.evaluate(()=>window.fixture.setScope('org-a'));
    await page.waitForFunction(()=>window.fixture.renderedOrg==='org-a');
    await page.evaluate(operation=>{
      window.fixture.client.clear();
      window.fixture.associationEvents=[];
      for(const org of ['org-a','org-b'])window.fixture.client.setQueryData(['tags',org],{count:2});
      window.fixture.pendingAssociation=window.fixture[operation]({leadId:'lead-mutation',tagId:'tag-a'});
    },operation);
    await page.waitForFunction(()=>Boolean(window.fixture.completeAssociation));
    await page.evaluate(()=>window.fixture.setScope('org-b'));
    await page.waitForFunction(()=>window.fixture.renderedOrg==='org-b');
    await page.evaluate(async()=>{window.fixture.completeAssociation();window.fixture.associationReturn=await window.fixture.pendingAssociation;window.fixture.completeAssociation=null;});
    await page.waitForTimeout(230);
    const result=await page.evaluate(()=>({
      requestOrg:window.fixture.requestOrg,
      returnIsVoid:window.fixture.associationReturn===undefined,
      events:window.fixture.associationEvents.map(event=>event.organizationId),
      stale:['org-a','org-b'].map(org=>window.fixture.client.getQueryState(['tags',org]).isInvalidated),
    }));
    assert.deepEqual(result,{requestOrg:'org-a',returnIsVoid:true,events:[],stale:[true,false]},operation);
  }
  assert.deepEqual(errors,[]);
});

test('only mounted visible management reconciles counts; ordinary tag consumers do not poll', async()=>{
  await page.evaluate(()=>window.fixture.setScope('org-b'));
  await page.waitForFunction(()=>window.fixture.renderedOrg==='org-b');
  await page.clock.install();
  await page.evaluate(()=>{
    window.fixture.client.clear();window.fixture.tagReads=[];
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixture.documentHidden?'hidden':'visible'});
    window.fixture.setCountObservers(true,false);
  });
  await page.getByTestId('regular-count-observer').waitFor({state:'attached'});
  await page.waitForFunction(()=>window.fixture.tagReads.length===1);
  await page.clock.fastForward(121_000);
  assert.equal(await page.evaluate(()=>window.fixture.tagReads.length),1,'ordinary consumers never start a reconciliation timer');

  await page.evaluate(()=>window.fixture.setCountObservers(true,true));
  await page.getByTestId('management-count-observer').waitFor({state:'attached'});
  await page.waitForFunction(()=>window.fixture.tagReads.length===2);
  await page.clock.fastForward(61_000);
  await page.waitForFunction(()=>window.fixture.tagReads.length===3);
  assert.deepEqual(await page.evaluate(()=>window.fixture.tagReads),['org-b','org-b','org-b']);

  await page.evaluate(()=>{window.fixture.documentHidden=true;window.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.fastForward(121_000);
  assert.equal(await page.evaluate(()=>window.fixture.tagReads.length),3,'hidden management does not poll');
  await page.evaluate(()=>{window.fixture.documentHidden=false;window.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>window.fixture.tagReads.length===4);
  await page.evaluate(()=>window.fixture.setCountObservers(true,false));
  await page.getByTestId('management-count-observer').waitFor({state:'detached'});
  await page.clock.fastForward(121_000);
  assert.equal(await page.evaluate(()=>window.fixture.tagReads.length),4,'unmounting management cancels its timer even while an ordinary consumer remains');
  await page.evaluate(()=>window.fixture.setCountObservers(false,false));
  assert.deepEqual(errors,[]);
});
