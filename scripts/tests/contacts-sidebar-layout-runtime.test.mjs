import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real Toolbar/SharedFilters/Radix/CSS, with synthetic permissions only.
// Keep the existing shared fixture untouched and all transport blocked.
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const directory=await mkdtemp(path.join(tmpdir(),'vimob-contacts-sidebar-layout-'));
const proof=process.env.VIMOB_CONTACTS_LAYOUT_PROOF_DIR||null;
let harness=await readFile(path.join(repository,'scripts/tests/contacts-sidebar-runtime/harness.mjs'),'utf8');
const playwright=pathToFileURL(require.resolve('@playwright/test')).href;
harness=harness.replace("import { chromium, expect } from '@playwright/test';",()=>`import playwright from ${JSON.stringify(playwright)};const{chromium,expect}=playwright;`)
  .replace('createRequire(import.meta.url)',()=>`createRequire(${JSON.stringify(path.join(repository,'package.json'))})`)
  .replace("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')",()=>JSON.stringify(repository))
  .replaceAll('tmpdir()',JSON.stringify(directory));
assert.ok(harness.includes(JSON.stringify(repository)),'fixture remains tied to this checkout');
let fixture=await readFile(path.join(repository,'scripts/tests/contacts-sidebar-runtime/fixture.mjs'),'utf8');
fixture=fixture.replace('canImportLeads={false} canExportLeads={false}','canImportLeads={config.canImport===true} canExportLeads={config.canExport===true}');
assert.ok(fixture.includes('canImportLeads={config.canImport===true}'),'optional toolbar actions are exercised');
await writeFile(path.join(directory,'fixture.mjs'),fixture);
await writeFile(path.join(directory,'harness.mjs'),harness);
const ui=await import(pathToFileURL(path.join(directory,'harness.mjs')).href);
after(async()=>{
  const target=path.resolve(directory);
  assert.equal(path.dirname(target),path.resolve(tmpdir()));
  assert.match(path.basename(target),/^vimob-contacts-sidebar-layout-/);
  await rm(target,{recursive:true,force:true});
});
async function screenshot(name){if(proof){await mkdir(proof,{recursive:true});await ui.page.screenshot({path:path.join(proof,name+'.png')});}}

test('toolbar controls never overlap the count or each other in a constrained desktop container',async()=>{
  const page=ui.page;
  for(const width of [768,800,900,1024,1280])for(const menuWidth of [56,208])for(const imports of [false,true]){
    await ui.show({width,height:740,canImport:imports,canExport:imports});
    await page.evaluate(({width,menuWidth})=>{
      Object.assign(document.querySelector('main').style,{marginLeft:`${menuWidth+24}px`,width:`${width-menuWidth-48}px`,padding:'0px'});
      window.sidebarFilters.setCustomDateRange({from:new Date(2025,9,1),to:new Date(2026,8,30)});
      window.sidebarFilters.setSource('manual');
    },{width,menuWidth});
    await expect(page.getByRole('button',{name:'Período: 01/10/2025 - 30/09/2026',exact:true})).toBeVisible();
    const result=await page.locator('.app-toolbar').evaluate(toolbar=>{
      const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
      return{area:rect(toolbar),controls:[toolbar.querySelector('[data-tour="contacts-count"]'),...toolbar.querySelectorAll('button')].map(n=>({label:n.getAttribute('aria-label')||n.textContent,...rect(n)}))};
    });
    for(const control of result.controls){assert.ok(control.x>=result.area.x-1&&control.right<=result.area.right+1,`control fits ${width}/${menuWidth}/${imports}: ${JSON.stringify(control)}`);}
    for(let index=0;index<result.controls.length;index++)for(const other of result.controls.slice(index+1)){
      const current=result.controls[index];
      const overlap=Math.min(current.right,other.right)-Math.max(current.x,other.x)>0.5&&Math.min(current.bottom,other.bottom)-Math.max(current.y,other.y)>0.5;
      assert.equal(overlap,false,`no overlap ${width}/${menuWidth}/${imports}: ${current.label} / ${other.label}`);
    }
    if(width===768&&menuWidth===208)await screenshot(`toolbar-narrow-${imports}`);
  }
});

test('mobile and desktop Tab follow visual toolbar order when import and export are enabled',async()=>{
  const page=ui.page;
  for(const width of [320,390,768,1024]){
    await ui.show({width,height:740,canImport:true,canExport:true});
    await page.locator('[data-background-before]').focus();const sequence=[];
    for(let index=0;index<4;index++){
      await page.keyboard.press('Tab');
      sequence.push(await page.evaluate(()=>{const n=document.activeElement,r=n.getBoundingClientRect();return{tour:n.dataset.tour,x:r.x,y:r.y};}));
    }
    assert.deepEqual(sequence.map(item=>item.tour),width<768
      ?['contacts-date-filter','contacts-advanced-filters','contacts-new','contacts-import']
      :['contacts-import','contacts-date-filter','contacts-advanced-filters','contacts-new']);
    for(let index=1;index<sequence.length;index++){
      const previous=sequence[index-1],current=sequence[index];
      assert.ok(current.y>previous.y-1&&(current.y>previous.y+1||current.x>=previous.x-1),'focus follows the rendered rows');
    }
  }
});

test('responsive group moves preserve trigger identity and focus, plus the open search input draft',async()=>{
  const page=ui.page;
  await ui.show({width:390,height:740});
  await ui.trigger().evaluate(n=>window.layoutOriginalTrigger=n);
  await ui.trigger().focus();
  for(const width of [1024,390,768,320]){
    await page.setViewportSize({width,height:740});
    await expect(page.locator('[data-fixture-mobile]')).toHaveAttribute('data-fixture-mobile',String(width<768));
    assert.equal(await ui.trigger().evaluate(n=>n===window.layoutOriginalTrigger),true,'SharedFilters trigger never remounts');
    await expect(ui.trigger()).toBeFocused();
  }
  await ui.open();await ui.search().fill('Rascunho antes de redimensionar');
  await ui.search().evaluate(n=>window.layoutOriginalSearch=n);
  for(const width of [1024,390,768,320]){
    await page.setViewportSize({width,height:740});await expect(ui.sidebar()).toBeVisible();
    await expect(ui.search()).toHaveValue('Rascunho antes de redimensionar');
    assert.equal(await ui.search().evaluate(n=>n===window.layoutOriginalSearch),true,'the open search node survives viewport changes');
    assert.equal((await ui.state()).searchQuery,'');
  }
});

test('sidebar action and auxiliary text meet text contrast in light and dark themes',async()=>{
  const page=ui.page;const axe=await readFile(require.resolve('axe-core/axe.min.js'),'utf8');await page.addScriptTag({content:axe});
  for(const theme of ['light','dark'])for(const width of [320,1024]){
    await ui.show({width,height:740,theme});await ui.open();
    await page.evaluate(()=>window.sidebarFilters.setSource('manual'));
    await expect(page.getByRole('combobox',{name:'Filtrar por origem: Manual',exact:true})).toBeVisible();
    const violations=await page.evaluate(async()=>{
      const result=await axe.run('[data-filter-sidebar="root"]',{runOnly:{type:'rule',values:['color-contrast']}});
      return result.violations.map(rule=>({id:rule.id,nodes:rule.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}));
    });
    assert.deepEqual(violations,[],`${theme}/${width} contrast`);
    const done=ui.sidebar().getByRole('button',{name:'Buscar',exact:true});
    await done.hover();
    const hovered=await page.evaluate(async()=>{
      const result=await axe.run('[data-filter-sidebar="footer"]',{runOnly:{type:'rule',values:['color-contrast']}});
      return result.violations.map(rule=>rule.nodes.map(node=>node.failureSummary));
    });
    assert.deepEqual(hovered,[],`${theme}/${width} hover contrast`);
    await screenshot(`sidebar-contrast-${theme}-${width}`);
    await page.getByRole('combobox',{name:'Filtrar por origem: Manual',exact:true}).click();
    await page.getByRole('combobox',{name:'Buscar opções: Filtrar por origem',exact:true}).fill('Sem resultado sintético');
    const popupContrast=await page.evaluate(async()=>{
      const result=await axe.run('.vimob-popover-content[data-filter-layer^="sidebar-"]',{runOnly:{type:'rule',values:['color-contrast']}});
      return result.violations.map(rule=>rule.nodes.map(node=>node.failureSummary));
    });
    assert.deepEqual(popupContrast,[],`${theme}/${width} child empty state contrast`);
    await page.keyboard.press('Escape');
  }
});

test('sidebar visual styling keeps a visible mobile gutter, centered search and scoped seamless dropdowns',async()=>{
  const page=ui.page;
  const cdp=await page.context().newCDPSession(page);
  try {
  for(const theme of ['light','dark'])for(const viewport of [{width:320,height:420},{width:390,height:740},{width:1024,height:740},{width:320,height:420,safe:true}]){
    await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:viewport.safe?{top:24,left:30,right:30,bottom:34}:{}});
    await ui.show({...viewport,theme});
    await page.locator('main').evaluate((n,theme)=>{n.style.background=theme==='light'?'linear-gradient(120deg, #edf2f8, #f9e8dc 48%, #e4eee7)':'linear-gradient(120deg, #20242a, #342821 48%, #202e28)';},theme);
    await ui.open();
    const panel=await ui.sidebar().evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,width:r.width,border:s.borderWidth,background:s.backgroundColor,backdrop:s.backdropFilter};});
    assert.ok(Math.abs(panel.width-Math.min(400,viewport.width*.9))<1);assert.ok(panel.x>=24,'mobile background remains visible');
    assert.equal(panel.border,'0px');assert.match(panel.background,/0\.86/);assert.match(panel.backdrop,/blur\(12px\)/);
    await expect(ui.sidebar().locator('[data-filter-sidebar-count]')).toHaveCount(0);
    await ui.search().scrollIntoViewIfNeeded();
    const searchAlignment=await page.locator('[data-filter-search-container]').evaluate(n=>{const i=n.querySelector('input').getBoundingClientRect(),icon=n.querySelector('[data-filter-search-icon]').getBoundingClientRect();return Math.abs(i.y+i.height/2-icon.y-icon.height/2);});
    assert.ok(searchAlignment<=1,'search icon is vertically centered against the input only');
    await page.evaluate(()=>window.sidebarFilters.setSource('manual'));
    const source=page.getByRole('combobox',{name:'Filtrar por origem: Manual',exact:true});await expect(source).toHaveAttribute('data-filter-active','true');
    const expectedSelected=await source.evaluate(n=>{
      const sample=document.createElement('span');sample.style.background='color-mix(in srgb, var(--primary) 50%, transparent)';n.append(sample);
      const expected=getComputedStyle(sample).backgroundColor;sample.remove();return expected;
    });
    await expect.poll(()=>source.evaluate(n=>getComputedStyle(n).backgroundColor),{message:'selected field settles at brand orange fifty percent after its existing color transition'}).toBe(expectedSelected);
    await source.click();
    const popup=page.locator('.vimob-popover-content[data-filter-layer^="sidebar-"]');await expect(popup).toBeVisible();
    assert.equal(await popup.evaluate(n=>getComputedStyle(n).borderWidth),'0px');
    assert.equal(await popup.locator('[cmdk-input-wrapper]').evaluate(n=>getComputedStyle(n).borderBottomWidth),'0px');
    const popupBox=await popup.boundingBox();assert.ok(popupBox.x>=panel.x-1&&popupBox.x+popupBox.width<=viewport.width-(viewport.safe?30:0)+1,'dropdown stays inside panel and safe area');
    await page.keyboard.press('Escape');await screenshot(`sidebar-visual-${theme}-${viewport.width}${viewport.safe?'-safe':''}`);
  }
  } finally { await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{}});await cdp.detach(); }
});

test('sidebar contrast overrides do not change explicit legacy popover theme tokens',async()=>{
  await ui.show({width:1024,height:740,presentation:'popover',theme:'light'});await ui.trigger().click();
  const field=ui.search();await expect(field).toBeVisible();
  const tertiary=await field.evaluate(n=>getComputedStyle(n.closest('[data-filter-layer]')).getPropertyValue('--app-text-tertiary').trim());
  assert.equal(tertiary,'rgb(21 21 21 / 0.46)','presentation rules remain scoped to sidebar');
});

test('layout regression transport stays offline and has no browser exception',()=>{
  assert.deepEqual(ui.errors,[]);assert.deepEqual(ui.externalRequests,[]);
});
