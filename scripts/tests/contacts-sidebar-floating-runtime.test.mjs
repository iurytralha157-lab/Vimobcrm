import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Actual FloatingChat -> real composer/attachment review, SharedFilters, Radix,
// layout coordinator, launcher and product CSS. Reuse the closed transport
// harness; no server, database, session, microphone or outbound request.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(join(tmpdir(),'vimob-contacts-sidebar-floating-'));
const proof=process.env.VIMOB_CONTACTS_SIDEBAR_PROOF_DIR || null;
const font=await readFile(join(repository,'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'));
const fontCss="@font-face{font-family:'Geist Offline';font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,"+font.toString('base64')+")} :root{--font-geist-sans:'Geist Offline'}";
const original=await readFile(join(repository,'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'),'utf8');
const boundary=original.indexOf("\nfor (const mode of ['screen', 'floating'])");assert.ok(boundary>0);
const sourcePath=relative=>join(repository,relative).replaceAll('\\','/');
const imports=`import{FilterPanelLayoutProvider}from${JSON.stringify(sourcePath('contexts/FilterPanelLayoutContext.tsx'))};import{FloatingChatButton}from${JSON.stringify(sourcePath('components/features/chat/FloatingChatButton.tsx'))};import{SharedFilters as PilotSharedFilters}from${JSON.stringify(sourcePath('components/shared/SharedFilters.tsx'))};`;
const pilot=`function SidebarPilot(){const[search,setSearch]=React.useState('');return React.createElement('div',{className:'app-shell',style:{position:'fixed',top:16,left:16,zIndex:30}},React.createElement(PilotSharedFilters,{presentation:'sidebar',datePreset:null,onDatePresetChange:noop,customDateRange:null,onCustomDateRangeChange:noop,defaultDatePreset:null,teamId:null,onTeamChange:noop,userId:null,onUserChange:noop,scopeTeams:[],scopeUsers:[],source:null,onSourceChange:noop,pageId:null,onPageChange:noop,campaignId:null,onCampaignChange:noop,adSetId:null,onAdSetChange:noop,adId:null,onAdChange:noop,tagIds:[],onTagsChange:noop,dealStatus:null,onDealStatusChange:noop,searchQuery:search,onSearchChange:setSearch,onClear:()=>setSearch(''),hasActiveFilters:!!search}));}`;
const oldTree="return React.createElement(FloatingChatProvider,null,React.createElement(Probe),h.mode==='floating'&&React.createElement(FloatingChat));";
const newTree="return React.createElement(FilterPanelLayoutProvider,{scopeKey:'synthetic-contacts-floating'},React.createElement(FloatingChatProvider,null,React.createElement(Probe),React.createElement(SidebarPilot),React.createElement(FloatingChatButton),h.mode==='floating'&&React.createElement(FloatingChat)));";
const injection=`
bootstrap=bootstrap.replace('import{FloatingChat}from',${JSON.stringify(imports)}+'import{FloatingChat}from')
 .replace('    function App(){',${JSON.stringify(pilot)}+'    function App(){')
 .replace(${JSON.stringify(oldTree)},${JSON.stringify(newTree)})
 .replace('export const useUsers=()=>h().emptyQuery;','export const useUsers=()=>h().emptyQuery;export const useOrganizationUsers=()=>h().emptyQuery;')
 .replace('export const useTags=()=>h().emptyQuery;','export const useTags=()=>h().emptyQuery;export const useCreateTag=()=>h().mutation;')
 .replace('recorderMounts:0,recorderUnmounts:0','markReadCalls:[],recorderMounts:0,recorderUnmounts:0')
 .replace('export const useMarkConversationAsRead=()=>h().mutation;','export const useMarkConversationAsRead=()=>({mutate:params=>h().markReadCalls.push(params)});')
 .replace('export const getDateRangeFromPreset=()=>null;',${JSON.stringify('export * from '+JSON.stringify(sourcePath('hooks/use-dashboard-filters.ts'))+';')});
bootstrap=bootstrap.replace("  const ts=require('typescript');",${JSON.stringify("  await mock('@/hooks/use-teams', 'export const useTeams=()=>({data:[],isFetching:false,isSuccess:true});');\n")}+"  const ts=require('typescript');");
bootstrap=bootstrap.replace("page.on('pageerror',e=>errors.push(e.message))","page.on('pageerror',e=>errors.push(e.stack||e.message))");
assert.ok(bootstrap.includes(${JSON.stringify(newTree)}),'coordinator wraps the real floating context and surfaces');
assert.ok(bootstrap.includes('markReadCalls:[]')&&bootstrap.includes('mutate:params=>h().markReadCalls.push(params)'),'read acknowledgement instrumentation is active');
`;
const support=original.slice(0,boundary)
  .replace("import { expect } from '@playwright/test';",`import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const{expect}=playwright;`)
  .replace('const require = createRequire(import.meta.url);',`const require=createRequire(${JSON.stringify(join(repository,'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');",`const repository=${JSON.stringify(repository)};`)
  .replace("const sources = ['components/features/whatsapp', 'components/features/chat', 'components/ui']","const sources = ['components/features/whatsapp','components/features/chat','components/ui','components/shared','config/filter-ui.ts']")
  .replace("await writeFile(join(directory, 'bootstrap.mjs'),",injection+"\nawait writeFile(join(directory, 'bootstrap.mjs'),");
await writeFile(join(directory,'support.mjs'),support+'\nexport {fixture};');
const {fixture}=await import(pathToFileURL(join(directory,'support.mjs')).href);
after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.match(basename(target),/^vimob-contacts-sidebar-floating-/);await rm(target,{recursive:true,force:true});});
async function screenshot(page,name){if(proof){await mkdir(proof,{recursive:true});await page.screenshot({path:join(proof,name+'.png')});}}

for(const width of [1024,1440])test(`real expanded chat preserves composer and attachment draft while Contacts sidebar opens at ${width}`,async t=>{
  const page=await fixture(t,'floating',width);
  await page.addStyleTag({content:fontCss});await page.evaluate(()=>document.fonts.ready);
  await page.emulateMedia({reducedMotion:'reduce'});
  const surface=page.locator('#floating-whatsapp-chat');
  // Positive control: this authorized visible thread really does mark read.
  await page.evaluate(()=>{
    const h=harness,at='2026-10-14T11:01:00Z';
    Object.assign(h.ctx.state.activeConversation,{unread_count:1,last_message_at:at});
    h.messages={...h.messages,messages:[...h.messages.messages,{...h.messages.messages[0],id:'00000000-0000-4000-8000-000000000002',message_id:'provider-inbound-2',from_me:false,status:'received',sent_at:at}]};h.render();
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(()=>page.evaluate(()=>harness.markReadCalls.length)).toBeGreaterThan(0);
  const composer=surface.getByRole('textbox',{name:'Digite sua mensagem',exact:true});
  await composer.fill('Rascunho que deve sobreviver ao painel');
  await surface.locator('input[type=file]').setInputFiles({name:'ficha-sidebar.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic sidebar attachment')});
  const review=page.getByRole('region',{name:'Revisar arquivos antes de enviar'});
  await expect(review.getByText('ficha-sidebar.pdf',{exact:true})).toBeVisible();
  const caption=review.getByRole('textbox',{name:'Legenda de ficha-sidebar.pdf',exact:true});await caption.fill('Legenda preservada');
  const previous=await page.evaluate(()=>({open:harness.ctx.state.isOpen,conversation:harness.ctx.state.activeConversation?.id,generation:harness.ctx.state.intentGeneration,mounts:harness.recorderMounts,unmounts:harness.recorderUnmounts}));
  await composer.evaluate(n=>{n.dataset.sidebarComposerProof='';window.sidebarComposerNode=n;});
  await screenshot(page,`chat-draft-${width}-before`);
  await page.getByRole('button',{name:/Abrir filtros avançados/}).click();
  const dialog=page.getByRole('dialog',{name:'Filtros avançados',exact:true});await expect(dialog).toBeVisible();
  await expect(surface).toBeHidden();
  assert.equal(await page.evaluate(()=>harness.ctx.state.isOpen),true,'filter coordination never closes the chat context');
  assert.equal(await page.locator('[data-sidebar-composer-proof]').evaluate(n=>n===window.sidebarComposerNode),true,'composer DOM is preserved');
  const readBefore=await page.evaluate(()=>harness.markReadCalls.length);
  await page.evaluate(()=>{
    const h=harness,at='2026-10-14T11:02:00Z';
    Object.assign(h.ctx.state.activeConversation,{unread_count:2,last_message_at:at});
    h.messages={...h.messages,messages:[...h.messages.messages,{...h.messages.messages[0],id:'00000000-0000-4000-8000-000000000003',message_id:'provider-inbound-3',from_me:false,status:'received',sent_at:at}]};h.render();
    window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(()=>harness.markReadCalls.length),readBefore,'hidden chat never marks a new inbound message read');
  await screenshot(page,`chat-draft-${width}-during`);
  await dialog.getByRole('button',{name:'Fechar filtros avançados',exact:true}).focus();await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);await expect(surface).toBeVisible();
  await expect(composer).toHaveValue('Rascunho que deve sobreviver ao painel');
  await expect(caption).toHaveValue('Legenda preservada');await expect(review.getByText('ficha-sidebar.pdf',{exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>({open:harness.ctx.state.isOpen,conversation:harness.ctx.state.activeConversation?.id,generation:harness.ctx.state.intentGeneration,mounts:harness.recorderMounts,unmounts:harness.recorderUnmounts})),previous,'Escape closes only filters; chat context and composer lifetime stay unchanged');
  await page.getByRole('button',{name:/Abrir filtros avançados/}).click();await expect(dialog).toBeVisible();
  await page.getByRole('button',{name:/Abrir chat do WhatsApp/}).click();
  await expect(dialog).toHaveCount(0);await expect(surface).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>({id:harness.ctx.state.activeConversation?.id,generation:harness.ctx.state.intentGeneration})),{id:previous.conversation,generation:previous.generation},'launcher resumes an already open chat without toggling it closed or replacing its intent');
  await expect(composer).toHaveValue('Rascunho que deve sobreviver ao painel');await expect(caption).toHaveValue('Legenda preservada');
  assert.equal(await page.evaluate(()=>harness.requests.filter(r=>['send','archive','delete','link'].includes(r.kind)).length),0);
  await screenshot(page,`chat-draft-${width}-after`);
});

test('real expanded history keeps its away-from-bottom position while filters temporarily hide its DOM',async t=>{
  const messages=Array.from({length:45},(_,index)=>({id:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),message_id:'history-'+index,conversation_id:'chat-a',lead_id:'lead-a',session_id:'session-a',content:'Linha histórica sintética '+index+' com conteúdo suficiente para rolagem.',message_type:'text',from_me:true,status:'read',can_quote:true,can_react:true,sent_at:'2026-10-14T10:'+String(index).padStart(2,'0')+':00Z',metadata:{},sender_name:'Corretor Sintético'}));
  const page=await fixture(t,'floating',1440,'light',messages);await page.emulateMedia({reducedMotion:'reduce'});
  const surface=page.locator('#floating-whatsapp-chat'),viewport=surface.locator('[data-radix-scroll-area-viewport]').first();
  await expect.poll(()=>viewport.evaluate(n=>n.scrollHeight>n.clientHeight+300)).toBe(true);
  await viewport.evaluate(n=>{n.scrollTop=Math.floor((n.scrollHeight-n.clientHeight)/3);n.dispatchEvent(new Event('scroll'));});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const previous=await viewport.evaluate(n=>n.scrollTop);
  await page.getByRole('button',{name:/Abrir filtros avançados/}).click();
  const dialog=page.getByRole('dialog',{name:'Filtros avançados',exact:true});await expect(dialog).toBeVisible();await expect(surface).toBeHidden();
  await dialog.getByRole('button',{name:'Buscar',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(surface).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.ok(Math.abs(await viewport.evaluate(n=>n.scrollTop)-previous)<=1,'returning from filters does not jump to the latest message');
  assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='send').length),0);
});

test('real chat keeps its draft and pending attachment when an open filter panel crosses into mobile',async t=>{
  const page=await fixture(t,'floating',1024);await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByRole('textbox',{name:'Digite sua mensagem',exact:true}).fill('Rascunho na transição mobile');
  await page.locator('#floating-whatsapp-chat input[type=file]').setInputFiles({name:'transicao-sidebar.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic transition')});
  await expect(page.getByRole('region',{name:'Revisar arquivos antes de enviar'})).toBeVisible();
  const before=await page.evaluate(()=>({id:harness.ctx.state.activeConversation?.id,generation:harness.ctx.state.intentGeneration}));
  await page.getByRole('button',{name:/Abrir filtros avançados/}).click();
  const dialog=page.getByRole('dialog',{name:'Filtros avançados',exact:true});await expect(dialog).toBeVisible();
  await page.setViewportSize({width:390,height:820});await page.evaluate(()=>{harness.mobile=true;harness.render();});
  await expect(dialog).toBeVisible();await expect(page.locator('#floating-whatsapp-chat')).toBeHidden();
  await dialog.getByRole('button',{name:'Buscar',exact:true}).click();await expect(dialog).toHaveCount(0);
  const chat=page.locator('#floating-whatsapp-chat');await expect(chat).toBeVisible();await expect(chat).toHaveAttribute('aria-modal','true');
  await expect(page.getByRole('textbox',{name:'Digite sua mensagem',exact:true})).toHaveValue('Rascunho na transição mobile');
  await expect(page.getByRole('region',{name:'Revisar arquivos antes de enviar'}).getByText('transicao-sidebar.pdf',{exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>({id:harness.ctx.state.activeConversation?.id,generation:harness.ctx.state.intentGeneration})),before);
  assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='send').length),0);
  await screenshot(page,'chat-draft-restored-mobile');
});

test('real chat restores conversation autofocus after yielding to a calendar opened from the filter panel',async t=>{
  const page=await fixture(t,'floating',1440);await page.emulateMedia({reducedMotion:'reduce'});
  const surface=page.locator('#floating-whatsapp-chat');
  const selectConversation=async()=>{
    await page.getByRole('button',{name:'Voltar à lista de conversas',exact:true}).click();
    await surface.getByText('Marina Sintética',{exact:true}).first().click();
    await expect(page.getByRole('textbox',{name:'Digite sua mensagem',exact:true})).toBeFocused();
  };
  await selectConversation();
  await page.getByRole('button',{name:/Abrir filtros avançados/}).click();
  const dialog=page.getByRole('dialog',{name:'Filtros avançados',exact:true});await expect(dialog).toBeVisible();
  await page.getByRole('button',{name:/^Período:/}).click();
  await expect(dialog).toHaveCount(0);await expect(page.getByRole('grid')).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('grid').evaluate(n=>n.closest('[role="dialog"]').contains(document.activeElement)),true,'chat restoration respects the active calendar');
  await page.keyboard.press('Escape');await expect(page.getByRole('grid')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Período:/})).toBeFocused();
  await selectConversation();
  assert.equal(await page.evaluate(()=>harness.requests.filter(r=>r.kind==='send').length),0);
});
