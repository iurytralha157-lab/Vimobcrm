import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Production handlers and hydration effect, actual ownership/access hooks,
// QueryClient and ProfileHover. Synthetic auth/mutations, all network blocked.
const require = createRequire(import.meta.url), ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let directory, browser, page, bundle;
const pageErrors = [];
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-lead-tag-'));
  const production = await readFile(process.env.PIPELINE_TAG_DETAIL_SOURCE || path.join(root, 'components/features/leads/LeadDetailDialog.tsx'), 'utf8');
  const ast = ts.createSourceFile('LeadDetailDialog.tsx', production, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function variable(name) { let result; const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node; ts.forEachChild(node,visit); }; visit(ast); assert(result,name); return `const ${result.getText(ast)};`; }
  const avatars = []; let hydration;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'leadAvatarUrl') avatars.push(node.initializer.getText(ast));
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect' && node.getText(ast).includes('setLocalLead(hydratedLead)')) hydration = node.getText(ast);
    ts.forEachChild(node,visit);
  }; visit(ast); assert.equal(avatars.length,2); assert(hydration);
  const stub = path.join(directory,'stub.tsx'), entry = path.join(directory,'entry.tsx'), loader = path.join(directory,'loader.cjs');
  await writeFile(stub, `import{createContext,useContext}from'react';export const Auth=createContext(null),useAuth=()=>useContext(Auth);export const useLeadSensitiveProfile=()=>({data:{},isLoading:false,isFetching:false,isError:false});`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}),fs=require('node:fs');module.exports=function(s){if(process.env.PIPELINE_TAG_PROFILE_SOURCE&&this.resourcePath.replaceAll('\\\\','/').endsWith('/lead-detail/LeadProfileHover.tsx'))s=fs.readFileSync(process.env.PIPELINE_TAG_PROFILE_SOURCE,'utf8');return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
  await writeFile(entry, `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{useLeadDetailOperationScope}from'@/hooks/leads/use-lead-detail-operation-scope';import{useLeadTagOptimism}from'@/hooks/leads/use-lead-tag-optimism';import{getGlobalSignOutSessionId}from'@/lib/auth/global-sign-out';
    import{hydrateLeadDetail}from'@/components/features/leads/lead-detail/hydrate-lead-detail';import{compareServerRevisions}from'@/lib/compare-server-revisions';import{LeadProfileHover}from'@/components/features/leads/lead-detail/LeadProfileHover';import{Auth}from'./stub';
    import{getLeadDetailReadState}from'@/components/features/leads/lead-detail/read-recovery';
    const h=window.h={requests:[],invalidations:[],boardPatches:[],restores:0,seed:{id:'lead-a',organization_id:'org-a',name:'Synthetic',deal_status:'open',assigned_user_id:'owner-a',updated_at:'2026-10-16T12:00:00.000001Z',tags:[{id:'base',name:'Base'}],whatsapp_avatar_url:null}};
    const client=h.client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});const invalidate=client.invalidateQueries.bind(client);client.invalidateQueries=filters=>{h.invalidations.push(filters);return invalidate(filters)};
    function Detail({scope}){const[localLead,setLocalLead]=useState(h.seed),[canonical,setCanonical]=useState(h.seed);const leadProp=h.seed,lead=leadProp,leadId=lead.id,queryClient=client;
      const activeOrganization={organizationId:scope.org},user={id:scope.actor},session={access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid}))+'.synthetic'};
      const canOperateLead=scope.allowed,hasLeadOperatePermission=scope.allowed,readAccessBlocked=false,isUpdatingAssignee=false,fullLeadQuery={data:canonical};
      const detailReadState=getLeadDetailReadState({leadId,organizationId:scope.org,leadOrganizationId:lead.organization_id,query:{...fullLeadQuery,isSuccess:true,isError:false,isFetching:false,isFetchedAfterMount:true}});
      ${variable('captureDetailOperation')}
      const tagOptimism=useLeadTagOptimism({leadId,organizationId:scope.org,actorId:scope.actor,sessionId:scope.sid,canOperate:canOperateLead,setLead:setLocalLead});
      ${hydration}
      const leadTags=localLead.tags||[],safeAllTags=h.allTags??[{id:'target',name:'Target',color:'#123456'},{id:'other',name:'Other'}],isTagMutationPending=false;
      const updatePipelineLeadCache=(leadId,patch)=>{h.boardPatches.push({leadId,patch});return[]},restorePipelineCache=()=>h.restores++,setTagPopoverOpen=()=>{};
      const request=(kind,input)=>{let row;const pending=new Promise((resolve,reject)=>{row={kind,input,resolve,reject,settled:false};h.requests.push(row)});return pending.finally(()=>row.settled=true)};const addTag={mutateAsync:input=>request('add',input)},removeTag={mutateAsync:input=>request('remove',input)};
      ${variable('handleAddTag')}
      ${variable('handleRemoveTag')}
      h.local=localLead;h.handlers={add:handleAddTag,remove:handleRemoveTag};h.patchLocal=patch=>setLocalLead(value=>({...value,...patch}));h.addOther=()=>setLocalLead(value=>({...value,tags:[...value.tags,{id:'other',name:'Other'}]}));
      h.canonical=async(patch={},same=false)=>{const key=['lead',scope.org,leadId],next=same?structuredClone(h.local):{...h.local,...patch};if(same)client.setQueryData(key,h.local);const before=client.getQueryData(key);await client.fetchQuery({queryKey:key,queryFn:async()=>next,staleTime:0});const installed=client.getQueryData(key);h.sharedCanonical=installed===before;setCanonical(installed)};
      const mobileAvatar=${avatars[0]},desktopAvatar=${avatars[1]};h.avatars={mobile:mobileAvatar,desktop:desktopAvatar};
      return <><pre data-testid='lead'>{JSON.stringify(localLead)}</pre><div data-testid='profile'><LeadProfileHover lead={localLead} canRevealSensitive={false} variant='pipeline'/></div></>}
    function Fixture(){const[scope,setScope]=useState({org:'org-a',actor:'actor-a',sid:'sid-a',allowed:true}),[shown,setShown]=useState(true);h.scope=scope;h.switch=patch=>setScope(old=>({...old,...patch}));h.show=setShown;
      return <Auth.Provider value={{activeOrganization:{organizationId:scope.org}}}><QueryClientProvider client={client}>{shown&&<Detail scope={scope}/>}</QueryClientProvider></Auth.Provider>}
    const reactRoot=createRoot(document.getElementById('app'));h.mount=()=>reactRoot.render(<Fixture/>);
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules'),'node_modules'],alias:{'@/contexts/AuthContext$':stub,'@/hooks/use-leads$':stub,'@':root}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });bundle=await readFile(path.join(directory,'fixture.js'),'utf8');browser=await chromium.launch({headless:true});
},{timeout:180_000});
beforeEach(async()=>{page=await browser.newPage();page.setDefaultTimeout(5_000);page.on('pageerror',error=>pageErrors.push(error.message));await page.route('**/*',route=>route.request().url()==='https://lead-tag.invalid/'?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());await page.goto('https://lead-tag.invalid/');await page.addScriptTag({content:bundle})});
afterEach(async()=>page?.close());
after(async()=>{await browser?.close();if(directory){const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert(path.basename(target).startsWith('vimob-lead-tag-'));await rm(target,{recursive:true,force:true})}assert.deepEqual(pageErrors,[])});
async function mount(patch={},options={}){await page.evaluate(({patch,options})=>{window.h.seed={...window.h.seed,...patch};window.h.allTags=options.allTags;window.h.mount()},{patch,options});await page.getByTestId('lead').waitFor()}
async function start(kind='add',tag='target'){await page.evaluate(({kind,tag})=>void window.h.handlers[kind](tag),{kind,tag});await page.waitForFunction(()=>window.h.requests.length>0)}
async function reject(index=0,status=400,code='rejected'){await page.evaluate(({index,status,code})=>window.h.requests[index].reject(Object.assign(Error('Synthetic rejection'),{status,code})),{index,status,code});await page.waitForFunction(index=>window.h.requests[index].settled,index)}
async function local(){return page.evaluate(()=>window.h.local)}
async function switchScope(patch){await page.evaluate(patch=>window.h.switch(patch),patch);await page.waitForFunction(patch=>Object.entries(patch).every(([key,value])=>window.h.scope[key]===value),patch)}

for(const kind of ['add','remove']) test('owned tag '+kind+' rollback preserves newer status, assignee and another tag',async()=>{
  await mount(kind==='remove'?{tags:[{id:'target',name:'Target'},{id:'base',name:'Base'}]}:{});await start(kind);
  await page.evaluate(()=>{window.h.patchLocal({deal_status:'won',assigned_user_id:'owner-b'});window.h.addOther()});await reject();
  const lead=await local();assert.equal(lead.deal_status,'won');assert.equal(lead.assigned_user_id,'owner-b');assert(lead.tags.some(tag=>tag.id==='other'));
  assert.equal(lead.tags.some(tag=>tag.id==='target'),kind==='remove');assert.equal(await page.evaluate(()=>window.h.restores),0);
  assert.deepEqual(lead.tags.map(tag=>tag.id),kind==='remove'?['target','base','other']:['base','other']);
});

for(const kind of ['add','remove']) test('newer canonical read retires '+kind+' rollback and preserves its tags',async()=>{
  await mount(kind==='remove'?{tags:[{id:'target',name:'Target'}]}:{});await start(kind);
  await page.evaluate(()=>window.h.canonical({updated_at:'2026-10-16T12:00:00.000002Z',deal_status:'lost',assigned_user_id:'owner-b',tags:[{id:'new-server-tag',name:'New'}]}));
  await page.waitForFunction(()=>window.h.local.updated_at.endsWith('000002Z'));await reject();
  const lead=await local();assert.equal(lead.deal_status,'lost');assert.equal(lead.assigned_user_id,'owner-b');assert.deepEqual(lead.tags.map(tag=>tag.id),['new-server-tag']);
});

for(const kind of ['add','remove']) test('identical canonical payload still fences '+kind+' rollback through structural sharing',async()=>{
  await mount(kind==='remove'?{tags:[{id:'target',name:'Target'}]}:{});await start(kind);await page.evaluate(()=>window.h.canonical({},true));
  const before=await local();assert.equal(await page.evaluate(()=>window.h.sharedCanonical),true);await reject();assert.deepEqual(await local(),before);
});

for(const winner of ['first','second']) test('same relation overlap keeps '+winner+' accepted result after another rejection',async()=>{
  await mount();await start();await page.evaluate(()=>void window.h.handlers.add('target'));await page.waitForFunction(()=>window.h.requests.length===2);
  const success=winner==='first'?0:1,failure=1-success;await page.evaluate(index=>window.h.requests[index].resolve({}),success);await reject(failure);
  assert((await local()).tags.some(tag=>tag.id==='target'));assert.equal(await page.evaluate(()=>window.h.restores),0);
});

for(const winner of ['first','second']) test('same removal overlap keeps '+winner+' accepted absence after another rejection',async()=>{
  await mount({tags:[{id:'target',name:'Target'}]});await start('remove');await page.evaluate(()=>void window.h.handlers.remove('target'));await page.waitForFunction(()=>window.h.requests.length===2);
  const success=winner==='first'?0:1,failure=1-success;await page.evaluate(index=>window.h.requests[index].resolve({}),success);await reject(failure);
  assert.equal((await local()).tags.some(tag=>tag.id==='target'),false);assert.equal(await page.evaluate(()=>window.h.restores),0);
});

test('different pending tag relations roll back independently in the same lead',async()=>{
  await mount();await start();await page.evaluate(()=>void window.h.handlers.add('other'));await page.waitForFunction(()=>window.h.requests.length===2);
  await reject(0);assert.equal((await local()).tags.some(tag=>tag.id==='target'),false);assert((await local()).tags.some(tag=>tag.id==='other'));
  await reject(1);assert.deepEqual((await local()).tags.map(tag=>tag.id),['base']);
});

test('overlapping rejected snapshots stay provisional until the canonical relation is read',async()=>{
  await mount();await start();await page.evaluate(()=>void window.h.handlers.add('target'));await page.waitForFunction(()=>window.h.requests.length===2);
  await reject(0);await reject(1);assert((await local()).tags.some(tag=>tag.id==='target'));
  await page.evaluate(()=>window.h.canonical({tags:[{id:'base',name:'Base'}]}));await page.waitForFunction(()=>window.h.local.tags.length===1);
  assert.deepEqual((await local()).tags.map(tag=>tag.id),['base']);
});

test('newer local server revision is reconciled without replacing its status or tag snapshot',async()=>{
  await mount();await start();await page.evaluate(()=>window.h.patchLocal({deal_status:'won',assigned_user_id:'owner-b',updated_at:'2026-10-16T12:00:00.000002Z',tags:[{id:'target',name:'Authoritative target'},{id:'new',name:'New'}]}));
  await reject();const lead=await local();assert.equal(lead.deal_status,'won');assert.equal(lead.assigned_user_id,'owner-b');assert.deepEqual(lead.tags.map(tag=>tag.id),['target','new']);
});

for(const status of [undefined,408,500,503]) test('uncertain rejection '+status+' reconciles without inventing a rollback',async()=>{
  await mount();await start();await reject(0,status??0);assert((await local()).tags.some(tag=>tag.id==='target'));
  assert(await page.evaluate(()=>window.h.invalidations.some(filters=>filters.queryKey[0]==='lead'&&filters.refetchType==='active')));
});

test('already-existing relation response keeps the relation and asks for canonical reconciliation',async()=>{
  await mount();await start();await reject(0,409,'tag_already_exists');assert((await local()).tags.some(tag=>tag.id==='target'));
});

for(const replacement of [{org:'org-b'},{actor:'actor-b'},{sid:'sid-b'},{allowed:false}]) test('retired tag failure cannot mutate replacement scope '+JSON.stringify(replacement),async()=>{
  await mount();await start();await switchScope(replacement);await page.evaluate(()=>window.h.patchLocal({name:'Replacement',tags:[{id:'replacement',name:'Replacement'}]}));await reject();
  assert.equal((await local()).name,'Replacement');assert.deepEqual((await local()).tags.map(tag=>tag.id),['replacement']);
  assert(await page.evaluate(()=>window.h.invalidations.every(filters=>filters.refetchType==='none')));
});

test('SID A to B to A never revives a pending tag rollback or an old initiating callback',async()=>{
  await mount();await page.evaluate(()=>window.h.savedAdd=window.h.handlers.add);await start();await switchScope({sid:'sid-b'});await switchScope({sid:'sid-a'});
  await page.evaluate(()=>window.h.patchLocal({tags:[{id:'replacement',name:'Replacement'}]}));await reject();assert.deepEqual((await local()).tags.map(tag=>tag.id),['replacement']);
  await page.evaluate(()=>void window.h.savedAdd('other').catch(()=>{}));assert.equal(await page.evaluate(()=>window.h.requests.length),1);
});

test('close and reopen cannot restore the previous visit snapshot',async()=>{
  await mount();await start();await page.evaluate(()=>window.h.show(false));await page.getByTestId('lead').waitFor({state:'detached'});
  await page.evaluate(()=>{window.h.seed={...window.h.seed,name:'Reopened',tags:[{id:'replacement',name:'Replacement'}]};window.h.show(true)});await page.getByTestId('lead').waitFor();await reject();
  assert.equal((await local()).name,'Reopened');assert.deepEqual((await local()).tags.map(tag=>tag.id),['replacement']);
});

test('hydrated avatar uses the fresh state in mobile and desktop while preserving precedence',async()=>{
  await mount();await page.evaluate(()=>window.h.canonical({whatsapp_avatar_url:'https://images.invalid/fresh'}));await page.waitForFunction(()=>window.h.local.whatsapp_avatar_url);
  assert.deepEqual(await page.evaluate(()=>window.h.avatars),{mobile:'https://images.invalid/fresh',desktop:'https://images.invalid/fresh'});
  await page.evaluate(()=>window.h.canonical({whatsapp_picture:'https://images.invalid/preferred',contact_picture:'https://images.invalid/fallback'}));
  await page.waitForFunction(()=>window.h.local.whatsapp_picture);assert.equal(await page.evaluate(()=>window.h.avatars.desktop),'https://images.invalid/preferred');
});

test('Unicode profile presentation is normalized without changing the stored lead name',async()=>{
  const name='𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪';await mount({name});const button=page.getByTestId('profile').getByRole('button');
  assert.equal((await button.innerText()).trim(),'Ana Silva');await button.click();await page.getByText('Ficha do lead',{exact:true}).waitFor();
  assert.equal(await page.getByText('Ana Silva',{exact:true}).count(),2);assert.equal((await local()).name,name);
});

const pickerCatalogTag={id:'catalog-tag',name:'Catálogo disponível',color:'#f97316',organization_id:'org-a'};
async function startCatalog(){await page.evaluate(tag=>void window.h.handlers.add(tag.id,tag),pickerCatalogTag);await page.waitForFunction(()=>window.h.requests.length===1)}

test('picker catalog bridges an empty parent list through the actual handler, optimistic card and mutation',async()=>{
  await mount({}, {allTags:[]});await startCatalog();
  await page.waitForFunction(()=>window.h.local.tags.some(tag=>tag.id==='catalog-tag'));
  const projected=(await local()).tags.find(tag=>tag.id==='catalog-tag');
  assert.deepEqual(projected,{id:pickerCatalogTag.id,name:pickerCatalogTag.name,color:pickerCatalogTag.color});
  assert.equal('updated_at' in projected,false);
  assert.deepEqual(await page.evaluate(()=>window.h.requests[0].input),{leadId:'lead-a',tagId:'catalog-tag'});
  assert.deepEqual(await page.evaluate(()=>window.h.boardPatches[0]),{leadId:'lead-a',patch:{tags:[{id:'base',name:'Base'},projected]}});
  await page.evaluate(()=>window.h.requests[0].resolve({}));await page.waitForFunction(()=>window.h.requests[0].settled);
  assert((await local()).tags.some(tag=>tag.id==='catalog-tag'));assert.equal(await page.evaluate(()=>window.h.restores),0);
});

for(const [label,tag] of [
  ['mismatched ID',{...pickerCatalogTag,id:'different-tag'}],
  ['foreign organization',{...pickerCatalogTag,id:'target',organization_id:'org-b'}],
]) test('catalog '+label+' cannot fall through to a matching legacy parent tag',async()=>{
  await mount();const before=await local();
  await page.evaluate(tag=>window.h.handlers.add('target',tag),tag);
  assert.deepEqual(await local(),before);assert.equal(await page.evaluate(()=>window.h.requests.length),0);
  assert.equal(await page.evaluate(()=>window.h.boardPatches.length),0);assert.equal(await page.evaluate(()=>window.h.invalidations.length),0);
});

for(const replacement of ['organization','session','lead']) test('catalog bridge retires its pending rollback and retained callback after '+replacement+' replacement',async()=>{
  await mount({}, {allTags:[]});await page.evaluate(()=>{window.h.savedCatalogAdd=window.h.handlers.add});await startCatalog();
  const replacementLead={id:replacement==='lead'?'lead-b':'lead-a',organization_id:replacement==='organization'?'org-b':'org-a',name:'Replacement',tags:[{id:'replacement',name:'Current relation'}]};
  if(replacement==='organization')await switchScope({org:'org-b'});
  if(replacement==='session')await switchScope({sid:'sid-b'});
  if(replacement==='lead'){
    await page.evaluate(()=>window.h.show(false));await page.getByTestId('lead').waitFor({state:'detached'});
    await page.evaluate(patch=>{window.h.seed={...window.h.seed,...patch};window.h.show(true)},replacementLead);
    await page.getByTestId('lead').waitFor();await page.waitForFunction(()=>window.h.local.id==='lead-b');
  }else{
    await page.evaluate(patch=>window.h.patchLocal(patch),replacementLead);await page.waitForFunction(()=>window.h.local.name==='Replacement');
  }
  const before=await local();
  await page.evaluate(tag=>window.h.savedCatalogAdd(tag.id,tag).catch(()=>{}),pickerCatalogTag);
  assert.equal(await page.evaluate(()=>window.h.requests.length),1);assert.equal(await page.evaluate(()=>window.h.boardPatches.length),1);
  await reject();assert.deepEqual(await local(),before);
  assert(await page.evaluate(()=>window.h.invalidations.every(filters=>filters.refetchType==='none')));
});
