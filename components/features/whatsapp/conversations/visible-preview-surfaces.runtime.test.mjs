import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real page/widget/list/cards/projector. The warming transport is a sentinel;
// actual IO/network/scope concurrency are validated in the hook's own suite.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..'),require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'vimob-preview-surfaces-'));
const source=await readFile(join(repository,'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'),'utf8');
const boundary=source.indexOf('async function confirmAttachments(page)');assert.ok(boundary>0);
const listExport=`export {ConversationList} from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/ConversationList.tsx').replaceAll('\\','/'))};`;
const warmingMock=`import {useCallback} from 'react';const h=()=>window.harness;
  export function useWhatsAppVisibleCanonicalPreviews(p){const state=h();state.previewOptions||={};state.previewCards||=new Set();
    const name=p.sourceKey.startsWith("page")?"page":"floating";state.previewOptions[name]={enabled:p.enabled,ids:p.conversations.map(c=>c.id),pausedId:p.pausedConversationId,revision:p.listRevision,sourceKey:p.sourceKey};
    const ref=useCallback(node=>{if(!node)return;h().previewCards.add(node.dataset.conversationId);return()=>h().previewCards.delete(node.dataset.conversationId);},[]);
    return {previews:state.warmPreviews||[],previewCardRef:p.enabled?ref:undefined};}`;
let bootstrap=source.slice(0,boundary)
  .replace("import { chromium } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {chromium}=playwright;`)
  .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');",`const repository=${JSON.stringify(repository)};`)
  .replace("export const usePathname=()=>'/dashboard';","export const usePathname=()=>h().pathname||'/dashboard';")
  .replace("export const useWhatsAppConversations=()=>({...h().emptyQuery,data:h().conversations});","export const useWhatsAppConversations=()=>({...h().emptyQuery,data:h().conversations,dataUpdatedAt:h().listRevision||0});")
  .replaceAll('h().conversations.find(c=>c.id===id)','h().conversations.find(c=>c.id.toLowerCase()===id?.toLowerCase())')
  .replace('export const useMarkConversationAsRead=()=>h().mutation;',"export const useMarkConversationAsRead=()=>({mutate:p=>h().requests.push({kind:'mark-read',params:p})});")
  .replace('export const ConversationListItem=()=>null;',`export {ConversationListItem} from ${JSON.stringify(join(repository,'components/features/whatsapp/conversations/ConversationListItem.tsx').replaceAll('\\','/'))};`)
  .replace("export const ConversationList=p=>React.createElement('div',null,p.conversations.map(c=>React.createElement('button',{key:c.id,onClick:()=>p.onSelect(c)},'Abrir '+c.id)));",listExport)
  .replace("  const ts=require('typescript');",`  await mock('@/hooks/whatsapp/use-whatsapp-visible-canonical-previews',${JSON.stringify(warmingMock)});\n  const ts=require('typescript');`)
  .replace("await page.route('**/*',r=>r.abort());","const network=[];await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(network,[],'no external network attempted'));");
assert.ok(bootstrap.includes(listExport));assert.ok(bootstrap.includes('dataUpdatedAt:h().listRevision'));
await writeFile(join(directory,'bootstrap.mjs'),bootstrap+'\nexport {harness,conversation};');
const {harness,conversation}=await import(pathToFileURL(join(directory,'bootstrap.mjs')).href);
after(async()=>{const path=resolve(directory);assert.equal(dirname(path),resolve(tmpdir()));assert.match(basename(path),/^vimob-preview-surfaces-/);await rm(path,{recursive:true,force:true});});
const uuid=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const scope={userId:'user-a',organizationId:'org-a',accessScope:'own'};
function rows(count=3){return Array.from({length:count},(_,index)=>({...conversation(uuid(index+1),uuid(index+1001)),session_id:uuid(3001),contact_name:'Pessoa sintética',lead:{id:uuid(index+1001),name:'Pessoa sintética'},last_message:'Legada '+index,last_message_at:'2026-10-14T15:00:00Z'}));}
function preview(row,index=0){return {scope,conversationId:row.id.toLowerCase(),expectedLeadId:row.lead_id,sessionId:row.session_id,messageId:uuid(index+5001),preview:'Canônica '+index,fromMe:index%2===0,status:index%2===0?'read':'received',sentAt:'2026-10-14T15:00:01Z'};}
async function open(t,mode='screen',{mobile=false,count=3,path=mode==='screen'?'/crm/conversas':'/dashboard',cards=rows(count)}={}){
  const page=await harness(t,mode);await page.setViewportSize({width:mobile?390:1440,height:900});
  await page.evaluate(({mode,mobile,path,cards,previews})=>{const h=window.harness;h.mobile=mobile;h.pathname=path;h.conversations=cards;h.warmPreviews=previews;h.listRevision=123;
    h.sessions=[{...h.sessions[0],status:'connected',id:cards[0].session_id}];h.render(mode);}, {mode,mobile,path,cards,previews:cards.map(preview)});
  if(mode==='floating')await page.evaluate(()=>window.harness.ctx.openChat());
  await expect(page.locator('[data-conversation-id]')).toHaveCount(cards.length);return {page,cards};
}
const card=(page,id)=>page.locator(`[data-conversation-id="${id}"]`);
const options=(page,surface='page')=>page.evaluate(surface=>window.harness.previewOptions[surface],surface);

test('page cards show canonical statuses before selection and register all80 outer cards',async t=>{
  const cards=rows(80);cards[0]={...cards[0],last_message_from_me:true,last_message_status:'delivered'};
  cards[4]={...cards[4],last_message_from_me:null};
  const {page}=await open(t,'screen',{cards});
  await expect(card(page,cards[0].id).getByRole('img',{name:'Mensagem entregue'})).toBeVisible();
  await expect(card(page,cards[2].id).getByRole('img',{name:'Mensagem lida'})).toBeVisible();
  assert.equal(await card(page,cards[1].id).getByRole('img').count(),0,'incoming has no outgoing receipt');
  assert.equal(await card(page,cards[4].id).getByRole('img').count(),0,'authoritative null is preserved');
  assert.equal(await card(page,cards[4].id).locator('[data-conversation-preview]').innerText(),'Legada 4');
  assert.deepEqual((await page.evaluate(()=>[...window.harness.previewCards])).sort(),cards.map(c=>c.id).sort());
  assert.equal((await options(page)).enabled,true);assert.equal((await options(page)).revision,123);
  assert.deepEqual(await page.evaluate(()=>window.harness.requests),[]);assert.equal(await page.locator('[data-screen-chat]').count(),0);
});

test('selected head remains the only source even if warming returns a stale selected snapshot',async t=>{
  const input=rows();input[0].id='000000AB-0000-4000-8000-000000000001';
  const {page,cards}=await open(t,'screen',{cards:input});await card(page,cards[0].id).locator('button').first().click();
  assert.ok((await options(page)).ids.includes(cards[0].id),"selected binding remains in authorized snapshot");assert.equal((await options(page)).pausedId,cards[0].id);
  assert.equal(await card(page,cards[0].id).getByRole('img').count(),0,'null selected head cannot be replaced from warm cache');
  assert.equal(await card(page,cards[0].id).locator('[data-conversation-preview]').innerText(),'Legada 0');
  const canonicalCard={...cards[0],id:cards[0].id.toLowerCase()};
  await page.evaluate(row=>{window.harness.conversations=window.harness.conversations.map(c=>c.id.toLowerCase()===row.id?row:c);window.harness.render();},canonicalCard);
  assert.ok((await options(page)).ids.includes(canonicalCard.id),"canonical DTO stays authorized while paused");assert.equal((await options(page)).pausedId.toLowerCase(),canonicalCard.id);
  assert.equal(await card(page,canonicalCard.id).getByRole('img').count(),0,'cached lowercase warm head stays excluded');
  const selected={...preview(cards[0]),status:'sent',preview:'Do chat atual'};
  await page.evaluate(selected=>{window.harness.messages={...window.harness.messages,canonicalPreview:selected};window.harness.render();},selected);
  await expect(card(page,canonicalCard.id).getByRole('img',{name:'Mensagem enviada',exact:true})).toBeVisible();
  assert.equal(await card(page,canonicalCard.id).getByRole('img',{name:'Mensagem lida'}).count(),0);
  assert.equal(await card(page,canonicalCard.id).locator('[data-conversation-preview]').innerText(),'Do chat atual');
});

test('mobile page warms only while its list is displayed and reconnects refs on return',async t=>{
  const {page,cards}=await open(t,'screen',{mobile:true});assert.equal((await options(page)).enabled,true);
  await card(page,cards[0].id).locator('button').first().click();await expect(page.locator('[data-screen-chat]')).toHaveCount(1);
  assert.equal((await options(page)).enabled,false);assert.equal(await page.evaluate(()=>window.harness.previewCards.size),0);
  await page.getByRole('button',{name:'Voltar para a lista de conversas',exact:true}).click();
  await expect(page.locator('[data-conversation-id]')).toHaveCount(3);assert.equal((await options(page)).enabled,true);
  assert.equal(await page.evaluate(()=>window.harness.previewCards.size),3);
});

test('floating warming is gated by list visibility and excludes the entire conversations route tree',async t=>{
  const {page,cards}=await open(t,'floating');assert.equal((await options(page,'floating')).enabled,true);
  await card(page,cards[0].id).locator('button').first().click();await expect(page.locator('[data-conversation-id]')).toHaveCount(0);
  assert.equal((await options(page,'floating')).enabled,false);assert.ok((await options(page,'floating')).ids.includes(cards[0].id));assert.equal((await options(page,'floating')).pausedId,cards[0].id);
  await page.evaluate(()=>window.harness.ctx.clearActiveConversation());await expect(page.locator('[data-conversation-id]')).toHaveCount(3);
  for(const pathname of['/crm/conversas','/crm/conversas/','/crm/conversas/historico']){await page.evaluate(pathname=>{window.harness.pathname=pathname;window.harness.render();},pathname);assert.equal((await options(page,'floating')).enabled,false);}
  await page.evaluate(()=>{window.harness.pathname='/crm/conversas-externo';window.harness.render();});assert.equal((await options(page,'floating')).enabled,true);
  await page.evaluate(()=>window.harness.ctx.closeChat());assert.equal((await options(page,'floating')).enabled,false);
});

test('page gate rejects accidental mounting on another route and input snapshots remain immutable',async t=>{
  const {page,cards}=await open(t,'screen',{path:'/dashboard'});assert.equal((await options(page)).enabled,false);
  assert.deepEqual(await page.evaluate(()=>window.harness.conversations),cards);
  await page.evaluate(()=>{window.harness.pathname='/crm/conversas/nested';window.harness.render();});assert.equal((await options(page)).enabled,true);
  await page.evaluate(()=>{window.harness.permissions=['lead_operate'];window.harness.render();});assert.equal((await options(page)).enabled,false);
});
