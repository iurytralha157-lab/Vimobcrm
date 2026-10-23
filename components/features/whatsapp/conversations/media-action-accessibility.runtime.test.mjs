import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Actual Screen/Floating -> Bubble/Audio/Media, Radix and Tailwind CSS.
// Authentication, APIs, microphone and AppLayout are closed synthetic boundaries.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url),directory=await mkdtemp(join(tmpdir(),'vimob-media-action-a11y-'));
const proof=process.env.WHATSAPP_MEDIA_ACTION_PROOF_DIR;
let source=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
source=source.slice(0,source.indexOf('const id = n =>'))
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`);
await writeFile(join(directory,'support.mjs'),`${source}\nexport {harness,conversation,css};`);
const support=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^vimob-media-action-a11y-/);await rm(directory,{recursive:true,force:true});});
function wavURL(){const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);wav.fill(128,44);return'data:audio/wav;base64,'+wav.toString('base64');}
const row=(type,fromMe=true)=>({id:'00000000-0000-4000-8000-000000000001',message_id:'synthetic-media',conversation_id:'chat-a',session_id:'session-a',lead_id:'lead-a',from_me:fromMe,status:fromMe?'read':'received',can_quote:true,can_react:true,sent_at:'2026-10-14T10:00:00Z',content:null,message_type:type,media_url:`https://media.example.test/synthetic.${type==='audio'?'wav':type==='document'?'pdf':'mp4'}`,media_status:'ready',media_mime_type:type==='audio'?'audio/wav':type==='document'?'application/pdf':'video/mp4',media_filename:type==='document'?'Documentação sintética.pdf':null,metadata:{}});
async function fixture(t,mode,width,theme='light',type='audio',fromMe=true){
 const page=await support.harness(t,mode,{hasTouch:width<768});page.setDefaultTimeout(6000);await page.setViewportSize({width,height:900});
 await page.route('https://media.example.test/**',route=>route.fulfill({status:200,contentType:new URL(route.request().url()).pathname.endsWith('.wav')?'audio/wav':'application/octet-stream',body:Buffer.from(wavURL().split(',')[1],'base64')}));
 await page.addStyleTag({content:`${support.css}\nhtml,body,#root{height:100%;margin:0}#root>output{display:none}`});
 const contact={...support.conversation('chat-a','lead-a'),contact_name:'Marina Sintética',lead:{id:'lead-a',name:'Marina Sintética',tags:[]}};
 await page.evaluate(({width,theme,contact,message})=>{document.documentElement.className=theme;const h=window.harness;h.mobile=width<768;h.auth.organization={id:'org-a'};h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[contact];h.messages={...h.messages,messages:[message]};h.render();if(h.mode==='floating')h.ctx.openConversation(contact);},{width,theme,contact,message:row(type,fromMe)});
 if(mode==='screen')await page.getByText('Marina Sintética',{exact:true}).first().click();return page;
}
async function record(page,name,data){if(!proof)return;await mkdir(proof,{recursive:true});await writeFile(join(proof,`${name}.json`),JSON.stringify(data,null,2));await page.screenshot({path:join(proof,`${name}.png`),fullPage:true});}
async function noOverflow(page){for(const n of await page.locator('[data-whatsapp-message-log],[data-message-bubble]').all()){const g=await n.evaluate(n=>({width:n.clientWidth,scroll:n.scrollWidth,html:n.outerHTML.slice(0,300)}));assert.ok(g.scroll<=g.width+1,JSON.stringify(g));}}
for(const mode of ['screen','floating'])for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`media attachment colors and coarse targets ${mode} ${width} ${theme}`,async t=>{
 const page=await fixture(t,mode,width,theme);const attach=page.getByRole('button',{name:'Anexar áudio à documentação do lead',exact:true});await expect(attach).toBeVisible();await attach.hover();
 await expect(attach).toHaveCSS('color','rgb(255, 255, 255)');if(width>=768)await expect(attach).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 const audio=await attach.evaluate(n=>{const s=getComputedStyle(n),pseudo=getComputedStyle(n,'::before');return{color:s.color,background:s.backgroundColor,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,pseudo:{position:pseudo.position,top:pseudo.top,left:pseudo.left,right:pseudo.right,bottom:pseudo.bottom}};});
 assert.equal(audio.color,'rgb(255, 255, 255)');if(width>=768)assert.notEqual(audio.background,'rgba(0, 0, 0, 0)');
 const bars=await page.getByRole('slider',{name:'Posição do áudio'}).evaluate(n=>[...n.children].map(b=>b.getBoundingClientRect().width));assert.equal(bars.length,28);assert.ok(bars.every(w=>w>=.5));
 if(width<768){assert.equal(audio.pseudo.position,'absolute');assert.equal(Number.parseFloat(audio.pseudo.top),4);assert.equal(Number.parseFloat(audio.pseudo.bottom),-12);assert.ok(Number.parseFloat(audio.pseudo.left)<=-4);
  const [target,slider]=await Promise.all([attach.boundingBox(),page.getByRole('slider',{name:'Posição do áudio'}).boundingBox()]);assert.ok(target.y+4>=slider.y+slider.height-1,'enlarged attachment area does not cover the waveform');
  await page.touchscreen.tap(target.x-2,target.y+target.height+4);await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 }await noOverflow(page);
 await page.evaluate(message=>{window.harness.messages={...window.harness.messages,messages:[message]};window.harness.render();},row('document'));
 const download=page.getByRole('button',{name:'Baixar documento',exact:true}),docAttach=page.getByRole('button',{name:'Anexar documento à documentação do lead',exact:true});
 const controls=[];for(const control of [download,docAttach]){await control.hover();await expect(control).toHaveCSS('color','rgb(255, 255, 255)');const geometry=await control.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,width:r.width,height:r.height,color:s.color,background:s.backgroundColor};});controls.push(geometry);assert.equal(geometry.color,'rgb(255, 255, 255)');if(width<768)assert.ok(geometry.width>=32&&geometry.height>=44,JSON.stringify(geometry));}
 assert.ok(controls[0].x+controls[0].width<=controls[1].x+1);await noOverflow(page);await docAttach.click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);await record(page,`${mode}-${width}-${theme}`,{audio,controls,bars});
});
for(const mode of ['screen','floating'])test(`native media errors keep compact retry and download actions ${mode}`,async t=>{
 const page=await fixture(t,mode,320);await page.evaluate(()=>{HTMLMediaElement.prototype.play=async function(){throw new Error('Synthetic decode failure');};});await page.getByRole('button',{name:'Reproduzir áudio',exact:true}).click();
 for(const name of ['Tentar novamente','Baixar áudio']){const action=page.getByRole('button',{name,exact:true});await expect(action).toBeVisible();await expect(action).toHaveCSS('font-size','12px');await expect(action).toHaveCSS('font-weight','300');}await noOverflow(page);
 await page.evaluate(message=>{window.harness.messages={...window.harness.messages,messages:[message]};window.harness.render();},row('video'));await page.locator('video').dispatchEvent('error');
 for(const name of ['Tentar novamente','Baixar']){const action=page.getByRole('button',{name,exact:true});await expect(action).toBeVisible();await expect(action).toHaveCSS('font-size','12px');await expect(action).toHaveCSS('font-weight','300');}await noOverflow(page);
});
for(const mode of ['screen','floating'])for(const width of [320,390])test(`expanded touch attachment only activates its own consecutive audio ${mode} ${width}`,async t=>{
 const page=await fixture(t,mode,width);await page.evaluate(first=>{const second={...first,id:'00000000-0000-4000-8000-000000000002',message_id:'synthetic-media-2',media_url:first.media_url+'?row=2',from_me:false,status:'received',sent_at:'2026-10-14T10:01:00Z'};const h=window.harness;h.syntheticAttachments=[];h.mutation={...h.mutation,mutateAsync:async input=>{h.syntheticAttachments.push(input);return{};}};h.messages={...h.messages,messages:[first,second]};h.render();},row('audio'));
 const attachments=page.getByRole('button',{name:'Anexar áudio à documentação do lead',exact:true});await expect(attachments).toHaveCount(2);
 for(let i=0;i<2;i++){
  const target=attachments.nth(i);await target.scrollIntoViewIfNeeded();const geometry=await target.evaluate(n=>{const r=n.getBoundingClientRect(),pseudo=getComputedStyle(n,'::before'),bubble=n.closest('[data-message-bubble]'),row=n.closest('[data-message-id]'),slider=bubble.querySelector('[role=slider]'),play=bubble.querySelector('button[aria-label="Reproduzir áudio"]'),receipt=n.parentElement.querySelector('[role=img]');const rect=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom};};return{button:rect(n),area:{x:r.x+parseFloat(pseudo.left),right:r.right-parseFloat(pseudo.right),y:r.y+parseFloat(pseudo.top),bottom:r.bottom-parseFloat(pseudo.bottom)},bubble:rect(bubble),row:rect(row),wave:rect(slider),play:rect(play),receipt:receipt?rect(receipt):null};});
  await record(page,`${mode}-${width}-consecutive-${i}`,geometry);assert.ok(geometry.area.y>=geometry.wave.bottom-1);assert.ok(geometry.area.bottom<=geometry.bubble.bottom+1,'extra touch padding stays inside its own bubble');
  assert.ok(geometry.area.right<=geometry.play.x||geometry.area.x>=geometry.play.right||geometry.area.bottom<=geometry.play.y||geometry.area.y>=geometry.play.bottom,'attachment and play touch targets do not overlap');
  if(geometry.receipt)assert.ok(geometry.area.right<=geometry.receipt.x||geometry.area.x>=geometry.receipt.right||geometry.area.bottom<=geometry.receipt.y||geometry.area.y>=geometry.receipt.bottom,'attachment and receipt do not overlap');
  const other=await page.locator('[data-message-bubble]').nth(1-i).boundingBox();assert.ok(geometry.area.bottom<=other.y||geometry.area.y>=other.y+other.height,'attachment stays clear of the adjacent message');
  await page.touchscreen.tap(geometry.area.x+2,geometry.button.bottom+4);await expect(page.getByRole('alertdialog')).toBeVisible();await page.getByRole('button',{name:'Anexar',exact:true}).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);assert.equal(await page.evaluate(index=>window.harness.syntheticAttachments[index]?.file_url,i),'https://media.example.test/synthetic.wav'+(i?'?row=2':''));
 }
 assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
});
