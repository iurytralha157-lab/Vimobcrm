import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { open, page, search, show, sidebar, state, trigger } from './harness.mjs';

test('nested source selection, tags and keyboard Escape stay inside the Contacts sidebar',async()=>{
  await show({width:390,height:740});await open();
  const source=page.getByRole('combobox',{name:/Filtrar por origem:/});
  await source.click();
  const options=page.getByRole('combobox',{name:'Buscar opções: Filtrar por origem',exact:true});
  await expect(options).toBeFocused();await options.fill('man');
  await page.getByRole('option',{name:'Manual',exact:true}).click();
  await expect(sidebar()).toBeVisible();assert.equal((await state()).source,'manual');
  await page.getByRole('button',{name:'Todas tags',exact:true}).click();
  const tagSearch=page.getByRole('combobox',{name:'Buscar tag',exact:true});
  await tagSearch.fill('acao');await tagSearch.press('ArrowDown');await page.keyboard.press('Enter');
  assert.deepEqual((await state()).tagIds,['30000000-0000-4000-8000-000000000031']);
  await page.keyboard.press('Escape');
  await expect(tagSearch).toHaveCount(0);await expect(sidebar()).toBeVisible();
  // Explicit close must work even during the short nested-interaction guard.
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
  await expect(sidebar()).toHaveCount(0);await expect(trigger()).toBeFocused();
});

test('invalid search refuses Buscar, explicit X and Escape without applying a broader query',async()=>{
  await show();await open();const field=search();
  await field.fill('x'.repeat(181));
  for(const action of ['done','close','escape']){
    if(action==='done')await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
    else if(action==='close')await sidebar().getByRole('button',{name:'Fechar filtros avançados',exact:true}).click();
    else await page.keyboard.press('Escape');
    await expect(sidebar()).toBeVisible();await expect(field).toHaveAttribute('aria-invalid','true');
    await expect(field).toBeFocused();assert.equal((await state()).searchQuery,'');
  }
  await field.fill('Busca válida');
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
  await expect(sidebar()).toHaveCount(0);assert.equal((await state()).searchQuery,'Busca válida');
  await open();await expect(search()).toHaveValue('Busca válida');
});

test('IME draft is neither committed by composing Enter nor discarded by an explicit close',async()=>{
  await show();await open();const field=search();await field.fill('Composição preservada');
  await field.evaluate(n=>n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'Composição'})));
  for(const event of [{isComposing:true},{keyCode:229}]){
    await field.evaluate((n,event)=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...event})),event);
    assert.equal((await state()).searchQuery,'');
  }
  for(const label of ['Buscar','Fechar filtros avançados']){
    await sidebar().getByRole('button',{name:label,exact:true}).click();
    await expect(sidebar()).toBeVisible();assert.equal((await state()).searchQuery,'');
  }
  const outsideTrigger=page.locator('[data-tour="contacts-advanced-filters"]');
  await outsideTrigger.focus();await outsideTrigger.press('Enter');
  await expect(sidebar()).toBeVisible();assert.equal((await state()).searchQuery,'','the outside desktop trigger also respects composition');
  await field.evaluate(n=>n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'Composição preservada'})));
  await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
  await expect(sidebar()).toHaveCount(0);assert.equal((await state()).searchQuery,'Composição preservada');
});

test('footer clear keeps the panel open, resets draft and preserves the close control',async()=>{
  await show();await page.evaluate(()=>window.sidebarFilters.setSource('manual'));await open();
  await search().fill('Rascunho para limpar');
  await sidebar().getByRole('button',{name:'Limpar filtros',exact:true}).click();
  await expect(sidebar()).toBeVisible();await expect(search()).toHaveValue('');
  assert.equal((await state()).source,null);assert.equal((await state()).searchQuery,'');
  assert.equal(await page.evaluate(()=>window.sidebarClearCount),1);
  await sidebar().getByRole('button',{name:'Fechar filtros avançados',exact:true}).click();
  await expect(sidebar()).toHaveCount(0);await expect(trigger()).toBeFocused();
});

test('ordinary rerenders preserve the open draft and repeated reopen cycles never duplicate portals',async()=>{
  await show({width:320,height:568});await open();await search().fill('Rascunho estável');
  await page.evaluate(()=>window.sidebarRerender());await expect(search()).toHaveValue('Rascunho estável');
  for(let index=0;index<3;index++){
    await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
    await expect(sidebar()).toHaveCount(0);await open();await expect(sidebar()).toHaveCount(1);
    await expect(page.locator('[data-filter-launcher-slot]')).toHaveCount(1);
    await expect(search()).toHaveValue('Rascunho estável');
  }
});

test('open sidebar preserves valid and invalid drafts across mobile/desktop breakpoints without committing',async()=>{
  for(const draft of ['Rascunho no breakpoint','x'.repeat(181)]){
    await show({width:390,height:740});await open();await search().fill(draft);
    for(const width of [1024,320,1440,390]){
      await page.setViewportSize({width,height:740});await expect(sidebar()).toHaveCount(1);
      await expect(search()).toHaveValue(draft);assert.equal((await state()).searchQuery,'');
    }
    if(draft.length>180){
      await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
      await expect(sidebar()).toBeVisible();await expect(search()).toHaveAttribute('aria-invalid','true');
      assert.equal((await state()).searchQuery,'');
    }
  }
});

test('a new layout scope re-registers the already open panel without dropping its draft or placement',async()=>{
  await show({width:1024,height:740});await open();await search().fill('Rascunho no mesmo painel');
  await page.evaluate(()=>{window.sidebarFixturePath='/crm/contacts-layout-transition';window.dispatchEvent(new Event('sidebar-fixture-scope'));});
  await expect(sidebar()).toHaveCount(1);await expect(search()).toHaveValue('Rascunho no mesmo painel');
  await expect.poll(()=>page.evaluate(()=>window.sidebarPanel.active)).toBe(true);
  assert.equal(await page.evaluate(()=>window.sidebarPanel.panelElement===document.querySelector('[data-filter-sidebar="root"]')),true);
  assert.equal((await state()).searchQuery,'');
});

test('mobile sidebar traps focus and restores background access after Escape',async()=>{
  await show({width:320,height:568});await open();
  const outside=page.locator('[data-background-after]');await outside.evaluate(n=>n.focus());
  await expect.poll(()=>sidebar().evaluate(n=>n.contains(document.activeElement))).toBe(true);
  const focusable=sidebar().locator('button:not([disabled]),input:not([disabled]),[tabindex="0"]');
  await focusable.last().focus();await page.keyboard.press('Tab');
  assert.equal(await sidebar().evaluate(n=>n.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');await expect(sidebar()).toHaveCount(0);
  await expect(trigger()).toBeFocused();await outside.focus();await expect(outside).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>document.body.style.pointerEvents)).toBe('');
});
