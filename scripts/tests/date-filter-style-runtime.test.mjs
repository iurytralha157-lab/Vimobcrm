import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { expect } from '@playwright/test';
import { capture, colors, day, errors, externalRequests, grid, independent, open, page, panel, show, trigger } from './date-filter-style-runtime/harness.mjs';

function assertPalette(value,alpha,label){
  assert.deepEqual(value.text,[255,255,255,255],label+' uses white text');
  for(let i=0;i<3;i++)assert.ok(Math.abs(value.background[i]-value.primary[i])<=1,label+' keeps the brand color');
  assert.ok(Math.abs(value.background[3]-Math.round(255*alpha))<=1,label+' has expected opacity '+alpha);
  assert.equal(value.opacity,1,label+' is not dimmed by an ancestor');
}

for(const theme of ['light','dark'])for(const width of [320,390,1024,1440]){
  test(`period visual palette, compact month and actions ${width}/${theme}`,async()=>{
    await show(width,theme);const unrelatedBefore=await independent();await open();
    await expect(grid()).toBeVisible();
    const today=await colors(day(17));
    const gap=await grid().evaluate(n=>{const caption=n.parentElement.querySelector('[role="status"]').parentElement;return n.getBoundingClientRect().top-caption.getBoundingClientRect().bottom;});
    await capture(`period-${width}-${theme}-initial`,{today,middle:await colors(day(6)),gap});
    assertPalette(today,.5,'unselected today');
    for(const date of [5,6,8,10])assertPalette(await colors(day(date)),[5,10].includes(date)?1:.5,'selected range day '+date);
    assert.ok(gap>=0&&gap<=8.5,'caption/weekdays gap is at most 8px, got '+gap);
    const days=await grid().locator('[data-day] button').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return{font:s.fontSize,width:r.width,height:r.height};}));
    assert.ok(days.length>=28);for(const value of days)assert.deepEqual(value,{font:'12px',width:36,height:36});
    const shortcut=panel().getByRole('button',{name:'Ontem',exact:true}),apply=panel().getByRole('button',{name:'Aplicar',exact:true});
    assert.equal((await colors(shortcut)).font,'12px');
    for(const action of await panel().locator('[data-date-action]').all()){
      const value=await colors(action);assert.equal(value.font,'12px');assert.equal(value.weight,'300');assert.equal(value.transform,'none');assert.ok(['normal','0px'].includes(value.spacing));
    }
    assertPalette(await colors(apply),.5,'apply');
    await capture(`period-${width}-${theme}-today-selected`,{today,gap,days,apply:await colors(apply)});
    await day(20).hover();await expect.poll(async()=>(await colors(day(20))).background[3]).toBe(128);assertPalette(await colors(day(20)),.5,'hover day');
    await capture(`period-${width}-${theme}-day-hover`,await colors(day(20)));
    await day(8).hover();assertPalette(await colors(day(8)),.5,'selected interior keeps its half background during hover');
    await shortcut.hover();await expect.poll(async()=>(await colors(shortcut)).background[3]).toBe(128);assertPalette(await colors(shortcut),.5,'hover shortcut');
    await capture(`period-${width}-${theme}-shortcut-hover`,await colors(shortcut));
    await apply.hover();await expect.poll(async()=>(await colors(apply)).background[3]).toBe(255);assertPalette(await colors(apply),1,'hover apply');
    await capture(`period-${width}-${theme}-apply-hover`,await colors(apply));
    await apply.click();await expect(trigger()).toHaveAttribute('aria-expanded','false');
    assert.deepEqual(await page.evaluate(()=>window.dateStyleEvents.map(v=>v[0])),['preset','range']);
    await open();for(const date of [5,6,10])assertPalette(await colors(day(date)),date===6?.5:1,'reopened applied range '+date);
    await capture(`period-${width}-${theme}-applied-range`,await colors(day(5)));
    await page.keyboard.press('Escape');assert.deepEqual(await independent(),unrelatedBefore,'independent Calendar receives no period styling');
  });
}

for(const theme of ['light','dark'])for(const width of [320,390,1024,1440])test(`requested 4 to 17 interval distinguishes endpoints and interiors ${width}/${theme}`,async()=>{
  await show(width,theme,{range:[[2026,9,4],[2026,9,17,23,59,59,999]]});await open();
  for(let date=4;date<=17;date++){
    assertPalette(await colors(day(date)),date===4||date===17?1:.5,'range day '+date);
    const cell=day(date).locator('..');
    if(date>4&&date<17){
      assert.equal(await cell.evaluate(n=>n.classList.contains('!rounded-none')),true,'Calendar range_middle marker remains exclusive to interiors');
      assert.equal((await colors(cell)).background[3],0,'interior cell does not stack a second orange background');
    }else assert.equal(await cell.evaluate(n=>n.classList.contains('!rounded-none')),false,'endpoint never matches the interior marker');
  }
  await capture(`period-${width}-${theme}-range-4-17`,{start:await colors(day(4)),interior:await colors(day(8)),end:await colors(day(17))});
  await day(8).hover();assertPalette(await colors(day(8)),.5,'interior hover');
  await day(4).hover();assertPalette(await colors(day(4)),1,'endpoint hover');
  await day(20).hover();await expect.poll(async()=>(await colors(day(20))).background[3]).toBe(128);assertPalette(await colors(day(20)),.5,'outside-range hover');
  await show(width,theme,{range:[[2026,9,12],[2026,9,12,23,59,59,999]]});await open();
  assertPalette(await colors(day(12)),1,'single selected day');await day(12).hover();assertPalette(await colors(day(12)),1,'single selected day hover');
});

for(const width of [390,1024])test(`selected outside-month range remains solid and white at ${width}`,async()=>{
  await show(width,'light',{range:[[2026,8,29],[2026,9,3,23,59,59,999]]});await open();
  const outside=panel().locator('[data-day="2026-10-03"] button');
  await expect(outside.locator('..')).toHaveAttribute('data-outside','true');
  const value=await colors(outside);await capture(`period-${width}-outside-selected`,value);
  assertPalette(value,1,'selected outside-month day');
  const interiorOutside=panel().locator('[data-day="2026-10-02"] button');
  await expect(interiorOutside.locator('..')).toHaveAttribute('data-outside','true');assertPalette(await colors(interiorOutside),.5,'selected outside-month interior');
  try{
    await page.clock.setFixedTime(new Date('2026-10-01T15:00:00Z'));
    await show(width,'light',{range:[[2026,8,20],[2026,8,21,23,59,59,999]]});await open();
    const todayOutside=panel().locator('[data-day="2026-10-01"] button');
    await expect(todayOutside.locator('..')).toHaveAttribute('data-outside','true');await expect(todayOutside.locator('..')).toHaveAttribute('data-today','true');
    const todayValue=await colors(todayOutside);await capture(`period-${width}-outside-today`,todayValue);assertPalette(todayValue,.5,'unselected outside-month today');
  }finally{await page.clock.setFixedTime(new Date('2026-10-17T15:00:00Z'));}
});

for(const width of [390,1024])test(`selected preset stays solid and toggles off independently at ${width}`,async()=>{
  await show(width,'light',{preset:'today'});await open();
  const selected=panel().getByRole('button',{name:'Hoje',exact:true});await expect(selected).toHaveAttribute('aria-pressed','true');
  assertPalette(await colors(selected),1,'selected shortcut');assertPalette(await colors(day(17)),1,'today selected by preset');
  if(width>=768){await expect(selected.locator('svg')).toHaveAttribute('stroke','currentColor');assert.deepEqual((await colors(selected.locator('svg'))).text,[255,255,255,255]);}
  await selected.hover();assertPalette(await colors(selected),1,'selected shortcut hover');await selected.click();
  await expect(trigger()).toHaveAttribute('data-filter-active','false');
  assert.deepEqual(await page.evaluate(()=>window.dateStyleState),{preset:null,range:null});
});

for(const width of [320,1440])test(`one clear action resets the draft and applied period beside apply at ${width}`,async()=>{
  await show(width);await open();
  if(width>=768){
    const shortcuts=panel().getByRole('button',{name:'Este ano',exact:true}).locator('..');
    await expect(shortcuts.getByRole('button',{name:'Limpar período',exact:true})).toHaveCount(0);
  }
  await expect(panel().getByRole('button',{name:'Limpar período',exact:true})).toHaveCount(1);
  await expect(panel().getByRole('button',{name:'Limpar seleção',exact:true})).toHaveCount(0);
  const actionRow=panel().locator('[data-date-actions]');
  await expect(actionRow.getByRole('button',{name:'Limpar período',exact:true})).toBeVisible();await expect(actionRow.getByRole('button',{name:'Aplicar',exact:true})).toBeVisible();
  await day(20).click();assert.deepEqual(await page.evaluate(()=>window.dateStyleEvents),[],'draft changes alone do not apply');
  await panel().getByRole('button',{name:'Limpar período',exact:true}).click();await expect(panel()).toHaveCount(0);
  assert.deepEqual(await page.evaluate(()=>window.dateStyleState),{preset:null,range:null});
  assert.deepEqual(await page.evaluate(()=>window.dateStyleEvents),[['preset',null],['range',null]]);
  await open();await expect(grid().locator('[data-selected]')).toHaveCount(0);await expect(panel().getByRole('button',{name:'Aplicar',exact:true})).toBeDisabled();
});

test('preset-only layout keeps an applied reset outside the desktop shortcut column',async()=>{
  await show(1024,'dark',{preset:'today',showCalendar:false});await open();await expect(grid()).toHaveCount(0);
  const shortcuts=panel().getByRole('button',{name:'Este ano',exact:true}).locator('..');
  await expect(shortcuts.getByRole('button',{name:'Limpar período',exact:true})).toHaveCount(0);
  await panel().getByRole('button',{name:'Limpar período',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.dateStyleState),{preset:null,range:null});
});

test('Calendar primitive has no period-specific dependency and the runtime stays offline',async()=>{
  const source=await readFile(new URL('../../components/ui/calendar.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/date-filter-style|data-date-filter|data-date-calendar/);
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
});
