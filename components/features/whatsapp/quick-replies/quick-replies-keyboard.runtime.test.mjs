import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real wrapper, saved-reply UI and product CSS; reuses the closed CRUD and
// microphone boundaries of the feature suite. No provider or database.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'vimob-quick-reply-keyboard-'));
let source=await readFile(join(repository,'components/features/whatsapp/quick-replies/quick-replies-ui.runtime.test.mjs'),'utf8');
source=source.slice(0,source.indexOf("test('slash prefix"))
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`);
const loader="module.exports=s=>ts.transpileModule(s,";
const frozenLoader=`module.exports=function(s){const fs=require('node:fs'),path=require('node:path'),base=process.env.WHATSAPP_KEYBOARD_BASELINE_DIR,rel=path.relative(${JSON.stringify(repository.replaceAll('\\','/'))},this.resourcePath),saved=base&&path.join(base,rel);if(saved&&!rel.startsWith('..')&&fs.existsSync(saved))s=fs.readFileSync(saved,'utf8');return ts.transpileModule(s,`;
source=source.replace('const existing = await readFile','let existing = await readFile')
 .replace('let support = existing.slice',`existing=existing.replace(${JSON.stringify(loader)},${JSON.stringify(frozenLoader)}).replace('jsx:ts.JsxEmit.ReactJSX}}).outputText;','jsx:ts.JsxEmit.ReactJSX}}).outputText;};');\nlet support = existing.slice`);
await writeFile(join(directory,'support.mjs'),`${source}\nexport {fixture,field,calls,options,manager,openManager,beginSave};`);
const {fixture,field,calls,options,manager,openManager,beginSave}=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(basename(directory),/^vimob-quick-reply-keyboard-/);await rm(directory,{recursive:true,force:true});});
const noSend=async page=>assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[]);
async function tabToSuggestions(page){for(let i=0;i<8;i++){await page.keyboard.press('Shift+Tab');if(await options(page).evaluateAll(nodes=>nodes.some(n=>n===document.activeElement)))return;}assert.fail('Tab reaches the visible suggestions through the existing composer actions');}

test('Tab focus is visible and arrows follow the actual focused suggestion before Enter inserts once',async t=>{
 const page=await fixture(t);await field(page).fill('/ab');await tabToSuggestions(page);
 await expect(options(page).last()).toBeFocused();await expect(options(page).last()).toHaveAttribute('aria-selected','true');
 assert.notEqual(await options(page).last().evaluate(n=>getComputedStyle(n).boxShadow),'none');
 await page.keyboard.press('ArrowUp');await expect(options(page).nth(1)).toBeFocused();
 await page.keyboard.press('ArrowDown');await expect(options(page).last()).toBeFocused();
 await page.keyboard.press('Home');await expect(options(page).first()).toBeFocused();
 await page.keyboard.press('End');await expect(options(page).last()).toBeFocused();
 await page.keyboard.press('Enter');await expect(field(page)).toHaveValue('Olá, terceira opção');await expect(field(page)).toBeFocused();
 assert.equal((await calls(page)).filter(c=>c[0]==='change'&&c[1]==='Olá, terceira opção').length,1);await noSend(page);
});
test('Escape from a tabbed suggestion restores the draft caret and stays inside the chat',async t=>{
 const page=await fixture(t);await page.evaluate(()=>{window.outerEscapes=0;document.addEventListener('keydown',e=>{if(e.key==='Escape')outerEscapes++;});});
 await field(page).fill('Antes /ab depois');await field(page).press('Home');for(let i=0;i<9;i++)await field(page).press('ArrowRight');
 await expect(options(page)).toHaveCount(3);await tabToSuggestions(page);await expect(options(page).last()).toBeFocused();
 await page.keyboard.press('Escape');await expect(options(page)).toHaveCount(0);await expect(field(page)).toBeFocused();
 assert.equal(await field(page).evaluate(n=>n.selectionStart),9);assert.equal(await page.evaluate(()=>outerEscapes),0);await noSend(page);
});
test('suggestion IME and modifier keys do not insert or send; normal Tab and Shift Tab can leave',async t=>{
 const page=await fixture(t);await field(page).fill('/ab');await tabToSuggestions(page);
 await options(page).last().dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});await expect(field(page)).toHaveValue('/ab');
 for(let i=0;i<4;i++){await page.keyboard.press('Tab');if(await field(page).evaluate(n=>n===document.activeElement))break;}await expect(field(page)).toBeFocused();await tabToSuggestions(page);
 for(let i=0;i<3;i++)await page.keyboard.press('Shift+Tab');assert.equal(await options(page).evaluateAll(nodes=>nodes.some(n=>n===document.activeElement)),false);
 await noSend(page);
});
test('manager opening, edit, cancel, delete confirmation and explicit close manage focus without trapping Tab',async t=>{
 const page=await fixture(t,{value:'Rascunho preservado'});await openManager(page);
 await expect(page.getByRole('button',{name:'Fechar mensagens salvas'})).toBeFocused();
 await page.getByRole('button',{name:'Editar /ab',exact:true}).click();await expect(page.getByRole('textbox',{name:'Atalho da mensagem salva'})).toBeFocused();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(page.getByRole('button',{name:'Editar /ab',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Excluir /ab',exact:true}).click();await expect(page.getByRole('button',{name:'Cancelar',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(page.getByRole('button',{name:'Excluir /ab',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(manager(page)).toHaveCount(0);await expect(field(page)).toBeFocused();await expect(field(page)).toHaveValue('Rascunho preservado');await noSend(page);
});
test('API rerenders do not steal manager form focus or restore an old chat focus after retirement',async t=>{
 const page=await fixture(t,{value:'Rascunho A'});await beginSave(page);const content=page.getByRole('textbox',{name:'Conteúdo da mensagem salva'});
 await content.focus();await content.fill('Editar sem perder foco');await page.evaluate(()=>h.render());await expect(content).toBeFocused();
 await page.evaluate(()=>{h.render({...h.props,context:'chat-b',value:'Rascunho B'});const outside=document.createElement('input');outside.id='outside';document.body.append(outside);outside.focus();});
 await expect(manager(page)).toHaveCount(0);await expect(page.locator('#outside')).toBeFocused();await expect(field(page)).toHaveValue('Rascunho B');await noSend(page);
});
for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`keyboard saved replies preserve compact geometry ${width} ${theme}`,async t=>{
 const page=await fixture(t,{value:'Mensagem pessoal'});await page.setViewportSize({width,height:820});await page.evaluate(theme=>document.documentElement.className=theme,theme);
 await openManager(page);await expect(page.getByRole('button',{name:'Fechar mensagens salvas'})).toBeFocused();await page.keyboard.press('Escape');await expect(field(page)).toBeFocused();
 await field(page).fill('/ab');await tabToSuggestions(page);await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await expect(field(page)).toHaveValue('Uma segunda mensagem');
 assert.deepEqual(await field(page).evaluate(n=>({font:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight})),{font:'12px',weight:'300'});
 assert.equal(await page.locator('#root').evaluate(n=>n.scrollWidth>n.clientWidth),false);await noSend(page);
});
