import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real wrapper, textarea, personal-reply UI, input model and product CSS.
// Only scoped CRUD/query transport and the microphone are closed fixtures.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-personal-replies-'));
const proof = process.env.WHATSAPP_QUICK_REPLIES_UI_PROOF_DIR;
const existing = await readFile(join(repository, 'components/features/whatsapp/scoped-message-box.runtime.test.mjs'), 'utf8');
let support = existing.slice(0, existing.indexOf("test('WhatsApp wrapper"));
support = support
  .replace("import { chromium, expect } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const {chromium,expect}=playwright;`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository=${JSON.stringify(repository)};`)
  .replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`);
const originalStub = "export const useWhatsAppQuickReplyScope=()=>({identity:'unavailable',enabled:false});export const useWhatsAppQuickReplies=()=>({data:[],isPending:false,isError:false,refetch:async()=>{}});export const useCreateWhatsAppQuickReply=()=>({});export const useUpdateWhatsAppQuickReply=()=>({});export const useDeleteWhatsAppQuickReply=()=>({});";
assert.ok(support.includes(originalStub));
const dataFixture = `
export const useWhatsAppQuickReplyScope=()=>({identity:h.props.scope||'org-a/user-a/auth-sid-a',enabled:h.props.authorized!==false});
export const useWhatsAppQuickReplies=enabled=>({data:enabled?h.items:undefined,isPending:!!h.props.loading,isError:!!h.props.failed,
 refetch:async()=>{h.calls.push(['retry']);h.render({...h.props,failed:false,loading:false});}});
function mutation(kind){return{isPending:h.pending===kind,mutateAsync:async input=>{
 h.calls.push([kind,input]);h.pending=kind;h.render();
 try{if(h.defer)await new Promise((yes,no)=>h.finish={yes,no});if(h.failure)throw new Error('Synthetic API error');
 const item={...input,id:input.id||'saved-'+(h.items.length+1),created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z'};
 if(kind==='create')h.items=[...h.items,item];if(kind==='update')h.items=h.items.map(old=>old.id===input.id?item:old);
 if(kind==='delete')h.items=h.items.filter(old=>old.id!==input);return item;
 }finally{h.pending=null;h.render();}}};}
export const useCreateWhatsAppQuickReply=()=>mutation('create');export const useUpdateWhatsAppQuickReply=()=>mutation('update');export const useDeleteWhatsAppQuickReply=()=>mutation('delete');`;
support = support.replace(originalStub, dataFixture)
  .replace('window.h={props:{},calls:[],mounts:0,unmounts:0,', 'window.h={props:{},items:[],pending:null,calls:[],mounts:0,unmounts:0,')
  .replace("join(repository, 'components/features/whatsapp/ScopedMessageBox.tsx').replaceAll", "join(repository, 'components/features/whatsapp').replaceAll");
assert.ok(support.includes(dataFixture));
await writeFile(join(directory,'support.mjs'), `${support}\nexport {open,field,calls};`);
const { open, field, calls } = await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-personal-replies-/);await rm(target,{recursive:true,force:true});});
const reply = (shortcut,content=shortcut.toUpperCase())=>({id:shortcut,shortcut,content,created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z'});
async function fixture(t, props={}) {
  const page=await open(t,{multiline:true,...props});
  await page.evaluate(items=>{h.items=items;h.render();},[reply('ab','Olá, tudo bem?'),reply('aba','Uma segunda mensagem'),reply('abe','Olá, terceira opção')]);
  await page.addStyleTag({content:'#root{margin-top:320px}'});
  return page;
}
const options = page=>page.getByRole('option');
const manager = page=>page.getByRole('region',{name:'Gerenciar mensagens salvas'});
async function openManager(page){await page.getByRole('button',{name:'Mensagens salvas',exact:true}).click();await expect(manager(page)).toBeVisible();}
async function beginSave(page){await openManager(page);await page.getByRole('button',{name:'Salvar mensagem atual',exact:true}).click();}

test('slash prefix narrows immediately, keyboard insertion consumes Enter, second Enter sends once',async t=>{
  const page=await fixture(t);await field(page).fill('/');await expect(options(page)).toHaveCount(3);
  await field(page).type('a');await expect(options(page)).toHaveCount(3);await field(page).type('b');await expect(options(page)).toHaveCount(3);
  await field(page).type('e');await expect(options(page)).toHaveCount(1);await expect(options(page)).toContainText('/abe');
  await field(page).press('Enter');await expect(field(page)).toHaveValue('Olá, terceira opção');
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);await field(page).press('Enter');
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[['send','Olá, terceira opção']]);
});
test('arrow selection, cursor insertion and multiple replies preserve prefix and suffix without sending',async t=>{
  const page=await fixture(t,{value:'Antes /ab depois'});await field(page).focus();
  await field(page).press('Home');for(let i=0;i<9;i++)await field(page).press('ArrowRight');
  await expect(options(page)).toHaveCount(3);await field(page).press('ArrowDown');await field(page).press('Enter');
  await expect(field(page)).toHaveValue('Antes Uma segunda mensagem depois');
  await page.keyboard.insertText(' /abe');await expect(options(page)).toHaveCount(1);await options(page).first().click();
  await expect(field(page)).toBeFocused();await expect(field(page)).toHaveValue('Antes Uma segunda mensagem Olá, terceira opção depois');
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
});
test('Escape closes only suggestions, IME Enter does not insert and Shift Enter remains multiline',async t=>{
  const page=await fixture(t);await page.evaluate(()=>{window.outerEscapes=0;document.addEventListener('keydown',event=>{if(event.key==='Escape')window.outerEscapes++;});});
  await field(page).fill('/ab');await expect(options(page)).toHaveCount(3);
  await field(page).dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});await expect(field(page)).toHaveValue('/ab');
  await field(page).press('Escape');await expect(options(page)).toHaveCount(0);assert.equal(await page.evaluate(()=>window.outerEscapes),0);
  await field(page).fill('/ab');await field(page).press('Shift+Enter');assert.match(await field(page).inputValue(),/\n/);
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
  await field(page).fill('Texto sem atalho');await field(page).dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
});
test('saved manager retains draft, creates edits deletes and inserts at selection',async t=>{
  const page=await fixture(t,{value:'Texto pessoal sintético'});await beginSave(page);
  await expect(page.getByRole('textbox',{name:'Conteúdo da mensagem salva'})).toHaveValue('Texto pessoal sintético');
  await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('meu_atalho');await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Inserir /meu_atalho'})).toBeVisible();await expect(field(page)).toHaveValue('Texto pessoal sintético');
  await page.getByRole('button',{name:'Editar /meu_atalho'}).click();await page.getByRole('textbox',{name:'Conteúdo da mensagem salva'}).fill('Texto revisado');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await expect(page.getByRole('button',{name:'Inserir /meu_atalho'})).toContainText('Texto revisado');
  await page.getByRole('button',{name:'Excluir /meu_atalho'}).click();await page.getByRole('button',{name:'Confirmar exclusão'}).click();await expect(page.getByRole('button',{name:'Inserir /meu_atalho'})).toHaveCount(0);
  await page.getByRole('button',{name:'Fechar mensagens salvas'}).click();await field(page).fill('Antes XX depois');
  await field(page).evaluate(node=>{node.setSelectionRange(6,8);node.dispatchEvent(new Event('select',{bubbles:true}));});
  await openManager(page);await page.getByRole('button',{name:'Inserir /ab',exact:true}).click();await expect(field(page)).toHaveValue('Antes Olá, tudo bem? depois');await expect(field(page)).toBeFocused();
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
});
test('read and mutation failures have retry and preserve composer and unsaved editor',async t=>{
  const page=await fixture(t,{value:'Não perder este texto',failed:true});await openManager(page);
  await expect(page.getByRole('button',{name:'Salvar mensagem atual'})).toBeDisabled();await page.getByRole('button',{name:'Tentar novamente'}).click();
  await page.getByRole('button',{name:'Salvar mensagem atual'}).click();await page.evaluate(()=>h.failure=true);
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Seu texto foi mantido');
  await expect(page.getByRole('textbox',{name:'Conteúdo da mensagem salva'})).toHaveValue('Não perder este texto');await expect(field(page)).toHaveValue('Não perder este texto');
  await page.evaluate(()=>h.failure=false);await page.getByRole('button',{name:'Tentar novamente'}).click();await expect(page.getByRole('textbox',{name:'Atalho da mensagem salva'})).toHaveCount(0);
});
test('context auth and ABA changes retire pending manager completions and preserve new draft',async t=>{
  const page=await fixture(t,{value:'Antigo'});await beginSave(page);await page.evaluate(()=>h.defer=true);
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await expect(page.getByRole('button',{name:'Salvando…'})).toBeDisabled();
  await page.evaluate(()=>h.render({...h.props,scope:'org-a/user-b/auth-sid-b',context:'chat-b',value:'Novo rascunho'}));await expect(manager(page)).toHaveCount(0);
  await openManager(page);await page.evaluate(()=>{h.defer=false;h.finish.yes();});await expect(manager(page)).toBeVisible();await expect(field(page)).toHaveValue('Novo rascunho');
  await page.evaluate(()=>h.render({...h.props,scope:'org-a/user-a/auth-sid-a',context:'chat-a',value:'Voltou novo'}));await expect(manager(page)).toHaveCount(0);await expect(field(page)).toHaveValue('Voltou novo');
});
test('ABA without an intermediate gesture does not resurrect the old editor and audio disables replies',async t=>{
  const page=await fixture(t,{value:'Rascunho antigo'});await beginSave(page);
  await page.evaluate(()=>h.render({...h.props,scope:'org-b/user-a/auth-sid-b',context:'chat-b'}));await expect(manager(page)).toHaveCount(0);
  await page.evaluate(()=>h.render({...h.props,scope:'org-a/user-a/auth-sid-a',context:'actor/org/chat-a',value:''}));await expect(manager(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Gravar áudio'}).click();await expect(page.getByRole('button',{name:'Mensagens salvas',exact:true})).toBeDisabled();
  assert.deepEqual(await page.evaluate(()=>[h.mounts,h.unmounts]),[1,0]);
});
test('pending slash Enter never sends and schema validates limits while preserving literal saved text',async t=>{
  const page=await fixture(t,{loading:true});await field(page).fill('/ab');await field(page).press('Enter');assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
  const literal='  Olá\n{nome}  ';await page.evaluate(value=>h.render({...h.props,value,loading:false}),literal);await beginSave(page);
  await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('_invalid');await page.getByRole('button',{name:'Salvar',exact:true}).click();assert.equal((await calls(page)).filter(c=>c[0]==='create').length,0);
  await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('/AB_1');await page.getByRole('textbox',{name:'Conteúdo da mensagem salva'}).fill('😀'.repeat(4001));
  await page.getByRole('button',{name:'Salvar',exact:true}).click();await expect(page.getByRole('alert')).toContainText('4000');assert.equal((await calls(page)).filter(c=>c[0]==='create').length,0);
  await page.getByRole('textbox',{name:'Conteúdo da mensagem salva'}).fill(literal);await page.getByRole('button',{name:'Salvar',exact:true}).click();
  assert.deepEqual((await calls(page)).find(c=>c[0]==='create'),['create',{shortcut:'ab_1',content:literal}]);
});
for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`compact personal menu and suggestions fit ${width} ${theme}`,async t=>{
  const page=await fixture(t,{value:'Texto para salvar'});await page.setViewportSize({width,height:820});await page.evaluate(theme=>document.documentElement.className=theme,theme);
  await openManager(page);for(const node of [manager(page),page.getByRole('button',{name:'Mensagens salvas',exact:true}),field(page)]){
    const box=await node.boundingBox();assert.ok(box);assert.ok(box.x>=0&&box.x+box.width<=width+0.5,JSON.stringify(box));
  }
  await expect(page.getByRole('button',{name:'Salvar mensagem atual'})).toBeVisible();await page.getByRole('button',{name:'Fechar mensagens salvas'}).click();await field(page).fill('/ab');
  await expect(options(page)).toHaveCount(3);assert.equal(await page.locator('#root').evaluate(node=>node.scrollWidth>node.clientWidth),false);
  assert.deepEqual(await field(page).evaluate(node=>({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight,height:getComputedStyle(node.parentElement).height})),{size:'12px',weight:'300',height:'42px'});
  if(proof){await mkdir(proof,{recursive:true});await page.screenshot({path:join(proof,`quick-replies-${width}-${theme}.png`),fullPage:true});}
});
test('forty-character shortcuts and unbroken four-thousand-character text stay within320',async t=>{
  const page=await fixture(t);await page.evaluate(item=>{h.items=[item];h.render();},reply('a'.repeat(40),'X'.repeat(4000)));
  await field(page).fill('/a');await expect(options(page)).toHaveCount(1);
  assert.equal(await options(page).evaluate(node=>node.scrollWidth>node.clientWidth),false);
  await page.getByRole('button',{name:'Mensagens salvas',exact:true}).click();assert.equal(await manager(page).evaluate(node=>node.scrollWidth>node.clientWidth),false);
});
test('keyboard selection scrolls only its own list and keeps a distant option visible',async t=>{
  const page=await fixture(t);await page.evaluate(items=>{h.items=items;h.render();},Array.from({length:25},(_,i)=>reply(`item_${String(i).padStart(2,'0')}`)));
  await field(page).fill('/item');await expect(options(page)).toHaveCount(25);const pageTop=await page.evaluate(()=>window.scrollY);
  for(let i=0;i<18;i++)await field(page).press('ArrowDown');const selected=page.getByRole('option',{selected:true});await expect(selected).toContainText('/item_18');
  const bounds=await selected.evaluate(node=>{const row=node.getBoundingClientRect(),list=node.parentElement.getBoundingClientRect();return{top:row.top,bottom:row.bottom,start:list.top,end:list.bottom,scroll:node.parentElement.scrollTop};});
  assert.ok(bounds.scroll>0&&bounds.top>=bounds.start-1&&bounds.bottom<=bounds.end+1,JSON.stringify(bounds));assert.equal(await page.evaluate(()=>window.scrollY),pageTop);
  await expect(field(page)).toBeFocused();await field(page).press('Enter');await expect(field(page)).toHaveValue('ITEM_18');
});
test('outside pointer preserves unsaved personal editor until an explicit close',async t=>{
  const page=await fixture(t,{value:'Rascunho da conversa'});await beginSave(page);await page.getByRole('textbox',{name:'Atalho da mensagem salva'}).fill('rascunho_pessoal');
  await page.getByRole('textbox',{name:'Conteúdo da mensagem salva'}).fill('Conteúdo pessoal ainda não salvo');
  await page.locator('main').click({position:{x:2,y:2}});await expect(manager(page)).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Atalho da mensagem salva'})).toHaveValue('rascunho_pessoal');
  await expect(page.getByRole('textbox',{name:'Conteúdo da mensagem salva'})).toHaveValue('Conteúdo pessoal ainda não salvo');await expect(field(page)).toHaveValue('Rascunho da conversa');
  await page.getByRole('button',{name:'Fechar mensagens salvas'}).click();await expect(manager(page)).toHaveCount(0);
});
test('a selected range never opens slash autocomplete and manager replaces exactly that range',async t=>{
  const page=await fixture(t,{value:'/ab restante'});await field(page).focus();await field(page).press('Home');await field(page).press('ArrowRight');await field(page).press('ArrowRight');
  await expect(options(page)).toHaveCount(3);await field(page).press('Shift+End');await expect(options(page)).toHaveCount(0);
  await openManager(page);await page.getByRole('button',{name:'Inserir /ab',exact:true}).click();await expect(field(page)).toHaveValue('/aOlá, tudo bem?');
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
});
