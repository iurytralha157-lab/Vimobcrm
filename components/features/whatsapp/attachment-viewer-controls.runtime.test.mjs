import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const require=createRequire(import.meta.url),repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {webpack}=require('next/dist/compiled/webpack/webpack.js');
let directory,browser,bundle,css;
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'vimob-media-controls-'));
  const loader=join(directory,'loader.cjs'),entry=join(directory,'entry.js'),image=join(directory,'image.js'),media=join(directory,'media.js');
  await writeFile(loader,`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(image,`import React from 'react';export default function Image({unoptimized,...p}){return React.createElement('img',p);}`);
  await writeFile(media,`export {getSafeMessageMediaUrl,sanitizeMediaFilename} from ${JSON.stringify(join(repository,'components/features/whatsapp/message-media.ts'))};
    export const downloadMessageMedia=async p=>{h.calls.push(['download',p.filename,p.kind,p.signal.aborted]);if(h.downloadFailure)throw new Error('Download sintético falhou');return 'downloaded';};`);
  await writeFile(entry,`import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{AttachmentPreviewComposer}from${JSON.stringify(join(repository,'components/features/whatsapp/AttachmentPreviewComposer.tsx'))};
    import{MediaViewer}from${JSON.stringify(join(repository,'components/features/whatsapp/MediaViewer.tsx'))};
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
    const root=createRoot(document.getElementById('root'));window.h={props:{},calls:[],downloadFailure:false,render(p=this.props){this.props=p;flushSync(()=>root.render(React.createElement(Host)));}};
    const refresh=async()=>{h.calls.push(['refresh']);return png;};
    const gallery=[{id:'image-a',url:png,type:'image',filename:'Primeira.png',refresh},{id:'image-b',url:png,type:'image',filename:'Segunda.png',refresh}];
    function Host(){const p=h.props;if(p.mode==='viewer')return React.createElement(MediaViewer,{src:png,type:'image',isOpen:p.open!==false,messageId:'image-a',filename:'Primeira.png',gallery,galleryScopeKey:'synthetic-actor/org/chat-a',onRefreshMedia:refresh,onClose:()=>{h.calls.push(['close']);h.render({...h.props,open:false});}});
      const entries=(p.entries||[{id:1,name:'Documento.txt',caption:''}]).map(e=>({...e,file:new File(['synthetic'],e.name,{type:'text/plain'}),url:null}));
      return React.createElement(AttachmentPreviewComposer,{attachments:{entries,busy:!!p.busy,disabled:!!p.disabled,error:p.error||'',setCaption:(id,value)=>{h.calls.push(['caption',id,value]);h.render({...h.props,entries:entries.map(e=>({id:e.id,name:e.file.name,caption:e.id===id?value:e.caption,outcome:e.outcome}))});},remove:id=>{h.calls.push(['remove',id]);h.render({...h.props,entries:entries.filter(e=>e.id!==id).map(e=>({id:e.id,name:e.file.name,caption:e.caption}))});},send:async()=>{h.calls.push(['send',entries.map(e=>[e.id,e.caption])]);}}});}
  `);
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',entry,output:{path:directory,filename:'controls.js',publicPath:''},resolve:{symlinks:false,extensions:['.tsx','.ts','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{'next/image':image,'./message-media$':media,'@':repository}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]},plugins:[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})]});compiler.run((error,stats)=>compiler.close(()=>error?reject(error):stats.hasErrors()?reject(new Error(stats.toString({all:false,errors:true}))):done()));});
  bundle=await readFile(join(directory,'controls.js'),'utf8');
  const globals=(await readFile(join(repository,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  css=(await require('postcss')([require('@tailwindcss/postcss')({base:repository})]).process(`${globals}\n@source "${join(repository,'components/features/whatsapp/AttachmentPreviewComposer.tsx').replaceAll('\\','/')}";\n@source "${join(repository,'components/features/whatsapp/MediaViewer.tsx').replaceAll('\\','/')}";\n@source "${join(repository,'components/ui').replaceAll('\\','/')}";`,{from:join(repository,'app/media-controls-fixture.css')})).css;
  browser=await chromium.launch({headless:true});
},{timeout:300000});
after(async()=>{await browser?.close();if(directory){const path=resolve(directory);assert.ok(path.startsWith(resolve(tmpdir())+sep));assert.match(basename(path),/^vimob-media-controls-/);await rm(path,{recursive:true,force:true});}});
async function open(t,props={}){
  const page=await browser.newPage();page.setDefaultTimeout(3000);const errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});
  t.after(async()=>{await page.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[],'no external network');});
  await page.setViewportSize({width:320,height:800});await page.setContent(`<style>${css}</style><main class="app-shell" style="padding:16px"><div id="root"></div></main>`);
  await page.evaluate(()=>{window.process={env:{NODE_ENV:'development'}};});await page.addScriptTag({content:bundle});await page.evaluate(p=>h.render(p),props);return page;
}
const style=node=>{const s=getComputedStyle(node);return {size:s.fontSize,weight:s.fontWeight,height:s.height,radius:s.borderRadius,padding:s.paddingTop};};
const caption=page=>page.getByRole('textbox',{name:'Legenda de Documento.txt'});
const calls=page=>page.evaluate(()=>h.calls);

test('attachment caption stays12/300 and32px at320/1440 with neutral focus',async t=>{
  const page=await open(t),actual=[];
  for(const width of[320,1440])for(const theme of['light','dark']){await page.setViewportSize({width,height:800});await page.evaluate(theme=>{document.documentElement.className=theme;},theme);await caption(page).focus();actual.push({width,theme,...await caption(page).evaluate(style)});}
  console.log('caption computed CSS',actual);
  assert.deepEqual(actual,[320,1440].flatMap(width=>['light','dark'].map(theme=>({width,theme,size:'12px',weight:'300',height:'32px',radius:'6px',padding:'8px'}))));
  const shadow=await caption(page).evaluate(node=>getComputedStyle(node).boxShadow);
  assert.ok(shadow==='none'||(shadow.match(/-?[\d.]+px/g)||[]).every(v=>Number.parseFloat(v)===0));
  const send=page.getByRole('button',{name:'Enviar arquivo',exact:true});
  assert.deepEqual(await send.evaluate(style),{size:'12px',weight:'300',height:'32px',radius:'6px',padding:'0px'});
  assert.equal(await page.getByRole('region',{name:'Revisar arquivos antes de enviar'}).evaluate(node=>getComputedStyle(node).borderRadius),'8px');
  const remove=page.getByRole('button',{name:'Remover Documento.txt da seleção'});
  assert.deepEqual(await remove.evaluate(node=>({height:getComputedStyle(node).height,radius:getComputedStyle(node).borderRadius})),{height:'32px',radius:'6px'});
  assert.equal(await caption(page).evaluate(node=>getComputedStyle(node.closest('.flex')).borderRadius),'6px');
});

test('caption removal and send preserve the exact attachment callbacks',async t=>{
  const page=await open(t,{entries:[{id:1,name:'Documento.txt',caption:''},{id:2,name:'Outro.txt',caption:''}]});
  await caption(page).fill('Legenda sintética');await page.getByRole('button',{name:'Enviar arquivos',exact:true}).click();
  assert.deepEqual(await calls(page),[['caption',1,'Legenda sintética'],['send',[[1,'Legenda sintética'],[2,'']]]]);
  await page.getByRole('button',{name:'Remover Outro.txt da seleção',exact:true}).click();
  assert.deepEqual((await calls(page)).at(-1),['remove',2]);await expect(page.getByRole('button',{name:'Enviar arquivo',exact:true})).toBeVisible();
});

test('busy and unconfirmed attachments preserve caption and action guards',async t=>{
  const page=await open(t,{busy:true});await expect(caption(page)).toBeDisabled();await expect(page.getByRole('button',{name:'Enviar arquivo',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Remover Documento.txt da seleção'})).toBeDisabled();
  await page.evaluate(()=>h.render({entries:[{id:1,name:'Documento.txt',caption:'Bloqueada',outcome:'unconfirmed'}]}));
  await expect(caption(page)).toBeDisabled();await page.getByRole('button',{name:'Verificar envio',exact:true}).click();
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'),[['send',[[1,'Bloqueada']]]]);
});

test('viewer buttons use12/300 and radius6 across navigation error retry and download',async t=>{
  const page=await open(t,{mode:'viewer'});
  await expect(page.getByRole('button',{name:'Aumentar zoom',exact:true})).toBeVisible();
  for(const width of[320,1440])for(const theme of['light','dark']){
    await page.setViewportSize({width,height:800});await page.evaluate(theme=>{document.documentElement.className=theme;},theme);const button=page.getByRole('button',{name:'Baixar',exact:true});
    console.log('viewer download CSS',width,theme,await button.evaluate(style));
    assert.deepEqual(await button.evaluate(node=>({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight,radius:getComputedStyle(node).borderRadius})),{size:'12px',weight:'300',radius:'6px'});
    assert.equal(await page.getByRole('button',{name:'Próxima mídia',exact:true}).evaluate(node=>getComputedStyle(node).height),width < 640 ? '32px' : '40px');
    for(const name of['Mídia anterior','Próxima mídia','Fechar visualizador'])assert.equal(await page.getByRole('button',{name,exact:true}).evaluate(node=>getComputedStyle(node).borderRadius),'6px');
    await page.locator('[role=dialog] img').evaluate(node=>node.dispatchEvent(new Event('error')));
    for(const name of['Tentar novamente','Tentar baixar'])assert.deepEqual(await page.getByRole('button',{name,exact:true}).evaluate(node=>({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight,radius:getComputedStyle(node).borderRadius})),{size:'12px',weight:'300',radius:'6px'});
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await expect(page.getByRole('button',{name:'Baixar',exact:true})).toBeVisible();
  }
});

test('viewer navigation boundaries arrows retry download failure and close keep real handlers',async t=>{
  const page=await open(t,{mode:'viewer'});await expect(page.getByRole('button',{name:'Aumentar zoom',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Mídia anterior'})).toBeDisabled();await page.getByRole('button',{name:'Próxima mídia'}).click();
  await expect(page.getByRole('dialog',{name:'Segunda.png'})).toBeVisible();await expect(page.getByRole('button',{name:'Próxima mídia'})).toBeDisabled();
  await page.getByRole('dialog').press('ArrowLeft');await expect(page.getByRole('dialog',{name:'Primeira.png'})).toBeVisible();
  await page.getByRole('button',{name:'Baixar',exact:true}).click();await expect(page.getByText('Download iniciado.',{exact:true})).toBeVisible();
  await page.evaluate(()=>{h.downloadFailure=true;});await page.getByRole('button',{name:'Baixar',exact:true}).click();
  await expect(page.getByText('Download sintético falhou',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Atualizar link da mídia',exact:true}).click();
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='download'),[['download','Primeira.png','image',false],['download','Primeira.png','image',false]]);
  assert.equal((await calls(page)).filter(c=>c[0]==='refresh').length,1);
  await page.getByRole('button',{name:'Fechar visualizador'}).click();assert.equal((await calls(page)).filter(c=>c[0]==='close').length,1);
});
