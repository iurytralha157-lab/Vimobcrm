import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {expect} from '@playwright/test';

// Real Screen/Floating, MessageBox, launcher and CSS; closed auth/data/transport.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const require=createRequire(import.meta.url),directory=await mkdtemp(join(tmpdir(),'vimob-wa-reduced-motion-'));
const proof=process.env.WHATSAPP_MOTION_PROOF_DIR;
const original=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=original.indexOf("\nfor (const mode of ['screen', 'floating'])");assert.ok(boundary>0);
const launcherPath=join(repository,'components/features/chat/FloatingChatButton.tsx').replaceAll('\\','/');
const injection=`bootstrap=bootstrap.replace('import{FloatingChat}from','import{FloatingChatButton}from'+${JSON.stringify(JSON.stringify(launcherPath))}+';import{FloatingChat}from').replace("h.mode==='floating'&&React.createElement(FloatingChat)","(h.mode==='launcher'?React.createElement(FloatingChatButton):h.mode==='floating'&&React.createElement(FloatingChat))");\n`;
const support=original.slice(0,boundary)
 .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
 .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`)
 .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
 .replace("await writeFile(join(directory, 'bootstrap.mjs'),",`${injection}await writeFile(join(directory, 'bootstrap.mjs'),`);
await writeFile(join(directory,'support.mjs'),`${support}\nexport {fixture,harness,css};`);
const supportModule=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-wa-reduced-motion-/);await rm(target,{recursive:true,force:true});});
async function save(page,name){if(!proof)return;await mkdir(proof,{recursive:true});await page.screenshot({path:join(proof,name+'.png'),fullPage:true});}
const geometry=locator=>locator.evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{width:r.width,height:r.height,font:s.fontSize,weight:s.fontWeight,radius:s.borderRadius};});

for(const mode of ['screen','floating'])for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`pending composer respects reduced motion ${mode} ${width} ${theme}`,async t=>{
 const page=await supportModule.fixture(t,mode,width,theme),field=page.getByRole('textbox',{name:'Digite sua mensagem',exact:true});
 await field.fill('Rascunho sintético');await page.evaluate(()=>{harness.send.isPending=true;harness.render();});
 const send=page.getByRole('button',{name:'Enviando mensagem',exact:true}),spinner=send.locator('svg');await expect(send).toBeDisabled();
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(spinner).toHaveCSS('animation-name','spin');const before=await geometry(send);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(spinner).toHaveCSS('animation-name','none');assert.deepEqual(await geometry(send),before);
 await expect(field).toHaveValue('Rascunho sintético');assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='send').length),0);
 await page.emulateMedia({reducedMotion:'no-preference'});await expect(spinner).toHaveCSS('animation-name','spin');
 assert.equal(await field.evaluate(n=>getComputedStyle(n).fontSize),'12px');await save(page,`${mode}-${width}-${theme}`);
});

for(const width of [320,390,1440])test(`launcher respects motion preference and preserves drag/click/focus at ${width}`,async t=>{
 const page=await supportModule.harness(t,'launcher',{hasTouch:width<768});page.setDefaultTimeout(4000);await page.setViewportSize({width,height:820});
 await page.addStyleTag({content:`${supportModule.css}\nhtml,body,#root{margin:0;height:100%}#root>output{display:none}`});await page.evaluate(()=>document.documentElement.className='light');
 const launcher=page.getByRole('button',{name:'Abrir chat do WhatsApp',exact:true}),domButton=page.locator('button[aria-controls="floating-whatsapp-chat"]'),wrapper=domButton.locator('..');await expect(launcher).toBeVisible();const before=await geometry(launcher);
 await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await wrapper.evaluate(n=>getComputedStyle(n).transitionDuration),'0.3s, 0.15s');
 await page.emulateMedia({reducedMotion:'reduce'});await expect(wrapper).toHaveCSS('transition-duration','0s');await expect(launcher).toHaveCSS('transition-duration','0s');assert.deepEqual(await geometry(launcher),before);
 const box=await launcher.boundingBox();await page.mouse.move(box.x+28,box.y+28);await page.mouse.down();await page.mouse.move(35,box.y+28,{steps:5});await page.mouse.up();
 await expect.poll(()=>wrapper.evaluate(n=>n.getBoundingClientRect().x)).toBe(24);assert.equal(await page.evaluate(()=>harness.ctx.state.isOpen),false,'drag never opens the chat');
 await launcher.click();await expect(domButton).toHaveAttribute('aria-expanded','true');assert.equal(await wrapper.getAttribute('inert'),'');
 await page.evaluate(()=>harness.ctx.closeChat());await expect(launcher).toBeFocused();await expect(launcher).toHaveAttribute('aria-expanded','false');
 await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await wrapper.evaluate(n=>getComputedStyle(n).transitionDuration),'0.3s, 0.15s');
 assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='send').length),0);await save(page,`launcher-${width}`);
});
