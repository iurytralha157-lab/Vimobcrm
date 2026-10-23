import assert from 'node:assert/strict';
import { after, before } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),require=createRequire(import.meta.url);
const proof=process.env.VIMOB_PERIOD_STYLE_PROOF_DIR;
const component=process.env.VIMOB_PERIOD_STYLE_COMPONENT;
const rules=process.env.VIMOB_PERIOD_STYLE_RULES;
let directory,browser;
export let page;
export const errors=[],externalRequests=[];
export const panel=()=>page.locator('.vimob-popover-content');
export const grid=()=>panel().getByRole('grid');
export const day=value=>panel().locator('[data-day="2026-10-'+String(value).padStart(2,'0')+'"] button');
export const trigger=()=>page.getByRole('button',{name:/^Período:/});

const fixture=`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{DateFilterPopover}from'@/components/ui/date-filter-popover';import{Calendar}from'@/components/ui/calendar';
function Fixture({config}){
 const[preset,setPreset]=useState(config.preset===undefined?'custom':config.preset);
 const[range,setRange]=useState(config.range?{from:new Date(...config.range[0]),to:new Date(...config.range[1])}:config.preset===undefined?{from:new Date(2026,9,5),to:new Date(2026,9,10,23,59,59,999)}:null);
 window.dateStyleState={preset,range};
 return <main className='app-shell' style={{padding:12}}><DateFilterPopover datePreset={preset} customDateRange={range} defaultPreset={null} showCalendar={config.showCalendar!==false}
  onDatePresetChange={value=>{window.dateStyleEvents.push(['preset',value]);setPreset(value);}}
  onCustomDateRangeChange={value=>{window.dateStyleEvents.push(['range',value]);setRange(value);}}/>
  <aside data-independent-calendar style={{position:'absolute',top:56,left:12}}><Calendar mode='range' defaultMonth={new Date(2026,9,1)} selected={{from:new Date(2026,9,5),to:new Date(2026,9,10)}}/></aside>
 </main>;
}
const root=createRoot(document.getElementById('app'));let generation=0;
window.showDateStyle=config=>{window.dateStyleEvents=[];root.render(<Fixture config={config} key={++generation}/>);};window.showDateStyle({});
`;

before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'vimob-date-style-'));if(proof)await mkdir(proof,{recursive:true});
  const entry=path.join(directory,'fixture.tsx'),loader=path.join(directory,'loader.cjs');await writeFile(entry,fixture);
  await writeFile(loader,`const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  const{webpack}=require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},
      resolve:{extensions:['.tsx','.ts','.js'],alias:{...(component?{'@/components/ui/date-filter-popover$':path.resolve(component)}:{}),...(rules?{'@/components/shared/filters/date-filter-style$':path.resolve(rules)}:{}),'@':root},modules:[path.join(root,'node_modules'),'node_modules']},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},optimization:{minimize:false}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const cssSource=(await readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['components/ui/date-filter-popover.tsx','components/ui/calendar.tsx','components/ui/button.tsx','components/ui/popover.tsx','components/shared/filters/date-filter-style.ts','config/filter-ui.ts'];
  if(component)sources.push(path.resolve(component));
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(cssSource+'\n'+sources.map(s=>'@source '+JSON.stringify((path.isAbsolute(s)?s:path.join(root,s)).replaceAll('\\','/'))+';').join('\n'),{from:path.join(root,'app/date-style-offline-fixture.css')});
  const font=await readFile(path.join(root,'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'));
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:1000},timezoneId:'America/Sao_Paulo',reducedMotion:'reduce'});
  page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url()==='http://date-style.local/'
    ?route.fulfill({contentType:'text/html',body:'<style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,'+font.toString('base64')+')} :root{--font-geist-sans:Geist}'+css.css+'</style><div id="app"></div>'})
    :(externalRequests.push(route.request().url()),route.abort()));
  await page.goto('http://date-style.local/');await page.clock.setFixedTime(new Date('2026-10-17T15:00:00Z'));
  await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});await page.evaluate(()=>document.fonts.ready);await trigger().waitFor();
},{timeout:300000});

after(async()=>{
  await browser?.close();if(directory){const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.match(path.basename(resolved),/^vimob-date-style-/);await rm(resolved,{recursive:true,force:true});}
});

export async function show(width,theme='light',config={}){
  await page.keyboard.press('Escape');await page.setViewportSize({width,height:1000});
  await page.evaluate(({theme,config})=>{document.documentElement.className=theme;window.showDateStyle(config);},{theme,config});
  await expect(trigger()).toHaveAttribute('aria-expanded','false');await page.mouse.move(1,1);
}
export async function open(){await trigger().click();await expect(panel()).toBeVisible();}
export async function capture(name,values){if(proof){await page.screenshot({path:path.join(proof,name+'.png')});await writeFile(path.join(proof,name+'.json'),JSON.stringify(values,null,2));}}

export async function colors(locator){return locator.evaluate(n=>{
  const pixel=color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,1,1);return[...c.getImageData(0,0,1,1).data];};
  const s=getComputedStyle(n),sample=document.createElement('i');sample.style.background='var(--primary)';document.body.append(sample);const primary=pixel(getComputedStyle(sample).backgroundColor);sample.remove();
  let opacity=1;for(let parent=n;parent;parent=parent.parentElement)opacity*=Number(getComputedStyle(parent).opacity);
  return{background:pixel(s.backgroundColor),text:pixel(s.color),primary,opacity,font:s.fontSize,weight:s.fontWeight,transform:s.textTransform,spacing:s.letterSpacing,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height};
});}

export async function independent(){return page.locator('[data-independent-calendar]').evaluate(n=>[...n.querySelectorAll('[data-day] button')].map(b=>{const s=getComputedStyle(b);return{day:b.parentElement.dataset.day,font:s.fontSize,color:s.color,background:s.backgroundColor,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height};}));}
