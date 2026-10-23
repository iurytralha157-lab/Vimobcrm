import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real Screen/Floating, Avatar/Radix, Bubble, Media, Audio and sender-avatar hook.
// Auth/data API, users-summary transport and image bytes are closed fixtures.
// No browser/provider/Storage request leaves Playwright interception.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-avatar-reuse-surfaces-'));
const output = process.env.WHATSAPP_AVATAR_SURFACE_PROOF_DIR || join(directory,'proof');
const ORG='10000000-0000-4000-8000-000000000001', USER='10000000-0000-4000-8000-000000000002';
const BROKER='10000000-0000-4000-8000-000000000003', ASSIGNEE='10000000-0000-4000-8000-000000000004';
const LEAD='10000000-0000-4000-8000-000000000005', SESSION='10000000-0000-4000-8000-000000000006';
const CONVERSATION='10000000-0000-4000-8000-000000000007';
const images={lead:'https://avatars.example.test/private-lead.png?token=synthetic',contact:'https://avatars.example.test/contact.png',
  viewer:'https://avatars.example.test/viewer.png',broker:'https://avatars.example.test/broker.png',assignee:'https://avatars.example.test/assignee.png',broken:'https://avatars.example.test/broken.png',denied:'https://avatars.example.test/denied.png'};
const names={lead:'Marina Sintética',viewer:'André Sintético',broker:'Bruno Sintético',assignee:'Carla Sintética'};
assert.equal(process.env.WHATSAPP_INTEGRATION_BASELINE_DIR,undefined,'Use current product sources, never an inherited baseline');
await mkdir(output,{recursive:true});
const integrated=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=integrated.indexOf('const id = n =>');assert.ok(boundary>0);
let supportSource=integrated.slice(0,boundary)
  .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
  .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`)
  .replace('const proof = process.env.WHATSAPP_INTEGRATION_PROOF_DIR;',`const proof=${JSON.stringify(output)};`);
const summaries=`export async function getUserSummaries(ids,organizationId,transport={}){
 const h=window.harness;if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new Error('Invalid user-summary fixture batch');
 if(organizationId!==h.scope.organizationId||transport.expectedUserId!==h.scope.userId)throw new Error('Wrong summary tenant/actor');
 if(transport.signal?.aborted)throw new DOMException('Aborted','AbortError');
 (h.summaryRequests??=[]).push({ids:[...ids],organizationId,expectedUserId:transport.expectedUserId});
 return(h.users||[]).filter(user=>ids.includes(user.id)).map(({id,name,avatar_url})=>({id,name,avatar_url}));}`;
const innerTransform=`
bootstrap=bootstrap.replace("  const ts=require('typescript');",${JSON.stringify(`  await mock('@/lib/api/user-summaries',${JSON.stringify(summaries)});\n  const ts=require('typescript');`)})
 .replace("export const useUsers=()=>h().emptyQuery;","export const useUsers=()=>({...h().emptyQuery,data:h().users||[]});")
 .replaceAll("'org-a'",${JSON.stringify(JSON.stringify(ORG))}).replaceAll("'user-a'",${JSON.stringify(JSON.stringify(USER))})
 .replaceAll("'lead-a'",${JSON.stringify(JSON.stringify(LEAD))}).replaceAll("'session-a'",${JSON.stringify(JSON.stringify(SESSION))});
`;
supportSource=supportSource.replace("await writeFile(join(directory, 'bootstrap.mjs'),",`${innerTransform}\nawait writeFile(join(directory, 'bootstrap.mjs'),`);
assert.ok(supportSource.includes('Invalid user-summary fixture batch'));assert.ok(supportSource.includes('data:h().users||[]'));
await writeFile(join(directory,'support.mjs'),`${supportSource}\nexport {harness,conversation,css};`);
const support=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^vimob-avatar-reuse-surfaces-/);await rm(directory,{recursive:true,force:true});});

function audioURL(){const wav=Buffer.alloc(844);wav.write('RIFF');wav.writeUInt32LE(836,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(800,40);wav.fill(128,44);return`data:audio/wav;base64,${wav.toString('base64')}`;}
function audioMessage(n,fromMe,senderId,senderName){return{id:`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,message_id:`provider-${n}`,conversation_id:CONVERSATION,lead_id:LEAD,session_id:SESSION,
  from_me:fromMe,sender_user_id:senderId,sender_name:senderName,content:null,message_type:'audio',media_url:audioURL(),media_mime_type:'audio/wav',media_status:'ready',status:fromMe?'sent':'received',sent_at:`2026-10-14T10:0${n}:00Z`,metadata:{}};}
const messageIds=[1,2,3].map(n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
async function fixture(t,mode,width,fallback=false){
  const page=await support.harness(t,mode,{hasTouch:width<768});page.setDefaultTimeout(6000);await page.setViewportSize({width,height:900});
  const loads=[];await page.route('https://avatars.example.test/**',async route=>{
    const url=route.request().url();loads.push(url);if(url===images.broken)return route.fulfill({status:404,body:'synthetic missing image'});
    assert.ok(Object.values(images).includes(url),`Unexpected image URL ${url}`);
    const color=url.includes('private-lead')?'#30a46c':url.includes('viewer')?'#4361ee':url.includes('broker')?'#9b5de5':url.includes('assignee')?'#c77d20':'#0e9fa6';
    return route.fulfill({status:200,contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="${color}"/><circle cx="24" cy="18" r="8" fill="white"/><path d="M8 48v-7a16 16 0 0 1 32 0v7" fill="white"/></svg>`});
  });
  await page.addStyleTag({content:`${support.css}\nhtml,body,#root{height:100%;margin:0}#root>output{display:none}`});
  const contact={...support.conversation(CONVERSATION,LEAD),contact_name:names.lead,contact_picture:images.contact,last_message:'Áudio',last_message_from_me:true,last_message_status:'sent',lead:{id:LEAD,name:names.lead,
    whatsapp_avatar_url:fallback?images.broken:images.lead,assigned_user_id:ASSIGNEE,assignee:{id:ASSIGNEE,name:names.assignee,avatar_url:images.assignee},tags:[]}};
  await page.evaluate(({width,contact,images,names,users,messages,ids})=>{
    document.documentElement.className='light';const h=window.harness;h.mobile=width<768;h.users=users;h.summaryRequests=[];
    h.auth.profile={...h.auth.profile,id:ids.user,organization_id:ids.org,name:names.viewer,avatar_url:images.viewer};h.auth.user={id:ids.user};h.auth.organization={id:ids.org};
    h.auth.activeOrganization={organizationId:ids.org};h.scope={organizationId:ids.org,userId:ids.user,accessScope:'own'};h.sessions=[{...h.sessions[0],id:ids.session,owner_user_id:ids.user,status:'connected'}];
    h.conversations=[contact];h.leadDetail={name:names.lead,assigned_user_id:ids.assignee};h.messages={...h.messages,messages};h.render();if(h.mode==='floating')h.ctx.openConversation(contact);
  },{width,contact,images,names,users:[{id:USER,name:names.viewer,avatar_url:images.viewer},{id:BROKER,name:names.broker,avatar_url:images.broker},{id:ASSIGNEE,name:names.assignee,avatar_url:images.assignee}],
    messages:[audioMessage(1,false,null,names.lead),audioMessage(2,true,USER,names.viewer),audioMessage(3,true,BROKER,names.broker)],ids:{user:USER,org:ORG,session:SESSION,assignee:ASSIGNEE}});
  return{page,loads,contact};
}
async function photo(locator,url){await expect(locator.first()).toHaveAttribute('src',url);await expect.poll(()=>locator.first().evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);}
async function screenshot(page,name){await page.screenshot({path:join(output,name+'.png'),fullPage:true});}

for(const mode of ['screen','floating'])for(const width of [320,390,1440])test(`avatar reuse ${mode} ${width}: real cards headers lead panel and author audio`,async t=>{
  const {page,loads}=await fixture(t,mode,width);
  if(mode==='floating')await page.getByRole('button',{name:'Voltar à lista de conversas',exact:true}).click();
  const card=page.locator(`[data-conversation-id="${CONVERSATION}"]`);
  await photo(card.locator('[data-conversation-avatar] img'),images.lead);
  await card.getByLabel(`Responsável: ${names.assignee}`,{exact:true}).hover();
  await photo(page.getByRole('tooltip').locator('img'),images.assignee);await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);await page.mouse.move(0,0);
  await card.locator('button').first().click();await expect(page.locator('[data-message-bubble]').first()).toBeVisible();
  for(const [id,url]of[[messageIds[0],images.lead],[messageIds[1],images.viewer],[messageIds[2],images.broker]])await photo(page.locator(`[data-message-id="${id}"] img`),url);
  assert.equal(await page.locator(`[data-message-id="${messageIds[2]}"] img`).getAttribute('src'),images.broker,'another sender never borrows current assignee or viewer');
  if(mode==='screen'){
    const panel=page.getByLabel('Dados do contato',{exact:true});
    if(width<768)await page.getByRole('button',{name:'Mostrar dados do contato',exact:true}).click();
    await photo(panel.locator('img').filter({visible:true}),images.lead);
    await screenshot(page,`${mode}-${width}-lead-panel`);
    await page.getByRole('button',{name:width<768?'Fechar dados do contato':'Fechar painel do lead',exact:true}).first().click();
    await photo(page.getByLabel('Cabeçalho da conversa',{exact:true}).locator('img'),images.lead);
  }else await photo(page.getByRole('dialog',{name:'Chat do WhatsApp',exact:true}).locator('img').first(),images.lead);
  const summaries=await page.evaluate(()=>window.harness.summaryRequests);
  assert.ok(summaries.length>0);for(const request of summaries){assert.ok(request.ids.length<=100);assert.equal(request.organizationId,ORG);assert.equal(request.expectedUserId,USER);assert.ok(request.ids.every(id=>[USER,BROKER].includes(id)));}
  await screenshot(page,`${mode}-${width}-avatars`);await writeFile(join(output,`${mode}-${width}-proof.json`),JSON.stringify({summaries,interceptedImages:loads,externalRequests:0},null,2));
});

for(const mode of ['screen','floating'])test(`avatar reuse ${mode}: a failed lead photo uses only its own contact fallback`,async t=>{
  const {page,loads}=await fixture(t,mode,390,true);
  if(mode==='screen')await page.locator(`[data-conversation-id="${CONVERSATION}"] button`).first().click();
  await photo(page.locator(`[data-message-id="${messageIds[0]}"] img`),images.contact);
  await photo(page.locator(`[data-message-id="${messageIds[1]}"] img`),images.viewer);
  await photo(page.locator(`[data-message-id="${messageIds[2]}"] img`),images.broker);
  assert.ok(loads.includes(images.broken)&&loads.includes(images.contact));
  await screenshot(page,`${mode}-390-own-fallback`);
});

async function panelWithoutConversationPhoto(t,width=390){
  const current=await fixture(t,'screen',width);
  await current.page.evaluate(({lead,org,url})=>{
    const h=window.harness;
    h.conversations=h.conversations.map(conversation=>({...conversation,contact_picture:null,
      lead:{...conversation.lead,whatsapp_avatar_url:null}}));
    h.leadAccess={data:{id:lead,organization_id:org,whatsapp_avatar_url:url,can_operate:true},
      isSuccess:true,isFetchedAfterMount:true,isFetching:false,isError:false,refetch:()=>{}};
    h.render();
  },{lead:LEAD,org:ORG,url:images.lead});
  await current.page.locator(`[data-conversation-id="${CONVERSATION}"] button`).first().click();
  if(width<768)await current.page.getByRole('button',{name:'Mostrar dados do contato',exact:true}).click();
  return{...current,panel:current.page.getByLabel('Dados do contato',{exact:true})};
}

test('fresh lead photo already fetched by the panel works without a conversation photo',async t=>{
  const{page,panel}=await panelWithoutConversationPhoto(t);
  await photo(panel.locator('[data-conversation-lead-identity] img'),images.lead);
  await screenshot(page,'screen-390-panel-fresh-lead-fallback');
});

test('fresh lead photo is withdrawn when identity or the fresh read no longer matches',async t=>{
  const{page,panel,loads}=await panelWithoutConversationPhoto(t);
  const avatar=panel.locator('[data-conversation-lead-identity] img');
  await photo(avatar,images.lead);
  await page.evaluate(()=>{const h=window.harness;h.leadAccess={...h.leadAccess,isFetching:true};h.render();});
  await photo(avatar,images.lead);
  for(const change of[
    {data:{id:BROKER,organization_id:ORG,whatsapp_avatar_url:images.denied}},
    {data:{id:LEAD,organization_id:BROKER,whatsapp_avatar_url:images.denied}},
    {isSuccess:false,isError:true},
    {isFetchedAfterMount:false},
  ]){
    await page.evaluate(({lead,org,url,change})=>{
      const h=window.harness;h.leadAccess={data:{id:lead,organization_id:org,whatsapp_avatar_url:url,can_operate:true},
        isSuccess:true,isFetchedAfterMount:true,isFetching:false,isError:false,refetch:()=>{},...change};h.render();
    },{lead:LEAD,org:ORG,url:images.lead,change});
    await expect(avatar).toHaveCount(0);
  }
  assert.equal(loads.includes(images.denied),false,'a different lead/tenant photo is never requested');
});
