import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { errors, externalRequests, open, page, search, show, sidebar, state, trigger } from './contacts-sidebar-runtime/harness.mjs';

async function resize(width) {
  await page.setViewportSize({width,height:740});
  await expect(page.locator('[data-fixture-mobile]')).toHaveAttribute('data-fixture-mobile',String(width<768));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

for(const [from,to] of [[390,1024],[1024,390]]) {
  test(`sidebar preserves the same focused input and partial selection ${from} to ${to}`,async()=>{
    await show({width:from,height:740});await open();await search().fill('Primeiro texto');
    await search().evaluate(n=>{window.sidebarEditingNode=n;n.setSelectionRange(4,9);});
    await resize(to);
    assert.equal(await search().evaluate(n=>n===window.sidebarEditingNode),true,'editing node is never replaced');
    await expect(search()).toBeFocused();
    assert.deepEqual(await search().evaluate(n=>[n.selectionStart,n.selectionEnd]),[4,9]);
    await page.keyboard.insertText('NOVO');await expect(search()).toHaveValue('PrimNOVOtexto');
    assert.equal((await state()).searchQuery,'','resizing does not apply a draft');
  });
  test(`native IME commit replaces the same composition after resizing ${from} to ${to}`,async()=>{
    await show({width:from,height:740});await open();await search().focus();
    const cdp=await page.context().newCDPSession(page);
    try{
      await cdp.send('Input.imeSetComposition',{text:'にほん',selectionStart:3,selectionEnd:3});
      await expect(search()).toHaveValue('にほん');await search().evaluate(n=>window.sidebarCompositionNode=n);
      await resize(to);
      assert.equal(await search().evaluate(n=>n===window.sidebarCompositionNode),true);
      await expect(search()).toBeFocused();
      await cdp.send('Input.insertText',{text:'日本'});await expect(search()).toHaveValue('日本');
      assert.equal((await state()).searchQuery,'');
      await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
      await expect(sidebar()).toHaveCount(0);assert.equal((await state()).searchQuery,'日本');
    }finally{await cdp.detach();}
  });
  test(`an open source picker retains its editor and accessible portal ${from} to ${to}`,async()=>{
    await show({width:from,height:740});await open();
    await page.getByRole('combobox',{name:/Filtrar por origem:/}).click();
    const picker=page.getByRole('combobox',{name:'Buscar opções: Filtrar por origem',exact:true});
    await picker.fill('ma');await picker.evaluate(n=>{window.sidebarPickerNode=n;n.setSelectionRange(2,2);});
    await resize(to);
    await expect(picker).toBeVisible();await expect(picker).toBeFocused();
    assert.equal(await picker.evaluate(n=>n===window.sidebarPickerNode),true);
    assert.equal(await picker.evaluate(n=>Boolean(n.closest('[aria-hidden="true"]'))),false,'owned portal remains exposed to assistive technology');
    assert.deepEqual(await picker.evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,2]);
    await page.keyboard.insertText('n');await expect(picker).toHaveValue('man');
    await page.getByRole('option',{name:'Manual',exact:true}).click();
    assert.equal((await state()).source,'manual');await expect(sidebar()).toBeVisible();
    await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();await expect(sidebar()).toHaveCount(0);
  });
}

test('mobile isolation activates without replacing a focused desktop input and retires without changing its caret',async()=>{
  await show({width:1024,height:740});await open();await search().fill('Cursor preservado');
  await search().evaluate(n=>n.setSelectionRange(6,6));await resize(390);
  const outside=page.locator('[data-background-after]');await outside.evaluate(n=>n.focus());
  assert.equal(await sidebar().evaluate(n=>n.contains(document.activeElement)),true);
  const fields=sidebar().locator('button:visible:not([disabled]),input:visible:not([disabled]),textarea:visible:not([disabled])');
  await fields.last().focus();await page.keyboard.press('Tab');await expect(fields.first()).toBeFocused();
  await fields.first().focus();await page.keyboard.press('Shift+Tab');await expect(fields.last()).toBeFocused();
  await search().focus();await search().evaluate(n=>n.setSelectionRange(6,6));await resize(1024);
  await expect(search()).toBeFocused();assert.deepEqual(await search().evaluate(n=>[n.selectionStart,n.selectionEnd]),[6,6]);
  await outside.focus();await expect(outside).toBeFocused();
});

test('mobile outside close applies the draft and restores its filter trigger',async()=>{
  await show({width:390,height:740});await open();await search().fill('Aplicar ao sair');
  assert.ok((await sidebar().boundingBox()).x>2,'mobile leaves a clickable overlay strip');
  await page.mouse.click(2,200);await expect(sidebar()).toHaveCount(0);
  assert.equal((await state()).searchQuery,'Aplicar ao sair');await expect(trigger()).toBeFocused();
});

test('an already open owned picker remains scrollable after entering mobile',async()=>{
  await show({width:1024,height:740});await open();
  await page.getByRole('combobox',{name:/Filtrar por origem:/}).click();
  const list=page.getByRole('listbox',{name:'Suggestions',exact:true});
  await list.evaluate(n=>{n.style.maxHeight='32px';n.style.height='32px';n.style.overflowY='auto';});
  await resize(390);await expect(list).toBeVisible();
  await list.hover();await page.mouse.wheel(0,80);await expect.poll(()=>list.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');await sidebar().getByRole('button',{name:'Buscar',exact:true}).click();
  await expect(sidebar()).toHaveCount(0);
});

test('mobile outside close still rejects invalid search and does not apply it',async()=>{
  await show({width:390,height:740});await open();await search().fill('a'.repeat(181));
  await page.mouse.click(2,200);await expect(sidebar()).toBeVisible();await expect(search()).toBeFocused();
  assert.equal((await state()).searchQuery,'');
});

test('mobile close never takes focus from another dialog opened before exit',async()=>{
  await show({width:390,height:740});await open();
  await page.evaluate(async()=>{
    document.querySelector('[data-filter-sidebar-complete]').click();
    await Promise.resolve();
    const dialog=document.createElement('div');dialog.role='dialog';dialog.dataset.editingOtherDialog='true';
    const button=document.createElement('button');button.textContent='Outro diálogo';dialog.append(button);
    document.body.append(dialog);button.focus();
  });
  await expect(sidebar()).toHaveCount(0);await expect(page.locator('[data-editing-other-dialog] button')).toBeFocused();
  await page.locator('[data-editing-other-dialog]').evaluate(n=>n.remove());
});

test('editing regressions produce no browser errors or external requests',()=>{
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
});
