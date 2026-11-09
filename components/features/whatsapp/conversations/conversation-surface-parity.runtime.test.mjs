import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {expect} from '@playwright/test';

// Actual Screen, headers, messages, composer, floating chat and CSS. Auth,
// transport, microphone and the surrounding app shell remain closed fixtures.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'vimob-conversation-surfaces-'));
const proof=process.env.WHATSAPP_SURFACE_PARITY_PROOF_DIR;
const original=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=original.indexOf("\nfor (const mode of ['screen', 'floating'])");
assert.ok(boundary>0);
let support=original.slice(0,boundary)
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`);
await writeFile(join(directory,'support.mjs'),`${support}\nexport {fixture,row,noOverflow};`);
const {fixture,row,noOverflow}=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-conversation-surfaces-/);await rm(target,{recursive:true,force:true});});

async function save(page,name,values){
 if(!proof)return;
 await mkdir(proof,{recursive:true});
 await writeFile(join(proof,name+'.json'),JSON.stringify(values,null,2));
 await page.screenshot({path:join(proof,name+'.png'),fullPage:true});
}
async function surfaceStyle(page){
 return page.getByRole('log').evaluate(log=>{
   const viewport=log.closest('[data-radix-scroll-area-viewport]');
   const surface=viewport.parentElement.parentElement;
   const reference=document.createElement('div');
   reference.style.backgroundColor='var(--app-surface-soft)';surface.append(reference);
   const actual=getComputedStyle(surface).backgroundColor,expected=getComputedStyle(reference).backgroundColor;
   reference.remove();
   const box=surface.getBoundingClientRect();
   return{actual,expected,width:box.width,height:box.height,overflow:surface.scrollWidth>surface.clientWidth};
 });
}
async function frameWithBottomNavigation(page,height){
 await page.setViewportSize({width:page.viewportSize().width,height});
 await page.evaluate(()=>{
   // Geometry from AppLayout/AppHeader: main px-5/pt-2, h-16 app header,
   // and 65px reserved for navigation. Their behavior remains a fixture.
   const shell=document.querySelector('[data-synthetic-app-shell]');
   shell.style.paddingInline='20px';
   shell.style.paddingTop='72px';
   shell.style.paddingBottom='65px';
   const nav=document.createElement('nav');nav.dataset.navigationFixture='true';
   Object.assign(nav.style,{position:'fixed',left:'0',right:'0',bottom:'0',height:'64px'});
   document.body.append(nav);
 });
}
function silentWav(){const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);wav.fill(128,44);return'data:audio/wav;base64,'+wav.toString('base64');}

for(const width of [320,390])for(const theme of ['light','dark'])for(const height of [568,820]){
 test(`mobile ${width}x${height} ${theme}: rounded card and header share desktop chat surface`,async t=>{
   const page=await fixture(t,'screen',width,theme,[row(1,{from_me:false,status:'received',content:'Mensagem recebida sintética.'}),
     row(2,{from_me:true,status:'read',content:null,message_type:'audio',media_url:silentWav(),media_status:'ready',media_mime_type:'audio/wav'})]);
   await frameWithBottomNavigation(page,height);
   const header=page.getByRole('banner',{name:'Cabeçalho da conversa'});
   const mobile=page.locator('[data-conversations-mobile-surface]');
   const card=await mobile.evaluate(node=>{
     const css=getComputedStyle(node),reference=document.createElement('div');
     reference.className='app-card';node.append(reference);
     const background=getComputedStyle(reference).backgroundColor;reference.remove();
     return{radius:css.borderRadius,overflow:css.overflow,background:css.backgroundColor,expectedBackground:background};
   });
   const headerStyle=await header.evaluate(node=>({left:getComputedStyle(node).borderTopLeftRadius,right:getComputedStyle(node).borderTopRightRadius,height:node.getBoundingClientRect().height}));
   const messages=await surfaceStyle(page);
   await save(page,`screen-${width}-${height}-${theme}`,{card,headerStyle,messages});
   assert.equal(card.background,card.expectedBackground,'mobile uses the same app-card surface as desktop');
   assert.equal(card.radius,'8px');assert.equal(card.overflow,'hidden');
   assert.equal(headerStyle.left,'8px');assert.equal(headerStyle.right,'8px');assert.equal(headerStyle.height,56);
   assert.equal(messages.actual,messages.expected,'grey covers the whole message viewport, including short conversations');
   assert.ok(messages.height>150);assert.equal(messages.overflow,false);
   assert.equal(await mobile.evaluate(n=>n.getBoundingClientRect().width),width-40,'uses actual main horizontal inset');
   const waveform=page.getByRole('slider',{name:'Posição do áudio',exact:true});
   const bars=await waveform.evaluate(n=>[...n.children].map(b=>b.getBoundingClientRect().width));
   assert.equal(bars.length,28);assert.ok(bars.every(w=>w>=.5),'audio remains visible inside the narrower actual app inset');
   await noOverflow(page);
   const composer=page.getByRole('textbox',{name:'Digite sua mensagem'});
   const composerBox=await composer.boundingBox();
   const navBox=await page.locator('[data-navigation-fixture]').boundingBox();
   assert.ok(composerBox.y+composerBox.height<=navBox.y+1,'composer remains above the mobile navigation');
   await page.getByRole('button',{name:'Voltar para a lista de conversas',exact:true}).click();
   await expect(page.getByRole('log')).toHaveCount(0);
   assert.equal(await mobile.evaluate(n=>getComputedStyle(n).borderRadius),'8px');
   await page.getByText('Marina Sintética',{exact:true}).first().click();
   assert.equal((await surfaceStyle(page)).actual,messages.expected);
   assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
 });
}

for(const theme of ['light','dark'])test(`desktop ${theme}: grey surface remains under messages and empty/loading/error states`,async t=>{
 const page=await fixture(t,'screen',1440,theme);
 for(const state of ['ready','empty','loading','error']){
   if(state!=='ready')await page.evaluate(state=>{const h=window.harness;h.messages={...h.messages,messages:[],isLoading:state==='loading',isFetching:false,isError:state==='error'};h.render();},state);
   const style=await surfaceStyle(page);assert.equal(style.actual,style.expected);assert.equal(style.overflow,false);
 }
 await save(page,`desktop-${theme}`,await surfaceStyle(page));
});

test('screen keeps loaded messages and an established empty state during background refresh', async t => {
  const page = await fixture(t, 'screen', 1440, 'light', [row(1, { from_me: false, content: 'Mensagem já carregada' })]);
  const log = page.getByRole('log');
  await expect(log.getByText('Mensagem já carregada')).toBeVisible();
  await page.evaluate(() => {
    const h = window.harness;
    h.messages = { ...h.messages, isFetching: true };
    h.render();
  });
  await expect(log.getByText('Mensagem já carregada')).toBeVisible();
  await expect(log.getByText('Carregando mensagens...')).toHaveCount(0);
  await page.evaluate(() => {
    const h = window.harness;
    h.messages = { ...h.messages, messages: [], isLoading: false, isFetching: true };
    h.render();
  });
  await expect(log.getByText('Nenhuma mensagem')).toBeVisible();
  await expect(log.getByText('Carregando mensagens...')).toHaveCount(0);
});

for(const theme of ['light','dark'])test(`floating mobile ${theme}: existing fullscreen geometry and close remain intact`,async t=>{
 const page=await fixture(t,'floating',390,theme);
 await noOverflow(page);
 const close=page.getByRole('button',{name:'Fechar chat do WhatsApp',exact:true});await expect(close).toBeVisible();
 await close.click();await expect(close).toHaveCount(0);
 assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});
