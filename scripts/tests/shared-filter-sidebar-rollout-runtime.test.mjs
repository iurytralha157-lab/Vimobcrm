import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { errors, externalRequests, open, page, repository, save, search, show, sidebar, state, trigger, withMousePointer } from './shared-filter-sidebar-rollout-runtime/harness.mjs';

const period=()=>page.getByRole('button',{name:/^Período:/});
async function assertOwnedPortal(locator){
  await expect(locator).toBeVisible();
  // Radix Select correctly hides its parent dialog from AX while its own
  // modal list is active; inspect parent identity without requiring AX access.
  const scope=await page.locator('[data-filter-sidebar="root"]').getAttribute('data-filter-layer');
  assert.equal(await locator.evaluate(n=>n.closest('[data-filter-layer]')?.dataset.filterLayer),scope);
  assert.equal(await locator.evaluate(n=>Boolean(n.closest('[aria-hidden="true"]'))),false);
}

test('six actual consumer callsites inherit the shared presentation inside the protected coordinator',async()=>{
  const paths=[
    'components/features/dashboard/DashboardScreen.tsx','components/features/pipelines/pipeline-screen/PipelineToolbar.tsx',
    'components/features/contacts/contacts-screen/ContactsToolbar.tsx','components/features/marketing/MarketingScreen.tsx',
    'components/features/meta/MetaCampaignsDashboardScreen.tsx','components/features/whatsapp/conversations/ConversationFilters.tsx',
  ];
  for(const file of paths){
    const source=await readFile(path.join(repository,file),'utf8');assert.match(source,/<SharedFilters\b/,file);
    assert.doesNotMatch(source,/presentation\s*=\s*["']popover["']/,file+' has no explicit legacy override');
  }
  const layout=await readFile(path.join(repository,'app/(protected)/layout.tsx'),'utf8');assert.match(layout,/<ProtectedProvider>/);
  const provider=await readFile(path.join(repository,'components/providers/protected-provider.tsx'),'utf8');
  assert.match(provider,/<FloatingChatProvider>[\s\S]*<ScopedFilterPanelLayoutProvider>[\s\S]*<FilterProviderWrapper>/);
  // This is source wiring evidence, not a render of the six complete screens.
});

for(const width of [320,390,1024,1440])test(`omitting presentation opens the real sidebar and leaves period as a calendar at ${width}px`,async()=>{
  await show({width});await open();await expect(sidebar()).toHaveCount(1);
  const box=await sidebar().boundingBox();assert.ok(Math.abs(box.x+box.width-width)<=1);assert.ok(box.width<=400.5&&box.x>=0);
  await expect(sidebar().getByRole('button',{name:'Buscar',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.rolloutPanel.active),true);
  assert.equal(await page.evaluate(()=>window.rolloutPanel.mobile),width<768);
  await save('default-sidebar-'+width);
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
  await period().click();await expect(page.getByRole('grid')).toBeVisible();await expect(sidebar()).toHaveCount(0);
  await page.getByRole('button',{name:'Hoje',exact:true}).click();assert.equal((await state()).snapshot.datePreset,'today');
});

for(const width of [390,1024])test(`explicit popover override retains the existing callback and search contract at ${width}px`,async()=>{
  await show({width,presentation:'popover'});await trigger().click();await expect(search()).toBeVisible();await expect(sidebar()).toHaveCount(0);
  await expect(page.getByText('Filtros Avançados',{exact:true})).toBeVisible();await search().fill('Busca no legado');
  await page.keyboard.press('Escape');await expect(search()).toHaveCount(0);assert.equal((await state()).snapshot.searchQuery,'Busca no legado');
  assert.deepEqual(await page.evaluate(()=>window.rolloutEvents),[true,false]);
});

for(const width of [390,1024])test(`default trigger geometry and hover match Contacts tokens at ${width}px`,async t=>{
  await show({width});
  const capabilities=()=>page.evaluate(()=>({hover:matchMedia('(hover:hover)').matches,fine:matchMedia('(pointer:fine)').matches,touchPoints:navigator.maxTouchPoints}));
  assert.deepEqual(await capabilities(),{hover:false,fine:false,touchPoints:1});
  await withMousePointer(async()=>{
    const mouse=await capabilities();assert.deepEqual(mouse,{hover:true,fine:true,touchPoints:0});
    t.diagnostic(JSON.stringify({width,mouse}));
    for(const control of [period(),trigger()]){
      const metrics=await control.evaluate(n=>{const s=getComputedStyle(n),i=n.querySelector('svg').getBoundingClientRect();return{height:n.getBoundingClientRect().height,font:s.fontSize,radius:s.borderRadius,iconWidth:i.width,iconHeight:i.height};});
      assert.deepEqual(metrics,{height:32,font:'10px',radius:'6px',iconWidth:14,iconHeight:14});
      const expected=await control.evaluate(n=>{const s=document.createElement('span');n.append(s);s.style.background='var(--app-surface-hover)';const hover=getComputedStyle(s).backgroundColor;s.style.background='var(--app-surface-soft)';const idle=getComputedStyle(s).backgroundColor;s.remove();return{idle,hover};});
      await page.mouse.move(1,1);await expect.poll(()=>control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(expected.idle);
      await control.hover();await expect.poll(()=>control.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe(expected.hover);
      t.diagnostic(JSON.stringify({width,control:await control.getAttribute('aria-label'),...expected,actual:await control.evaluate(n=>getComputedStyle(n).backgroundColor)}));
    }
  });
  const restored=await capabilities();assert.deepEqual(restored,{hover:false,fine:false,touchPoints:1});
  t.diagnostic(JSON.stringify({width,restored}));
});

test('default sidebar preserves immediate selections, deferred search, counts and open/close callbacks',async()=>{
  await show();await open();await page.getByRole('combobox',{name:/Filtrar por origem:/}).click();
  await page.getByRole('option',{name:'Manual',exact:true}).click();await expect(sidebar()).toBeVisible();
  assert.equal((await state()).snapshot.source,'manual');assert.deepEqual(await page.evaluate(()=>window.rolloutEvents),[true]);
  await search().fill('Busca aplicada');assert.equal((await state()).snapshot.searchQuery,'');
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
  assert.equal((await state()).snapshot.searchQuery,'Busca aplicada');await expect(trigger()).toHaveAttribute('aria-label',/2 filtros aplicados/);
  assert.deepEqual(await page.evaluate(()=>window.rolloutEvents),[true,false]);
  await open();await sidebar().getByRole('button',{name:'Limpar filtros',exact:true}).click();await expect(sidebar()).toBeVisible();
  assert.equal((await state()).snapshot.source,null);assert.equal((await state()).snapshot.searchQuery,'');
  assert.equal(await page.evaluate(()=>window.rolloutClearCount),1);
});

for(const width of [390,1024])test(`Marketing custom selectors and campaigns keep their owned sidebar open at ${width}px`,async()=>{
  await show({width,consumer:'marketing'});await open();await expect(search()).toHaveCount(0);
  for(const [name,option,key,value] of [
    ['Filtrar por conta de anúncios','Conta de anúncio A','account','account-a'],
    ['Filtrar por Página do Facebook','Página sintética','pageId','page-a'],
    ['Filtrar por objetivo da campanha','Cadastros','objective','LEADS'],
  ]){
    await page.getByRole('combobox',{name:new RegExp('^'+name+':')}).click();
    const input=page.getByRole('combobox',{name:'Buscar opções: '+name,exact:true});await assertOwnedPortal(input);
    await page.getByRole('option',{name:option,exact:true}).click();await expect(sidebar()).toBeVisible();
    const current=await state();assert.equal(key==='pageId'?current.snapshot.pageId:current[key],value);
  }
  await page.getByRole('button',{name:'Todas as campanhas',exact:true}).click();const campaign=page.getByRole('combobox',{name:'Buscar campanha',exact:true});
  await assertOwnedPortal(campaign);await campaign.fill('sintética');await campaign.press('ArrowDown');await campaign.press('Enter');
  assert.deepEqual((await state()).snapshot.campaignIds,['campaign-a']);await expect(sidebar()).toBeVisible();await page.keyboard.press('Escape');
  await save('marketing-sidebar-'+width);
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
});

for(const width of [390,1024])test(`real ConversationFilters keeps lead creation and nested accounts without deleted controls at ${width}px`,async()=>{
  await show({width,consumer:'whatsapp',withoutLead:true});await open();await expect(search()).toHaveCount(0);
  await page.getByRole('combobox',{name:'Filtrar por conta WhatsApp',exact:true}).click();
  const account=page.getByRole('option',{name:'Conta sintética B',exact:true});await assertOwnedPortal(account);await account.click();
  await expect(sidebar()).toBeVisible();assert.equal((await state()).channel,'whatsapp-session-b');
  await expect(page.getByRole('combobox',{name:'Filtrar por conta WhatsApp',exact:true})).toHaveAttribute('data-filter-active','true');
  await expect(sidebar().getByRole('textbox',{name:'Buscar opções de filtro nas conversas',exact:true})).toHaveCount(0);
  await expect(sidebar().getByText('Última mensagem',{exact:true})).toHaveCount(0);
  await expect(sidebar().getByRole('button',{name:/^Período:/})).toHaveCount(0);
  assert.equal((await state()).snapshot.datePreset,null);
  await sidebar().getByText('Arquivadas',{exact:true}).click();assert.equal((await state()).archived,true);
  await expect(sidebar().locator('[data-tour="conversations-archived"]')).toHaveAttribute('data-filter-active','true');
  await page.getByRole('combobox',{name:/Filtrar por origem:/}).click();await page.getByRole('option',{name:'manual',exact:true}).click();
  assert.equal((await state()).withoutLead,false);assert.equal((await state()).snapshot.source,'manual');
  await save('whatsapp-sidebar-'+width);
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
  assert.deepEqual(await page.evaluate(()=>window.rolloutEvents),[true,false]);
  const mainSearch=page.getByRole('textbox',{name:'Buscar conversas',exact:true});await mainSearch.fill('Busca principal preservada');
  assert.equal((await state()).snapshot.searchQuery,'Busca principal preservada');
  const leadPeriod=page.getByRole('button',{name:/^Criação do lead:/});await leadPeriod.click();
  await expect(page.getByRole('grid')).toBeVisible();await page.getByRole('button',{name:'Hoje',exact:true}).click();
  assert.equal((await state()).snapshot.datePreset,'today');await expect(mainSearch).toHaveValue('Busca principal preservada');
});

test('ConversationFilters alone keeps the same open option editor through mobile/desktop layout changes',async()=>{
  await show({width:1024,consumer:'whatsapp'});await open();await sidebar().getByRole('combobox',{name:/Filtrar por corretor:/}).click();
  const field=page.getByRole('combobox',{name:'Buscar corretor por nome ou e-mail',exact:true});
  await field.fill('Editor preservado');await field.evaluate(n=>{window.rolloutEditingNode=n;n.setSelectionRange(3,8);});
  for(const width of [390,1024]){
    await page.setViewportSize({width,height:740});await expect(page.locator('[data-rollout-mobile]')).toHaveAttribute('data-rollout-mobile',String(width<768));
    await expect(sidebar()).toBeVisible();assert.equal(await field.evaluate(n=>n===window.rolloutEditingNode),true);await expect(field).toBeFocused();
    assert.deepEqual(await field.evaluate(n=>[n.selectionStart,n.selectionEnd]),[3,8]);
  }
  assert.deepEqual(await page.evaluate(()=>window.rolloutEvents),[true]);
});

for(const width of [390,1024])test(`ConversationFilters preserves option pagination and its pending guard at ${width}px`,async()=>{
  await show({width,consumer:'whatsapp',optionsHasMore:true,optionsLoadingMore:true});await open();
  const loading=sidebar().getByRole('button',{name:'Carregando opções...',exact:true});await expect(loading).toBeDisabled();
  await expect(loading).toHaveAttribute('aria-busy','true');await loading.evaluate(node=>node.click());assert.equal((await state()).optionsPage,1);
  await show({width,consumer:'whatsapp',optionsHasMore:true});await open();
  const more=sidebar().getByRole('button',{name:'Carregar mais opções',exact:true});await expect(more).toBeEnabled();await more.click();
  assert.equal((await state()).optionsPage,2);await expect(more).toHaveCount(0);await expect(sidebar()).toBeVisible();
});

test('the protected coordinator cancels a deferred chat open after scope navigation',async()=>{
  await show({width:390});await open();await search().fill('Busca antes da saída');
  await page.evaluate(()=>{
    window.rolloutChatOpenCount=0;window.rolloutPanel.requestOpenChat(()=>window.rolloutChatOpenCount++);
    window.rolloutPath='/crm/another-screen';window.dispatchEvent(new Event('rollout-scope'));
  });
  await expect(sidebar()).toHaveCount(0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
  assert.equal(await page.evaluate(()=>window.rolloutChatOpenCount),0);
});

test('rollout runtime makes no external requests and produces no browser exceptions',()=>{
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
});
