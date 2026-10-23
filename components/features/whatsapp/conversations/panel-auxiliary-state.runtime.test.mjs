import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {expect} from '@playwright/test';

// Real Screen/Floating, lead panel, Radix and compiled product CSS. Closed
// auth/DTO/query fixtures; the peripheral property picker only renders its
// actual supplied trigger and captures IDs/disabled without opening or writing.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url),directory=await mkdtemp(join(tmpdir(),'vimob-panel-auxiliary-'));
const proof=process.env.WHATSAPP_PANEL_AUXILIARY_PROOF_DIR;
const input=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=input.indexOf('const id = n =>');assert.ok(boundary>0);
let supportSource=input.slice(0,boundary)
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`);
const changes=`bootstrap=bootstrap
 .replace('  async function mock(name, source)','  let mockSerial=0;async function mock(name, source)')
 .replace('\u0024{Object.keys(aliases).length}.js','\u0024{mockSerial++}.js')
 .replace("export const useOrganizationModules=()=>({hasModule:k=>k==='whatsapp',isLoading:false});","export const useOrganizationModules=()=>({hasModule:k=>(window.harness.modules||['whatsapp']).includes(k),isLoading:false});")
 .replace('export const useUsers=()=>h().emptyQuery;','export const useUsers=()=>h().usersQuery||h().emptyQuery;')
 .replace('export const useProperties=()=>h().emptyQuery;export const useProperty=()=>h().emptyQuery;',"export const useProperties=(s,f,o)=>{h().propertyCatalogOptions=o;return h().propertiesQuery||h().emptyQuery;};export const useProperty=id=>{h().propertyTarget=id;return h().propertyQuery||h().emptyQuery;};")
 .replace('  // Controlled recorder sentinel',"  await mock('@/components/features/properties/PropertyPickerDialog',\u0060import React from 'react';export const PropertyPickerDialog=p=>{window.harness.picker={id:p.selectedPropertyId,disabled:p.disabled};return React.cloneElement(p.trigger,{'data-property-picker-fixture':true});};\u0060);\\n  // Controlled recorder sentinel");
assert.ok(bootstrap.includes('h().usersQuery||h().emptyQuery'));
assert.ok(bootstrap.includes('h().propertyTarget=id'));
assert.ok(bootstrap.includes('mockSerial++'));
`;
supportSource=supportSource.replace("await writeFile(join(directory, 'bootstrap.mjs'),",`${changes}\nawait writeFile(join(directory, 'bootstrap.mjs'),`);
await writeFile(join(directory,'support.mjs'),`${supportSource}\nexport {harness,conversation,css};`);
const support=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-panel-auxiliary-/);await rm(target,{recursive:true,force:true});});

const lead={id:'lead-a',name:'Marina Sintética',assigned_user_id:'owner-a',property_id:'property-a',tags:[]};
const user={id:'owner-a',name:'GUSTAVO SOUZA',email:'gustavo@example.test',organization_id:'org-a',is_active:true};
const property={id:'property-a',code:'AP-1',title:'Casa',organization_id:'org-a'};
const states=[
 ['loading',{isLoading:true},[],null,[],lead,'Carregando responsável…','Carregando imóvel…'],
 ['error',{isError:true},[],null,[],lead,'Responsável indisponível','Imóvel indisponível'],
 ['linked-outside-catalog',{},[{...user,id:'other-user',name:'Pessoa fora do vínculo'}],null,[{...property,id:'other-property',title:'Outro imóvel'}],lead,'Responsável vinculado','Imóvel vinculado'],
 ['resolved',{},[user],property,[],lead,'Gustavo Souza','AP-1 - Casa'],
 ['cached-refetch',{isLoading:false,isFetching:true},[user],property,[],lead,'Gustavo Souza','AP-1 - Casa'],
 ['cached-error',{isError:true},[user],property,[],lead,'Gustavo Souza','AP-1 - Casa'],
 ['absent',{isLoading:true,isError:true},[],null,[],{...lead,assigned_user_id:null,property_id:null},'Sem responsável','Nenhum'],
];
async function patch(page,values){await page.evaluate(values=>{const h=window.harness;Object.assign(h,values);h.render();},values);}
async function fixture(t,mode,width,theme='light'){
 const page=await support.harness(t,mode,{hasTouch:width<768});page.setDefaultTimeout(3000);await page.setViewportSize({width,height:900});
 await page.addStyleTag({content:`${support.css}\nhtml,body,#root{height:100%;margin:0}#root>output{display:none}`});
 await page.evaluate(({mode,width,theme,lead})=>{const h=window.harness;document.documentElement.className=theme;h.mobile=width<768;h.modules=['whatsapp','properties'];
  h.auth.organization={id:'org-a'};h.permissions.push('property_view');h.leadDetail=lead;h.sessions=[{...h.sessions[0],status:'connected'}];
  h.conversations=[{id:'chat-a',lead_id:'lead-a',session_id:'session-a',remote_jid:'5511999998888@s.whatsapp.net',contact_name:lead.name,contact_phone:'5511999998888',last_message:'Mensagem sintética',last_message_from_me:true,last_message_status:'read',unread_count:0,is_group:false,lead:{id:lead.id,name:lead.name,tags:[]}}];
  h.render();if(mode==='floating')h.ctx.openConversation(h.conversations[0]);
 },{mode,width,theme,lead});
 if(mode==='screen')await page.getByText(lead.name,{exact:true}).first().click();
 return page;
}
async function panel(page,width,mode='screen'){
 if(mode==='screen'&&width<768)await page.getByRole('button',{name:'Mostrar dados do contato',exact:true}).click();
 return mode==='screen'?page.getByLabel('Dados do contato',{exact:true}):page.locator('#root');
}
async function record(page,name,values){if(!proof)return;await mkdir(proof,{recursive:true});await writeFile(join(proof,name+'.json'),JSON.stringify(values,null,2));await page.screenshot({path:join(proof,name+'.png'),fullPage:true});}
const mutatingRequests=page=>page.evaluate(()=>window.harness.requests.filter(r=>['send','feedback','archive','delete','link','start'].includes(r.kind)));

for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`panel ${width} ${theme}: auxiliary states never turn a known link into absence`,async t=>{
 const page=await fixture(t,'screen',width,theme),pane=await panel(page,width);await expect(pane).toBeVisible();
 const observations=[];
 for(const [name,status,users,resolved,properties,leadDetail,assigneeLabel,propertyLabel]of states){
   await patch(page,{leadDetail,usersQuery:{data:users,...status},propertyQuery:{data:resolved,...status},propertiesQuery:{data:properties,...status}});
   const owner=pane.getByRole('button',{name:assigneeLabel,exact:true}),asset=pane.locator('[data-property-picker-fixture]');
   await record(page,`${width}-${theme}-${name}-before`,{assigneeLabel,propertyLabel});
   await expect(owner).toBeVisible();await expect(asset).toHaveText(propertyLabel);
   assert.equal(await page.evaluate(()=>window.harness.picker.id),leadDetail.property_id);
   assert.equal(await page.evaluate(()=>window.harness.propertyTarget),leadDetail.property_id);
   await expect(owner).toHaveCSS('font-size','11px');await expect(owner).toHaveCSS('font-weight','300');await expect(owner).toHaveCSS('height','32px');await expect(owner).toHaveCSS('border-radius','6px');
   await expect(asset).toHaveCSS('font-size','12px');await expect(asset).toHaveCSS('height','32px');await expect(asset).toHaveCSS('border-radius','6px');
   const geometry=await pane.evaluate(node=>{const r=node.getBoundingClientRect();return{width:r.width,scroll:node.scrollWidth,client:node.clientWidth,viewport:innerWidth};});
   assert.ok(geometry.scroll<=geometry.client+1);observations.push({name,assigneeLabel,propertyLabel,geometry});
 }
 await record(page,`${width}-${theme}-states`,observations);assert.deepEqual(await mutatingRequests(page),[]);
});

for(const width of [320,390])for(const scope of ['view-only','foreign-organization'])test(`panel ${width} ${scope}: labels preserve links and permission gates`,async t=>{
 const page=await fixture(t,'panel',width);
 await page.evaluate(scope=>{const h=window.harness;h.permissions=['whatsapp_view','property_view',...(scope==='foreign-organization'?['lead_operate','whatsapp_operate']:[])];
  if(scope==='foreign-organization'){h.auth.activeOrganization={organizationId:'org-b'};h.auth.organization={id:'org-b'};h.scope={...h.scope,organizationId:'org-b'};}
  h.usersQuery={data:[],isLoading:false,isError:false};h.propertyQuery={data:null,isLoading:false,isError:false};h.propertiesQuery={data:[],isLoading:false,isError:false};h.render();
 },scope);
 const pane=await panel(page,width,'panel');await expect(pane.getByRole('button',{name:'Responsável vinculado',exact:true})).toBeDisabled();
 const asset=pane.locator('[data-property-picker-fixture]');await expect(asset).toHaveText('Imóvel vinculado');await expect(asset).toBeDisabled();
 assert.deepEqual(await page.evaluate(()=>window.harness.picker),{id:'property-a',disabled:true});assert.deepEqual(await mutatingRequests(page),[]);
});

test('panel without property visibility never resolves a linked property from cached catalog data',async t=>{
 const page=await fixture(t,'panel',390);await patch(page,{permissions:['whatsapp_view'],usersQuery:{data:[user]},propertyQuery:{data:property},propertiesQuery:{data:[property]}});
 const asset=page.locator('[data-property-picker-fixture]');await expect(asset).toHaveText('Imóvel vinculado');await expect(asset).toBeDisabled();
 assert.equal(await page.evaluate(()=>window.harness.propertyTarget),null);assert.equal(await page.evaluate(()=>window.harness.propertyCatalogOptions.enabled),false);
 assert.deepEqual(await mutatingRequests(page),[]);
});

for(const width of [320,390])for(const theme of ['light','dark'])test(`floating ${width} ${theme}: shared cards and read-only mobile conversation remain intact`,async t=>{
 const page=await fixture(t,'floating',width,theme);await expect(page.getByRole('textbox',{name:'Digite sua mensagem',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Voltar à lista de conversas',exact:true}).click();
 const card=page.locator('[data-conversation-id="chat-a"]');await expect(card).toContainText('Marina Sintética');await expect(card.getByRole('img',{name:'Mensagem lida',exact:true})).toBeVisible();
 await card.getByRole('button').first().click();await patch(page,{permissions:['whatsapp_view']});
 const input=page.getByRole('textbox',{name:'Digite sua mensagem',exact:true});await expect(input).toBeDisabled();await expect(input).toHaveAttribute('placeholder','Somente leitura');assert.deepEqual(await mutatingRequests(page),[]);
 await record(page,`floating-${width}-${theme}`,{readonly:true});
});
