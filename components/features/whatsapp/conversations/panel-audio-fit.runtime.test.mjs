import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real Screen/Floating, lead pane, Bubble/Audio, Radix and CSS. Only auth/DTOs,
// API hooks, peripheral dialogs and microphone are closed isolated fixtures.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'vimob-panel-audio-fit-'));
const proof=process.env.WHATSAPP_FIT_PROOF_DIR;
const phase=process.env.WHATSAPP_FIT_PHASE||'current';
const input=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=input.indexOf('const id = n =>');assert.ok(boundary>0);
let supportSource=input.slice(0,boundary)
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`);
const changes=`bootstrap=bootstrap
 .replace("export const useOrganizationModules=()=>({hasModule:k=>k==='whatsapp',isLoading:false});","export const useOrganizationModules=()=>({hasModule:k=>['whatsapp','agenda'].includes(k),isLoading:false});")
 .replace('export const useLeadAttachments=()=>h().emptyQuery;','export const useLeadAttachments=()=>h().attachmentsQuery||h().emptyQuery;')
 .replace('export const useScheduleEvents=()=>h().emptyQuery;','export const useScheduleEvents=()=>h().scheduleQuery||h().emptyQuery;')
 .replace("data:{id,name:'Marina Sintética',phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{},...h().leadDetail},isLoading:false,isError:false,refetch:()=>{}})","data:h().leadState?undefined:{id,name:'Marina Sintética',phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{},...h().leadDetail},isLoading:h().leadState==='loading',isError:h().leadState==='error',refetch:()=>{}})");
assert.ok(bootstrap.includes("isLoading:h().leadState==='loading'"));`;
supportSource=supportSource.replace("await writeFile(join(directory, 'bootstrap.mjs'),",`${changes}\nawait writeFile(join(directory, 'bootstrap.mjs'),`);
await writeFile(join(directory,'support.mjs'),`${supportSource}\nexport {harness,conversation,css};`);
const support=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-panel-audio-fit-/);await rm(target,{recursive:true,force:true});});
function wavURL(){const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);wav.fill(128,44);return'data:audio/wav;base64,'+wav.toString('base64');}
const row=fromMe=>({id:'00000000-0000-4000-8000-000000000001',message_id:'synthetic-audio',conversation_id:'chat-a',session_id:'session-a',lead_id:'lead-a',
 from_me:fromMe,status:fromMe?'read':'received',can_quote:true,can_react:true,sent_at:'2026-10-14T10:00:00Z',content:null,message_type:'audio',media_url:wavURL(),media_status:'ready',media_mime_type:'audio/wav',metadata:{}});
async function fixture(t,mode,width,theme='light',messages=[]){
 const page=await support.harness(t,mode,{hasTouch:width<768});page.setDefaultTimeout(6000);await page.setViewportSize({width,height:900});
 await page.addStyleTag({content:`${support.css}\nhtml,body,#root{height:100%;margin:0}#root>output{display:none}`});
 const contact={...support.conversation('chat-a','lead-a'),contact_name:'Marina Sintética',lead:{id:'lead-a',name:'Marina Sintética',tags:[]}};
 await page.evaluate(({width,theme,contact,messages})=>{document.documentElement.className=theme;const h=window.harness;h.mobile=width<768;h.auth.organization={id:'org-a'};
  h.permissions.push('schedule_view','schedule_manage');h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[contact];h.messages={...h.messages,messages};h.render();if(h.mode==='floating')h.ctx.openConversation(contact);
 },{width,theme,contact,messages});
 if(mode==='screen')await page.getByText('Marina Sintética',{exact:true}).first().click();
 return page;
}
async function record(page,name,data){if(!proof)return;await mkdir(proof,{recursive:true});await writeFile(join(proof,`${name}-${phase}.json`),JSON.stringify(data,null,2));await page.screenshot({path:join(proof,`${name}-${phase}.png`),fullPage:true});}
async function pane(page,width){if(width<768)await page.getByRole('button',{name:'Mostrar dados do contato',exact:true}).click();const panel=page.getByLabel('Dados do contato',{exact:true});await expect(panel).toBeVisible();return panel;}
async function panelGeometry(panel){return panel.evaluate(n=>{const rect=n.getBoundingClientRect();return{width:rect.width,left:rect.left,right:rect.right,viewports:[...n.querySelectorAll('[data-radix-scroll-area-viewport]')].map(v=>({width:v.clientWidth,scroll:v.scrollWidth})),
 actions:[...n.querySelectorAll('button,textarea')].filter(b=>b.getBoundingClientRect().width).map(b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return{label:b.getAttribute('aria-label')||b.textContent.trim(),left:r.left,right:r.right,width:r.width,height:r.height,font:s.fontSize,weight:s.fontWeight};})};});}
function panelFits(g){for(const v of g.viewports)assert.ok(v.scroll<=v.width+1,JSON.stringify(g));for(const a of g.actions)assert.ok(a.left>=g.left-.5&&a.right<=g.right+.5,JSON.stringify(a));}
for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`lead pane ${width} ${theme} keeps long contact values documents agenda and actions inside`,async t=>{
 const page=await fixture(t,'screen',width,theme);await page.evaluate(()=>{const h=window.harness;h.leadDetail={name:'Nome'+('SemEspaco'.repeat(20)),email:'atendimento.comercial.equipe@empreendimentos.example',tags:[]};
  h.attachmentsQuery={...h.emptyQuery,data:[{id:'doc-a',file_name:'https://document.example/'+('longpath'.repeat(30)),file_url:'https://document.example/synthetic.pdf'}]};h.render();});
 const panel=await pane(page,width),g=await panelGeometry(panel);await record(page,`pane-${width}-${theme}`,g);panelFits(g);
 const title=panel.getByRole('heading',{name:'Documentação',exact:true});await title.scrollIntoViewIfNeeded();await expect(title).toHaveCSS('font-size','11px');await expect(title).toHaveCSS('font-weight','400');
 await expect(panel.getByRole('button',{name:'Registrar feedback',exact:true})).toBeDisabled();
 await panel.getByRole('textbox',{name:'Feedback do atendimento do lead'}).fill('Verificação sintética de acesso, sem salvar');
 for(const name of ['Anexar','Agendar','Registrar feedback']){const action=panel.getByRole('button',{name,exact:true});await action.scrollIntoViewIfNeeded();await expect(action).toBeVisible();await action.click({trial:true});}
 await expect(panel.getByRole('button',{name:/^Abrir documento/})).toHaveCount(1);await expect(panel.getByRole('textbox',{name:'Feedback do atendimento do lead'})).toHaveCSS('height','64px');
 // The generic value cell also contains imported URL-shaped strings; it must
 // contain them even when a legacy DTO supplied that field without validation.
 await page.evaluate(()=>{window.harness.leadDetail.email='https://example.test/'+('token'.repeat(80));window.harness.render();});panelFits(await panelGeometry(panel));
 assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth),false);
});
for(const state of ['loading','error'])for(const width of [320,390,1440])test(`lead pane ${state} keeps its close action reachable at${width}`,async t=>{
 const page=await fixture(t,'screen',width);await page.evaluate(state=>{window.harness.leadState=state;window.harness.render();},state);const panel=await pane(page,width);
 const close=page.getByRole('button',{name:width<768?'Fechar dados do contato':'Recolher dados do contato',exact:true});await expect(close).toBeVisible();await close.click({trial:true});
 const box=await close.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);assert.equal(await panel.evaluate(n=>n.scrollWidth>n.clientWidth),false);
});
async function audioGeometry(page){return page.getByRole('slider',{name:'Posição do áudio',exact:true}).evaluate(n=>{const rect=x=>{const r=x.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};},slider=rect(n),player=n.parentElement.parentElement.parentElement;
 return{slider,bars:[...n.children].map(rect),play:rect(player.querySelector('button[aria-label="Reproduzir áudio"]')),avatar:rect(player.querySelector('button[aria-label="Avatar do audio"],button[aria-label^="Alterar velocidade do audio"]')),player:rect(player),font:getComputedStyle(n).fontSize,
 times:[...player.querySelectorAll('[data-message-timestamp-position]')].map(rect)};});}
for(const mode of ['screen','floating'])for(const width of [320,390,1440])for(const fromMe of [false,true])test(`adaptive waveform ${mode} ${width} ${fromMe?'sent':'received'} keeps every bar visible and original player geometry`,async t=>{
 const page=await fixture(t,mode,width,'light',[row(fromMe)]);const slider=page.getByRole('slider',{name:'Posição do áudio',exact:true});await expect(slider).toBeVisible();
 const g=await audioGeometry(page);await record(page,`audio-${mode}-${width}-${fromMe?'sent':'received'}`,g);
 assert.equal(g.bars.length,28);assert.ok(g.bars.every(b=>b.width>=.5&&b.x>=g.slider.x-.5&&b.x+b.width<=g.slider.x+g.slider.width+.5),JSON.stringify(g));
 assert.equal(g.play.width,36);assert.equal(g.play.height,36);for(const time of g.times)assert.ok(time.x>=g.player.x-.5&&time.x+time.width<=g.player.x+g.player.width+.5);
 const before=process.env.WHATSAPP_FIT_BASELINE_DIR;if(before){const prior=JSON.parse(await readFile(join(before,`audio-${mode}-${width}-${fromMe?'sent':'received'}-red.json`),'utf8'));
  assert.deepEqual({player:g.player,play:g.play,avatar:g.avatar,slider:g.slider,times:g.times},{player:prior.player,play:prior.play,avatar:prior.avatar,slider:prior.slider,times:prior.times});
  if(width===1440)assert.deepEqual(g.bars,prior.bars,'desktop bar geometry stays exactly as approved');}
});
