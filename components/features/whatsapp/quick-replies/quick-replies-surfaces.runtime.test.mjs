import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real Screen/Floating -> ScopedMessageBox -> replies -> textarea, Radix/CSS.
// Auth, DTOs, CRUD transport and microphone reuse closed isolated boundaries.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'vimob-quick-reply-surfaces-'));
const proof=process.env.WHATSAPP_QUICK_REPLIES_UI_PROOF_DIR;
const integrated=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=integrated.indexOf('const id = n =>');assert.ok(boundary>0);
let supportSource=integrated.slice(0,boundary)
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`);
const transport=`const h=()=>window.harness;
export const useWhatsAppQuickReplyScope=()=>({identity:JSON.stringify(h().scope),enabled:true});
export const useWhatsAppQuickReplies=enabled=>({data:enabled?h().savedReplies||[]:undefined,isPending:false,isError:false,refetch:async()=>{}});
function mutation(kind){return{isPending:false,mutateAsync:async input=>{const store=h();store.savedOperations.push([kind,input]);
 const item={...input,id:input.id||'saved-new',created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z'};
 if(kind==='create')store.savedReplies=[...(store.savedReplies||[]),item];if(kind==='update')store.savedReplies=store.savedReplies.map(old=>old.id===input.id?item:old);
 if(kind==='delete')store.savedReplies=store.savedReplies.filter(old=>old.id!==input);store.render();return item;}};}
export const useCreateWhatsAppQuickReply=()=>mutation('create');export const useUpdateWhatsAppQuickReply=()=>mutation('update');export const useDeleteWhatsAppQuickReply=()=>mutation('delete');`;
const extra=`bootstrap=bootstrap.replace("  const ts=require('typescript');",${JSON.stringify(`  await mock('@/hooks/whatsapp/use-whatsapp-quick-replies',${JSON.stringify(transport)});\n  const ts=require('typescript');`)});`;
supportSource=supportSource.replace("await writeFile(join(directory, 'bootstrap.mjs'),",`${extra}\nawait writeFile(join(directory, 'bootstrap.mjs'),`);
assert.ok(supportSource.includes('savedOperations'));
await writeFile(join(directory,'support.mjs'),`${supportSource}\nexport {harness,conversation,css};`);
const support=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-quick-reply-surfaces-/);await rm(target,{recursive:true,force:true});});
async function fixture(t,mode,width,theme){
 const page=await support.harness(t,mode,{hasTouch:width<768});page.setDefaultTimeout(6000);await page.setViewportSize({width,height:900});
 await page.addStyleTag({content:`${support.css}\nhtml,body,#root{height:100%;margin:0}#root>output{display:none}`});
 const contact={...support.conversation('chat-a','lead-a'),contact_name:'Marina Sintética',lead:{id:'lead-a',name:'Marina Sintética',tags:[]}};
 await page.evaluate(({width,theme,contact})=>{document.documentElement.className=theme;const h=window.harness;h.mobile=width<768;h.auth.organization={id:'org-a'};
  h.savedOperations=[];h.savedReplies=[{id:'ab',shortcut:'ab',content:'Olá, resposta pessoal {nome}',created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z'},
   {id:'aba',shortcut:'aba',content:'Outra mensagem pessoal',created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z'}];
  h.sessions=[{...h.sessions[0],status:'connected'}];h.conversations=[contact];h.messages={...h.messages,messages:[]};h.render();if(h.mode==='floating')h.ctx.openConversation(contact);
 },{width,theme,contact});
 if(mode==='screen')await page.getByText('Marina Sintética',{exact:true}).first().click();
 return page;
}
for(const mode of ['screen','floating'])for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`personal quick replies real ${mode} ${width} ${theme}: manager and slash never send`,async t=>{
 const page=await fixture(t,mode,width,theme);const field=page.getByRole('textbox',{name:'Digite sua mensagem',exact:true});await expect(field).toBeEnabled();
 await field.fill('Mensagem para salvar');await page.getByRole('button',{name:'Mensagens salvas',exact:true}).click();
 const manager=page.getByRole('region',{name:'Gerenciar mensagens salvas'});await expect(manager).toBeVisible();
 const box=await manager.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0,JSON.stringify(box));
 await page.getByRole('button',{name:'Salvar mensagem atual'}).click();await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('pessoal');
 await page.getByRole('button',{name:'Salvar',exact:true}).click();await expect(page.getByRole('button',{name:'Inserir /pessoal',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Fechar mensagens salvas'}).click();await field.fill('/ab');await expect(page.getByRole('option')).toHaveCount(2);
 await field.press('Enter');await expect(field).toHaveValue('Olá, resposta pessoal {nome}');await expect(field).toBeFocused();
 assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.kind==='send').length),0);
 assert.deepEqual(await page.evaluate(()=>window.harness.savedOperations),[['create',{shortcut:'pessoal',content:'Mensagem para salvar'}]]);
 assert.equal(await page.locator('body').evaluate(node=>node.scrollWidth>node.clientWidth),false);
 if(proof){await mkdir(proof,{recursive:true});await page.getByRole('button',{name:'Mensagens salvas',exact:true}).click();await page.screenshot({path:join(proof,`${mode}-${width}-${theme}-personal-replies.png`),fullPage:true});}
});
