import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual Bubble/Media/Audio/Actions and product CSS. Only data hooks, browser
// media playback and Next adapters are fixtures. External network is blocked.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = 'D:/Vimob/tmp/whatsapp-final-four-fixes-20261014/mobile';
const imageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S4AAAAASUVORK5CYII=';
const wav = Buffer.alloc(844); wav.write('RIFF'); wav.writeUInt32LE(836, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(800, 40); wav.fill(128, 44);
const audioURL = `data:audio/wav;base64,${wav.toString('base64')}`;
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-mobile-media-actions-'));
  await mkdir(output, { recursive: true });
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  const media = join(directory, 'media.js'), attachments = join(directory, 'attachments.js');
  const toast = join(directory, 'toast.js'), image = join(directory, 'image.js');
  const mention = join(directory, 'mention.js'), scope = join(directory, 'scope.js'), link = join(directory, 'link.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}),path=require('node:path'),fs=require('node:fs');module.exports=function(source){if(process.env.VIMOB_MOBILE_BASELINE==='1'){const rel=path.relative(${JSON.stringify(repository)},this.resourcePath),candidate=path.join(${JSON.stringify(output)},rel.replaceAll(path.sep,'__')+'.before');if(!rel.startsWith('..')&&fs.existsSync(candidate))source=fs.readFileSync(candidate,'utf8');}return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(media, 'export const useWhatsAppMessageMediaURL=({mediaUrl})=>({mediaUrl,isLoading:false,failed:false,refresh:async()=>null});');
  await writeFile(attachments, 'export const useCreateLeadAttachment=()=>({isPending:false,mutateAsync:async()=>{throw new Error("Unexpected attachment mutation")}});');
  await writeFile(toast, 'export const toast=()=>{};');
  await writeFile(link, "import React from 'react';export default function Link(props){return React.createElement('a',props)}");
  await writeFile(image, "import React from 'react';export default function Image({src,unoptimized,priority,fill,...props}){return React.createElement('img',{...props,src})}");
  await writeFile(mention, 'export const useMentionNames=()=>({});');
  await writeFile(scope, 'export const useWhatsAppQueryScope=()=>({organizationId:"org-a",userId:"user-a",accessScope:"allowed"});');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {MessageBubble} from ${JSON.stringify(join(repository, 'components/features/whatsapp/MessageBubble.tsx'))};
    import {MobileConversationHeader} from ${JSON.stringify(join(repository, 'components/features/whatsapp/conversations/MobileConversationHeader.tsx'))};
    const root=createRoot(document.getElementById('root'));window.h={props:{},mode:'bubble',replies:0,reactions:[],manual:0,searches:0,panels:0,render(props={},mode='bubble'){this.props=props;this.mode=mode;flushSync(()=>root.render(React.createElement(Host)))}};
    Object.defineProperty(HTMLMediaElement.prototype,'play',{configurable:true,value:async function(){this.dispatchEvent(new Event('play'))}});
    Object.defineProperty(HTMLMediaElement.prototype,'pause',{configurable:true,value:function(){this.dispatchEvent(new Event('pause'))}});
    function Host(){if(h.mode==='header')return React.createElement(MobileConversationHeader,{conversation:{id:'conversation-one',lead:{id:'lead-one',name:'Marina Sintética'},contact_name:'Marina Sintética',contact_phone:'+5511999990000'},selectedLeadId:'lead-one',canOperateWhatsApp:true,onBack:()=>{},onArchive:()=>{},onDelete:()=>{},onSearch:()=>h.searches++,onToggleLeadPanel:()=>h.panels++});
    return React.createElement('div',{role:'log','data-chat-canvas':true,className:'p-3'},React.createElement(MessageBubble,{content:null,messageType:'document',mediaUrl:null,mediaMimeType:'application/pdf',mediaStatus:'failed',mediaError:'media_policy_manual_only_type',mediaSize:2097152,fromMe:true,status:'sent',sentAt:'2026-10-12T10:00:00Z',senderName:'Ana',isGroup:false,messageId:'00000000-0000-4000-8000-000000000001',leadId:'lead-one',leadName:'Lead',reactions:[],reactionPickerPosition:'outside',...h.props,onRetryMedia:async()=>{h.manual++},onReply:()=>h.replies++,onReact:emoji=>h.reactions.push(emoji)}));}
  `);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'mobile.js' },
      resolve: { symlinks: false, extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@/hooks/use-whatsapp-message-media-url': media, '@/hooks/use-whatsapp-query-scope': scope, '@/hooks/use-lead-attachments': attachments, '@/hooks/use-toast': toast, '@/hooks/use-mention-names': mention, 'next/image': image, 'next/link': link, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'mobile.js'), 'utf8');
  const productCss = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/whatsapp', 'components/ui', 'components/features/leads/LeadAttachments'].map(source => `@source "${join(repository, source).replaceAll('\\', '/')}";`).join('\n') + (process.env.VIMOB_MOBILE_BASELINE==='1'?`\n@source "${output}/*.before";`:'');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${productCss}\n${sources}`, { from: join(repository, 'app/mobile-media-actions-fixture.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });
after(async () => { await browser?.close(); if (directory) { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); assert.ok(basename(directory).startsWith('vimob-mobile-media-actions-')); await rm(directory, { recursive: true, force: true }); } });

async function open(t, width = 320, coarse = true) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: coarse, isMobile: coarse });
  const page = await context.newPage(), errors = [], network = [];
  page.setDefaultTimeout(3500); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(network, [], 'No external requests'); });
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main class="app-shell"><div id="root"></div></main>`);
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle }); await page.evaluate(() => h.render());
  return page;
}

async function geometry(page) {
  return page.locator('[data-chat-canvas]').evaluate(canvas => {
    const rect = node => { const b = node.getBoundingClientRect(); return { x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom }; };
    const row=canvas.querySelector('[data-message-id]'), bubble=canvas.querySelector('[data-message-bubble]');
    const controls=[...canvas.querySelector('[data-message-actions-outside]').querySelectorAll('button')];
    const slider=canvas.querySelector('[role=slider]'),audioFooter=slider?.parentElement.nextElementSibling;
    return { canvas:rect(canvas), row:rect(row),bubble:rect(bubble), rowScroll:row.scrollWidth,rowWidth:row.clientWidth,
      actions:controls.map(rect), download:rect([...canvas.querySelectorAll('button')].find(b=>b.textContent.includes('Baixar arquivo')) || bubble),
      audio:slider?{slider:rect(slider),footer:rect(audioFooter),items:[...audioFooter.children].map(rect)}:null };
  });
}

function assertInside(g, label) {
  assert.ok(g.rowScroll <= g.rowWidth + 1, `${label}: no horizontal overflow ${JSON.stringify(g)}`);
  assert.ok(g.bubble.x >= g.row.x - 1 && g.bubble.right <= g.row.right + 1, `${label}: bubble stays inside row ${JSON.stringify(g)}`);
  for (const button of [...g.actions, g.download]) assert.ok(button.x >= g.row.x - 1 && button.right <= g.row.right + 1, `${label}: button inside row ${JSON.stringify(g)}`);
  for(const button of g.actions) assert.ok(button.right<=g.bubble.x+1 || button.x>=g.bubble.right-1 || button.bottom<=g.bubble.y+1 || button.y>=g.bubble.bottom-1, `${label}: actions never covered by bubble ${JSON.stringify(g)}`);
  for (let i=0;i<g.actions.length;i++) for(let j=i+1;j<g.actions.length;j++) {
    const a=g.actions[i],b=g.actions[j];
    assert.ok(a.right<=b.x+1 || b.right<=a.x+1 || a.bottom<=b.y+1 || b.bottom<=a.y+1, `${label}: controls never overlap`);
  }
  if(g.audio){const {footer,items}=g.audio;for(const item of items)assert.ok(item.x>=footer.x-1 && item.right<=footer.right+1,`${label}: audio clock/duration stay inside player ${JSON.stringify(g)}`);for(let i=1;i<items.length;i++)assert.ok(items[i-1].right<=items[i].x+1 || items[i-1].bottom<=items[i].y+1,`${label}: duration and receipt never overlap`);}
}

test('manual document and all side actions fit a real touch 320px canvas before tapping', async t => {
  const page = await open(t); assert.equal(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),true);
  const g=await geometry(page); await writeFile(join(output,process.env.VIMOB_MOBILE_RED==='1'?'document-320-red.json':'document-320-green.json'),JSON.stringify(g,null,2));
  await page.screenshot({path:join(output,process.env.VIMOB_MOBILE_RED==='1'?'document-320-red.png':'document-320-green.png')});
  assertInside(g,'document320');
  await page.getByRole('button',{name:'Responder citando esta mensagem'}).tap({position:{x:16,y:2}}); assert.equal(await page.evaluate(()=>h.replies),1);
  await page.getByRole('button',{name:'Reagir à mensagem',exact:true}).tap({position:{x:16,y:2}});
  await page.getByRole('button',{name:'Reagir com 👍',exact:true}).tap(); assert.deepEqual(await page.evaluate(()=>h.reactions),['👍']);
  await page.getByRole('button',{name:'Mais opções da mensagem',exact:true}).tap({position:{x:16,y:2}});
  await page.getByRole('menuitem',{name:'Dados da mensagem',exact:true}).tap(); await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Baixar arquivo',exact:true}).tap(); assert.equal(await page.evaluate(()=>h.manual),1);
});

test('ready and pending media keep bounds and approved typography at 320/390/768/1440', async t => {
  const page=await open(t);
  const fixtures=[{}, {messageType:'text',content:'Mensagem curta',mediaError:null},
    {messageType:'image',mediaUrl:imageURL,mediaMimeType:'image/png',mediaStatus:'ready',mediaError:null},
    {messageType:'audio',mediaUrl:audioURL,mediaMimeType:'audio/wav',mediaStatus:'ready',mediaError:null},
    {messageType:'audio',mediaUrl:null,mediaMimeType:'audio/wav',mediaStatus:'pending',mediaError:null},
    {messageType:'video',mediaUrl:null,mediaMimeType:'video/mp4',mediaStatus:'failed',mediaError:null}];
  for(const width of [320,390,768,1440]) { await page.setViewportSize({width,height:900});
    for(const theme of ['light','dark']) for(const fromMe of [false,true]) for(const fixture of fixtures){
      await page.evaluate(({fixture,fromMe,theme})=>{document.documentElement.className=theme;h.render({...fixture,fromMe,status:fromMe?'sent':'received'})},{fixture,fromMe,theme});
      assertInside(await geometry(page),`${width}/${theme}/${fromMe}/${fixture.messageType||'document'}`);
      if(width===320 && theme==='light' && fixture.messageType==='audio' && fixture.mediaStatus==='ready'){
        await writeFile(join(output,`audio-320-${fromMe?'outgoing':'incoming'}.json`),JSON.stringify(await geometry(page),null,2));
        await page.screenshot({path:join(output,`audio-320-${fromMe?'outgoing':'incoming'}.png`)});
      }
      if(fixture.messageType==='text')assert.deepEqual(await page.locator('[data-message-text]').evaluate(n=>({size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight})),{size:'12px',weight:'200'});
    }
  }
  // Diagnostic of the wider candidate, not a product baseline or a required
  // failure: record the actual geometry rather than assuming 44px cannot fit.
  await page.setViewportSize({width:320,height:900});
  await page.evaluate(url=>h.render({messageType:'audio',mediaUrl:url,mediaMimeType:'audio/wav',mediaStatus:'ready',mediaError:null}),audioURL);
  const candidateStyle=await page.addStyleTag({content:'[data-message-actions-outside] button{width:44px!important;min-width:44px!important}'});
  const candidate=await geometry(page);let boundsError=null;try{assertInside(candidate,'44px horizontal experiment')}catch(error){boundsError=error.message;}
  await writeFile(join(output,'44px-horizontal-experiment.json'),JSON.stringify({experimentOnly:true,geometry:candidate,boundsError},null,2));
  await page.screenshot({path:join(output,'44px-horizontal-experiment.png')});await candidateStyle.evaluate(node=>node.remove());
});

test('touch actions have distinct enlarged hit areas without consuming the mobile identity', async t => {
  const page=await open(t);
  const g=await geometry(page);
  // 44px in both axes would take 132px beside every bubble; preserve a 32px
  // horizontal target and 44px height so the 320px audio player remains usable.
  for(const action of g.actions)assert.ok(action.width>=32 && action.height>=44,`message hit area ${JSON.stringify(action)}`);
  for(const button of await page.locator('[data-message-actions-outside] button').all())assert.deepEqual(await button.evaluate(node=>({background:getComputedStyle(node).backgroundColor,visualWidth:getComputedStyle(node,'::before').width,visualHeight:getComputedStyle(node,'::before').height})),{background:'rgba(0, 0, 0, 0)',visualWidth:'28px',visualHeight:'28px'});
  await page.evaluate(()=>h.render({},'header'));
  const header=await page.getByLabel('Cabeçalho da conversa',{exact:true}).evaluate(node=>{
    const rect=n=>{const b=n.getBoundingClientRect();return{x:b.x,right:b.right,width:b.width,height:b.height}};
    return{width:node.clientWidth,identity:rect(node.querySelector('[data-conversation-identity] p')),actions:[...node.querySelector('[aria-label="Ações da conversa"]').querySelectorAll('button,a')].map(rect)};
  });
  assert.ok(header.identity.width>=36,`name keeps readable width ${JSON.stringify(header)}`);
  for(const action of header.actions)assert.ok(action.width>=36 && action.height>=44,`header hit area ${JSON.stringify(header)}`);
  for(let i=1;i<header.actions.length;i++)assert.ok(header.actions[i-1].right<=header.actions[i].x+1,'header targets do not overlap');
  await page.getByRole('button',{name:'Mais ações da conversa'}).tap({position:{x:2,y:2}});await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Pesquisar nesta conversa'}).tap({position:{x:2,y:2}});await page.getByRole('button',{name:'Mostrar dados do contato'}).tap({position:{x:2,y:2}});
  assert.equal(await page.evaluate(()=>h.searches),1);assert.equal(await page.evaluate(()=>h.panels),1);
  await writeFile(join(output,'touch-geometry.json'),JSON.stringify({message:g,header},null,2));
  await page.screenshot({path:join(output,'header-320-touch.png')});
});

test('long audio durations do not push the delivery receipt outside a narrow player',async t=>{
  const page=await open(t);
  for(const width of [320,390])for(const fromMe of [true,false])for(const duration of [600,3600]){
    await page.setViewportSize({width,height:900});await page.evaluate(({url,fromMe})=>h.render({messageType:'audio',mediaUrl:url,mediaMimeType:'audio/wav',mediaStatus:'ready',mediaError:null,fromMe,status:fromMe?'sent':'received'}),{url:audioURL,fromMe});
    await page.locator('audio').evaluate((audio,duration)=>{Object.defineProperty(audio,'duration',{configurable:true,value:duration});audio.dispatchEvent(new Event('loadedmetadata'));},duration);
    await page.waitForFunction(duration=>document.querySelector('[role=slider]')?.getAttribute('aria-valuemax')===String(duration),duration);
    const result=await geometry(page);await writeFile(join(output,`long-audio-${width}-${fromMe?'outgoing':'incoming'}.json`),JSON.stringify(result,null,2));
    assertInside(result,`long audio ${width}/${fromMe}/${duration}`);
  }
});

test('fine pointer keeps compact action geometry and reference desktop media width',async t=>{
  const page=await open(t,1440,false),g=await geometry(page);assertInside(g,'desktop');
  for(const action of g.actions)assert.deepEqual({width:action.width,height:action.height},{width:28,height:28});
  await writeFile(join(output,`desktop-reference-${process.env.VIMOB_MOBILE_BASELINE==='1'?'before':'after'}.json`),JSON.stringify(g,null,2));
  const placeholders=[];
  for(const props of [{},{messageType:'document',mediaError:null},{messageType:'audio',mediaError:null,mediaStatus:'pending'},
    {messageType:'video',mediaError:null,mediaStatus:'failed'},{messageType:'image',mediaError:null,mediaStatus:'pending'}]){
    await page.evaluate(props=>h.render(props),props);const result=await geometry(page);assertInside(result,'desktop placeholder');placeholders.push({props,bubble:result.bubble});
  }
  await writeFile(join(output,`desktop-placeholder-reference-${process.env.VIMOB_MOBILE_BASELINE==='1'?'before':'after'}.json`),JSON.stringify(placeholders,null,2));
  await page.evaluate(()=>h.render({},'header'));
  const header=page.getByLabel('Ações da conversa',{exact:true});
  for(const button of await header.getByRole('button').all())assert.equal((await button.boundingBox()).height,32);
});
