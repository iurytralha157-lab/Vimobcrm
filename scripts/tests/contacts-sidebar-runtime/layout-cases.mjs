import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { bounds, open, page, save, show, sidebar, state, trigger } from './harness.mjs';

for (const viewport of [
  {width:320,height:568},{width:390,height:844},{width:1024,height:768},
  {width:1440,height:900},{width:1024,height:420},{width:320,height:420},
  {width:768,height:720},{width:1280,height:800},
  {width:390,height:844,theme:'dark'},{width:1440,height:900,theme:'dark'},
]) test(`Contacts sidebar stays right with fixed header/footer and scrolling body ${viewport.width}x${viewport.height} ${viewport.theme||'light'}`,async()=>{
  await show(viewport);
  const period=page.getByRole('button',{name:/^Período:/}),before=await state();
  await expect(period).toHaveCount(1);
  await expect(page.getByRole('button',{name:viewport.width<768?'Novo':'Novo Lead',exact:true})).toHaveCount(1);
  await open();
  const dialog=sidebar(),header=dialog.locator('[data-filter-sidebar="header"]'),body=dialog.locator('[data-filter-sidebar="body"]'),footer=dialog.locator('[data-filter-sidebar="footer"]');
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole('button',{name:'Fechar filtros avançados',exact:true})).toHaveCount(1);
  await expect(footer.getByRole('button',{name:'Buscar',exact:true})).toBeVisible();
  const box=await bounds(dialog),head=await bounds(header),foot=await bounds(footer);
  assert.ok(Math.abs(box.x+box.width-viewport.width)<=1,'sidebar is attached to the right');
  assert.ok(box.x>=0&&box.y>=0&&box.y+box.height<=viewport.height+1,'sidebar fits the viewport');
  if(viewport.width<768)assert.ok(Math.abs(box.width-Math.min(400,viewport.width*0.9))<=1,'mobile keeps a visible strip of the page beside the panel');
  else assert.ok(box.width<=440,'desktop remains a narrow panel');
  assert.equal(await body.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'fields never overflow horizontally');
  const scroll=await body.evaluate(n=>{n.scrollTop=n.scrollHeight;return{top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight};});
  if(viewport.height<=568)assert.ok(scroll.top>0&&scroll.total>scroll.height,'short viewports have real body scrolling');
  assert.deepEqual(await bounds(header),head,'body scrolling leaves the header fixed');
  assert.deepEqual(await bounds(footer),foot,'body scrolling leaves the footer fixed');
  await save(`sidebar-${viewport.width}x${viewport.height}-${viewport.theme||'light'}`);
  await footer.getByRole('button',{name:'Buscar',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger()).toBeFocused();
  assert.deepEqual(await state(),before,'opening and closing never applies new filters');
});

test('real Contacts toolbar matches the requested compact control and creation styles',async()=>{
  for(const width of [390,1440]){
    await show({width,height:740});
    const controls=[page.getByRole('button',{name:/^Período:/}),trigger()];
    for(const control of controls){
      assert.deepEqual(await control.evaluate(n=>{const s=getComputedStyle(n),icon=n.querySelector('svg').getBoundingClientRect();return{height:n.getBoundingClientRect().height,font:s.fontSize,weight:s.fontWeight,radius:s.borderRadius,iconWidth:icon.width,iconHeight:icon.height};}),
        {height:32,font:'10px',weight:'300',radius:'6px',iconWidth:14,iconHeight:14});
    }
    const create=page.getByRole('button',{name:width<768?'Novo':'Novo Lead',exact:true});
    assert.deepEqual(await create.evaluate(n=>{const s=getComputedStyle(n),icon=n.querySelector('svg').getBoundingClientRect();return{height:n.getBoundingClientRect().height,font:s.fontSize,weight:s.fontWeight,radius:s.borderRadius,iconWidth:icon.width};}),
      {height:32,font:'11px',weight:'300',radius:'6px',iconWidth:16});
    await save(`toolbar-${width}`);
  }
});

test('Contacts period remains a calendar popup and preserves unrelated criteria',async()=>{
  await show({width:390,height:740});
  await page.evaluate(()=>window.sidebarFilters.setSource('manual'));
  await page.getByRole('button',{name:/^Período:/}).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(sidebar()).toHaveCount(0);
  await save('period-mobile-popup');
  await page.getByRole('button',{name:'Hoje',exact:true}).click();
  assert.equal((await state()).datePreset,'today');
  assert.equal((await state()).source,'manual');
  await expect(page.getByRole('grid')).toHaveCount(0);
});

test('an explicit override retains the legacy advanced popover presentation',async()=>{
  await show({presentation:'popover',width:1024,height:720});
  await trigger().click();
  await expect(page.getByText('Filtros Avançados',{exact:true})).toBeVisible();
  await expect(page.locator('[data-filter-sidebar]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Buscar',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(trigger()).toBeFocused();
});

test('opening Contacts filters never creates forbidden or duplicate creation actions',async()=>{
  await show({canCreate:false,width:320,height:568});
  await expect(page.getByRole('button',{name:/^Novo(?: Lead)?$/})).toHaveCount(0);
  await open();
  await expect(page.getByRole('button',{name:/^Novo(?: Lead)?$/})).toHaveCount(0);
  await expect(sidebar()).toHaveCount(1);
});
