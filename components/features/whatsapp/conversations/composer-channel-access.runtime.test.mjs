import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Actual Screen/Floating, composer and MessageBox. The channel selector and
// auth/data/transports/recorder are closed fixtures, never connected services.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-composer-channel-access-'));
const proof = process.env.WHATSAPP_COMPOSER_ACCESS_PROOF_DIR;
const source = await readFile(join(repository, 'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf('async function confirmAttachments(page)');
assert.ok(boundary > 0);
let bootstrap = source.slice(0, boundary)
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {chromium}=playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository=${JSON.stringify(repository)};`)
  .replace("hasModule:k=>k==='whatsapp'", "hasModule:k=>k==='whatsapp'||(k==='campaigns'&&window.harness.metaEnabled!==false)")
  .replace("const hook = `const h=()=>window.harness;`;", "const hook = `const h=()=>window.harness;`;await mock('@/lib/local-read-only',`${hook} export const isLocalReadOnlyMode=()=>!!h().localReadOnly;`);")
  .replace("export const useMetaConversations=()=>h().emptyQuery;export const useMetaMessages=()=>h().emptyQuery;export const useSendMetaMessage=()=>h().mutation;", "export const useMetaConversations=()=>({...h().emptyQuery,data:h().metaConversations||[]});export const useMetaMessages=()=>({...h().emptyQuery,data:[]});export const useSendMetaMessage=()=>({mutateAsync:p=>h().request('meta-send',p),isPending:!!h().metaPending});")
  .replace('export const ConversationFilters=()=>null;', "export const ConversationFilters=p=>React.createElement('div',null,React.createElement('button',{onClick:()=>p.onChannelChange('meta-all')},'Canal Meta sintético'),React.createElement('button',{onClick:()=>p.onChannelChange('whatsapp-all')},'Canal WhatsApp sintético'));")
  .replace("export const AppLayout=({children})=>React.createElement('div',null,children);", "export const AppLayout=({children})=>React.createElement('div',{'data-app-shell-fixture':true,className:'app-shell',style:{height:'100dvh',padding:'72px 20px 65px'}},children);")
  .replace("await page.route('**/*',r=>r.abort());", "const external=[];await page.route('**/*',r=>{external.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(external,[],'no external requests'));");
assert.ok(bootstrap.includes('Canal Meta sintético'));
assert.ok(bootstrap.includes("h().request('meta-send',p)"));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {harness,conversation};`);
const { harness, conversation } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
let css;
before(async()=>{
  const globals=(await readFile(join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['components/features/whatsapp','components/features/chat','components/ui'].map(p=>`@source "${join(repository,p).replaceAll('\\','/')}";`).join('\n');
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(`${globals}\n${sources}`,{from:join(repository,'app/composer-channel-fixture.css')})).css;
},{timeout:300000});
after(async () => { const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-composer-channel-access-/);await rm(target,{recursive:true,force:true}); });

async function fixture(t, mode, width, { operate = true, meta = false, platform = 'instagram', original = true } = {}) {
  const page = await harness(t, mode); page.setDefaultTimeout(3000);
  await page.setViewportSize({ width, height: 820 });
  await page.addStyleTag({content:`${css}\nhtml,body,#root{height:100%;margin:0}#root>output{display:none}`});
  await page.evaluate(()=>document.documentElement.className='light');
  await page.evaluate(({width,operate,contact,platform,original}) => {
    const h=window.harness;h.mobile=width<768;h.permissions=['whatsapp_view',...(operate?['whatsapp_operate']:[])];
    h.auth.activeOrganization.organizationId=original?'org-a':'org-b';h.scope.organizationId=h.auth.activeOrganization.organizationId;
    h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[contact];
    h.metaConversations=[{id:'meta-a',organization_id:h.scope.organizationId,lead_id:null,external_id:'synthetic-page-contact',platform,
      contact_name:'Contato Meta Sintético',contact_picture:null,last_message:'Olá',last_message_at:'2026-10-14T12:00:00Z',unread_count:0,is_archived:false,created_at:'2026-10-14T12:00:00Z',updated_at:'2026-10-14T12:00:00Z'}];
    h.render();if(h.mode==='floating')h.ctx.openConversation(contact);
  }, {width,operate,contact:conversation('chat-a','lead-a'),platform,original});
  if(mode==='screen'){
    if(meta)await page.getByRole('button',{name:'Canal Meta sintético',exact:true}).click();
    await page.getByRole('button',{name:meta?'Abrir meta-a':'Abrir chat-a',exact:true}).click();
  }
  return page;
}
async function save(page,name){if(!proof)return;await mkdir(proof,{recursive:true});await page.screenshot({path:join(proof,name+'.png'),fullPage:true});}
const input = page => page.getByRole('textbox',{name:'Digite sua mensagem',exact:true});
async function noWrites(page){assert.equal(await page.evaluate(()=>harness.requests.filter(r=>['send','meta-send'].includes(r.kind)).length),0);}

for(const width of [320,390,1440])for(const platform of ['instagram','messenger'])test(`Meta ${platform} ${width}: authorized text composer does not depend on a WhatsApp session`,async t=>{
  const page=await fixture(t,'screen',width,{meta:true,platform});
  await expect(input(page)).toBeVisible();await expect(input(page)).toBeEnabled();
  assert.deepEqual(await input(page).evaluate(n=>({font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight})),{font:'12px',weight:'300'});
  const box=await input(page).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'Meta input stays in viewport');
  await page.evaluate(()=>{harness.sessions=[];harness.render();});
  await expect(input(page)).toBeEnabled();
  await expect(page.getByRole('button',{name:'Anexar arquivo',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Gravar áudio',exact:true})).toHaveCount(0);
  await input(page).fill('Resposta Meta sintética');await input(page).press('Enter');
  await page.waitForFunction(()=>harness.requests.some(r=>r.kind==='meta-send'));
  const requests=await page.evaluate(()=>harness.requests.filter(r=>['send','meta-send'].includes(r.kind)).map(r=>({kind:r.kind,params:r.params})));
  assert.equal(requests.length,1);assert.equal(requests[0].kind,'meta-send');
  assert.equal(requests[0].params.text,'Resposta Meta sintética');assert.ok(requests[0].params.idempotencyKey);
  await page.evaluate(()=>{const request=harness.requests.find(r=>r.kind==='meta-send');request.resolve({});});
  await expect(input(page)).toHaveValue('');await save(page,`meta-${platform}-${width}`);
});
for(const mode of ['screen','floating'])for(const width of [320,390,1440])test(`${mode} ${width}: view-only WhatsApp explains access without inviting typing`,async t=>{
  const page=await fixture(t,mode,width,{operate:false});
  if(mode==='screen'){
    await expect(input(page)).toHaveCount(0);
    await expect(page.locator('footer[role=status]')).toContainText('Somente leitura');
    await expect(page.locator('footer[role=status]')).not.toContainText('Digite sua mensagem');
  }else await expect(input(page)).toHaveAttribute('placeholder','Somente leitura');
  await noWrites(page);await save(page,`readonly-${mode}-${width}`);
});
for(const width of [320,1440])test(`Meta ${width}: view-only, module removal and foreign organization cannot send`,async t=>{
  const page=await fixture(t,'screen',width,{meta:true});
  await page.evaluate(()=>{harness.metaEnabled=false;harness.render();});
  await expect(input(page)).toHaveCount(0);await expect(page.locator('footer[role=status]')).toContainText('Somente leitura');
  await page.evaluate(()=>{harness.metaEnabled=true;harness.permissions=['whatsapp_view'];harness.render();});
  await expect(input(page)).toHaveCount(0);
  await page.evaluate(()=>{harness.permissions.push('whatsapp_operate');harness.auth.profile.organization_id='org-foreign';harness.render();});
  await expect(input(page)).toHaveCount(0);await expect(page.locator('footer[role=status]')).toContainText('organização original');await noWrites(page);
});
test('Meta pending send cannot dispatch another gesture and a late failure does not fill another channel draft',async t=>{
  const page=await fixture(t,'screen',390,{meta:true});await expect(input(page)).toBeEnabled();
  await input(page).fill('Resposta pendente');await input(page).press('Enter');
  await page.waitForFunction(()=>harness.requests.some(r=>r.kind==='meta-send'));
  await page.evaluate(()=>{harness.metaPending=true;harness.render();});await expect(input(page)).toBeDisabled();
  await page.getByRole('button',{name:'Voltar para a lista de conversas',exact:true}).click();
  await page.getByRole('button',{name:'Canal WhatsApp sintético',exact:true}).click();
  await page.getByRole('button',{name:'Abrir chat-a',exact:true}).click();await expect(input(page)).toBeEnabled();
  await input(page).fill('Rascunho WhatsApp atual');
  await page.evaluate(()=>harness.requests.find(r=>r.kind==='meta-send').reject(new Error('Synthetic failure')));
  await expect(input(page)).toHaveValue('Rascunho WhatsApp atual');
  assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='meta-send').length),1);
  assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='send').length),0);
});

test('Meta local read-only preview cannot expose a writable composer',async t=>{
  const page=await fixture(t,'screen',390,{meta:true});await expect(input(page)).toBeEnabled();
  await page.evaluate(()=>{harness.localReadOnly=true;harness.render();});
  await expect(input(page)).toHaveCount(0);await expect(page.locator('footer[role=status]')).toContainText('somente leitura');await noWrites(page);
  await page.evaluate(()=>{harness.localReadOnly=false;harness.render();});await expect(input(page)).toBeEnabled();
});

for(const width of [320,1440])test(`WhatsApp ${width}: default audio and attachment actions remain available and text uses the WhatsApp transport`,async t=>{
  const page=await fixture(t,'screen',width);await expect(input(page)).toBeEnabled();
  await expect(page.getByRole('button',{name:'Anexar arquivo',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Gravar áudio',exact:true})).toBeVisible();
  await input(page).fill('Mensagem WhatsApp sintética');await input(page).press('Enter');
  await page.waitForFunction(()=>harness.requests.some(r=>r.kind==='send'));
  const requests=await page.evaluate(()=>harness.requests.filter(r=>['send','meta-send'].includes(r.kind)).map(r=>({kind:r.kind,params:r.params})));
  assert.equal(requests.length,1);assert.equal(requests[0].kind,'send');assert.equal(requests[0].params.text,'Mensagem WhatsApp sintética');assert.equal(requests[0].params.conversation.id,'chat-a');
});
