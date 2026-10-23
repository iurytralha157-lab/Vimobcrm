import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {expect} from '@playwright/test';

// Real Screen/Floating, card previews, headers, controls, Radix and product CSS.
// The inherited fixture closes auth/data/network/microphone and app shell.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url), directory=await mkdtemp(join(tmpdir(),'vimob-presence-mobile-'));
const proof=process.env.WHATSAPP_PRESENCE_MOBILE_PROOF_DIR;
const original=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=original.indexOf("\nfor (const mode of ['screen', 'floating'])");assert.ok(boundary>0);
const support=original.slice(0,boundary)
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`);
await writeFile(join(directory,'support.mjs'),`${support}\nexport {fixture,card,noOverflow};`);
const {fixture,card,noOverflow}=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-presence-mobile-/);await rm(target,{recursive:true,force:true});});
const now=Date.parse('2026-10-14T15:00:00Z'), stamp=offset=>new Date(now+offset).toISOString();
async function save(page,name,data){if(!proof)return;await mkdir(proof,{recursive:true});await writeFile(join(proof,name+'.json'),JSON.stringify(data,null,2));await page.screenshot({path:join(proof,name+'.png'),fullPage:true});}
async function list(page,mode){await page.getByRole('button',{name:mode==='screen'?'Voltar para a lista de conversas':'Voltar à lista de conversas',exact:true}).click();}
async function presence(page,state,timestamp,more={}){
 await page.evaluate(({state,timestamp,more})=>{const h=window.harness;h.conversations=h.conversations.map(c=>({...c,...more,contact_presence:state,presence_updated_at:timestamp}));h.render();},{state,timestamp,more});
}
const preview=page=>page.locator('[data-conversation-preview]').first();
const receipt=page=>preview(page).locator('[data-conversation-receipt-slot] svg');

for(const mode of ['screen','floating'])for(const width of [320,390])for(const theme of ['light','dark']){
 test(`${mode} ${width} ${theme}: only timestamp-fresh presence may replace preview and receipt`,async t=>{
   const page=await fixture(t,mode,width,theme);await page.clock.install({time:new Date(now)});await list(page,mode);
   for(const [label,timestamp]of[['missing',null],['invalid','invalid-date'],['stale',stamp(-15001)],['boundary',stamp(-15000)],['future',stamp(60000)]]){
     await presence(page,'composing',timestamp);
     await expect(preview(page).locator('[data-conversation-preview-text]')).toHaveText('Mensagem sintética de teste');
     assert.equal(await receipt(page).count(),1,`${label} must retain outgoing receipt`);
   }
   await page.clock.setSystemTime(new Date(now+61000));await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));window.harness.render();});
   await expect(preview(page)).toContainText('Mensagem sintética de teste');
   await page.clock.setSystemTime(new Date(now));
   for(const state of ['composing','recording']){
     await presence(page,state,stamp(-1000));
     await expect(preview(page)).toContainText(state==='composing'?'digitando...':'Gravando áudio...');assert.equal(await receipt(page).count(),0);
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await preview(page).locator('[data-conversation-preview-text]').evaluate(n=>getComputedStyle(n).animationName),'none');
   await presence(page,'paused',stamp(0));await expect(preview(page)).toContainText('Mensagem sintética de teste');
   await presence(page,'composing',stamp(-15001),{last_message_from_me:false,last_message_status:'received'});
   assert.equal(await receipt(page).count(),0,'received messages never gain outgoing checks');
   await noOverflow(page);await save(page,`${mode}-${width}-${theme}-list`,{requests:await page.evaluate(()=>window.harness.requests.length)});
   assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
 });
}

for(const mode of ['screen','floating'])test(`${mode}: presence expires without a server stop event and a renewed event extends only its card`,async t=>{
 const page=await fixture(t,mode,390);await page.clock.install({time:new Date(now)});await list(page,mode);
 await page.evaluate(contact=>{const h=window.harness;h.conversations=[{...contact,contact_presence:'composing',presence_updated_at:new Date(Date.now()).toISOString()},{...contact,id:'chat-b',lead_id:'lead-b',lead:{...contact.lead,id:'lead-b',name:'Bruna Sintética'},contact_presence:'recording',presence_updated_at:new Date(Date.now()-10000).toISOString()}];h.render();},card());
 const a=page.locator('[data-conversation-id="chat-a"] [data-conversation-preview]'),b=page.locator('[data-conversation-id="chat-b"] [data-conversation-preview]');
 await expect(a).toContainText('digitando...');await expect(b).toContainText('Gravando áudio...');
 await page.clock.runFor(5001);await expect(b).toContainText('Mensagem sintética de teste');await expect(a).toContainText('digitando...');
 await page.evaluate(()=>{const h=window.harness;h.conversations=h.conversations.map(c=>c.id==='chat-a'?{...c,presence_updated_at:new Date(Date.now()).toISOString()}:c);h.render();});
 await page.clock.runFor(10000);await expect(a).toContainText('digitando...');
 await page.clock.runFor(5001);await expect(a).toContainText('Mensagem sintética de teste');
 assert.equal(await a.locator('[data-conversation-receipt-slot] svg').count(),1);assert.equal(await b.locator('[data-conversation-receipt-slot] svg').count(),1);
});

for(const mode of ['screen','floating'])test(`${mode}: changing event and unmount retire foreground listeners, stale remount has none`,async t=>{
 const page=await fixture(t,mode,390);await page.clock.install({time:new Date(now)});await list(page,mode);
 await page.evaluate(()=>{
   const tracked=new Map(),add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window),docAdd=document.addEventListener.bind(document),docRemove=document.removeEventListener.bind(document);
   window.harness.presenceListeners=tracked;
   const remember=(type,listener)=>{const set=tracked.get(type)||new Set();set.add(listener);tracked.set(type,set);};
   window.addEventListener=(type,listener,...args)=>{if(['focus','pageshow'].includes(type))remember(type,listener);add(type,listener,...args);};
   window.removeEventListener=(type,listener,...args)=>{tracked.get(type)?.delete(listener);remove(type,listener,...args);};
   document.addEventListener=(type,listener,...args)=>{if(type==='visibilitychange')remember(type,listener);docAdd(type,listener,...args);};
   document.removeEventListener=(type,listener,...args)=>{tracked.get(type)?.delete(listener);docRemove(type,listener,...args);};
 });
 // List focus restoration also registers focus/visibility listeners. Isolate
 // subscriptions spanning all three lifecycle events rather than counting
 // unrelated app listeners, while still requiring their actual removal.
 const subscriptions=()=>page.evaluate(()=>{const m=window.harness.presenceListeners;return[...(m.get('pageshow')||[])].filter(fn=>m.get('focus')?.has(fn)&&m.get('visibilitychange')?.has(fn)).length;});
 await presence(page,'composing',stamp(0));await expect(preview(page)).toContainText('digitando...');assert.equal(await subscriptions(),1);
 await presence(page,'recording',stamp(0));await expect(preview(page)).toContainText('Gravando áudio...');assert.equal(await subscriptions(),1,'one active subscription after replacing an event');
 await page.evaluate(()=>window.harness.unmount());assert.equal(await subscriptions(),0,'unmount cancels the active foreground subscription');
 await page.clock.runFor(60000);await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.harness.render();});
 if(mode==='floating')await page.evaluate(()=>window.harness.ctx.openChat());
 await expect(preview(page)).toContainText('Mensagem sintética de teste');assert.equal(await subscriptions(),0,'stale remount installs no timer listeners');
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`screen ${width} ${theme}: header timestamp expires, focus return catches suspended clock`,async t=>{
 const page=await fixture(t,'screen',width,theme);await page.clock.install({time:new Date(now)});
 await presence(page,'recording',stamp(-14000));
 const header=page.locator('header[aria-label="Cabeçalho da conversa"]');
 await expect(header.getByRole('status')).toHaveText('gravando áudio...');
 await page.clock.setSystemTime(new Date(now+2000));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(header.getByRole('status')).toHaveCount(0);
 await presence(page,'composing',stamp(2000));await expect(header.getByRole('status')).toHaveText('digitando...');
 await page.clock.runFor(15001);await expect(header.getByRole('status')).toHaveCount(0);
 await save(page,`screen-${width}-${theme}-header`,{height:await header.evaluate(n=>n.getBoundingClientRect().height)});
});

for(const theme of ['light','dark'])test(`desktop ${theme}: online dot uses the same bounded timestamp policy`,async t=>{
 const page=await fixture(t,'screen',1440,theme);await page.clock.install({time:new Date(now)});
 await page.getByRole('button',{name:'Recolher dados do contato',exact:true}).click();
 const online=page.getByLabel('Contato online',{exact:true});
 await presence(page,'available',null);await expect(online).toHaveCount(0);
 await presence(page,'available',stamp(0));await expect(online).toBeVisible();
 await page.clock.runFor(15001);await expect(online).toHaveCount(0);
});

for(const width of [320,390])for(const theme of ['light','dark'])test(`mobile ${width} ${theme}: name has room with actual shell insets and all actions remain reachable`,async t=>{
 const page=await fixture(t,'screen',width,theme);
 await page.evaluate(()=>{document.querySelector('[data-synthetic-app-shell]').style.paddingInline='20px';});
 const header=page.locator('header[aria-label="Cabeçalho da conversa"]'),name=header.locator('[data-conversation-identity] p').first();
 const data=await name.evaluate(n=>({width:n.getBoundingClientRect().width,size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight,text:n.textContent}));
 await save(page,`screen-${width}-${theme}-compact-header`,data);
 assert.ok(data.width>=56,`contact name retains at least a readable first name: ${JSON.stringify(data)}`);assert.equal(data.size,'13px');assert.equal(data.weight,'300');
 const search=header.getByRole('button',{name:'Pesquisar nesta conversa',exact:true}),details=header.getByRole('button',{name:'Mostrar dados do contato',exact:true});
 for(const button of [search,details]){const box=await button.boundingBox();assert.equal(box.height,44);await button.click({trial:true});}
 const link=header.getByRole('link',{name:'Ver lead',exact:true});
 if(width===320){await expect(link).toHaveCount(0);await header.getByRole('button',{name:'Mais ações da conversa',exact:true}).click();const item=page.getByRole('menuitem',{name:'Ver lead',exact:true});await expect(item).toBeVisible();assert.match(await item.getAttribute('href'),/lead=lead-a$/);await page.keyboard.press('Escape');}
 else await expect(link).toBeVisible();
 await search.click();await expect(page.getByRole('textbox',{name:'Buscar mensagem nesta conversa',exact:true})).toBeFocused();await page.keyboard.press('Escape');
 await details.click();await expect(page.getByRole('dialog',{name:'Dados do contato',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>['send','archive','delete','link'].includes(r.kind)).length),0);
});

for(const theme of ['light','dark'])test(`mobile ${theme}: compact read-only menu preserves lead navigation and resize never leaves an empty menu`,async t=>{
 const page=await fixture(t,'screen',320,theme);
 await page.evaluate(()=>{const h=window.harness;h.permissions=['whatsapp_view'];h.sessions=h.sessions.map(s=>({...s,can_send:false}));h.render();});
 const header=page.locator('header[aria-label="Cabeçalho da conversa"]'),menu=header.getByRole('button',{name:'Mais ações da conversa',exact:true});
 await expect(menu).toBeEnabled();await menu.click();await expect(page.getByRole('menuitem',{name:'Ver lead',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem',{name:/Arquivar|Remover|Mudar vínculo/})).toHaveCount(0);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:820});await expect(header.getByRole('link',{name:'Ver lead',exact:true})).toBeVisible();await expect(menu).toBeDisabled();
 assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>['send','archive','delete','link'].includes(r.kind)).length),0);
});
