import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// The same local webpack/Chromium setup used by media-ui-runtime: real Bubble,
// reaction picker and Radix; only unrelated media/API boundaries are mocked.
// No Tailwind bundle is loaded, so these tests assert DOM order, not geometry.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bubblePath = join(repository, 'components/features/whatsapp/MessageBubble.tsx');
const beforePath = 'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/root-before-side-reply/MessageBubble.tsx';
const replyLabel = 'Responder citando esta mensagem';
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-reply-actions-'));
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  const media = join(directory, 'media.js'), attachments = join(directory, 'attachments.js');
  const toast = join(directory, 'toast.js'), image = join(directory, 'image.js'), mention = join(directory, 'mention.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});
    module.exports=function(source){
      ${process.env.VIMOB_REPLY_ACTION_BEFORE === '1' ? `if(this.resourcePath===${JSON.stringify(bubblePath)})source=require('node:fs').readFileSync(${JSON.stringify(beforePath)},'utf8');` : ''}
      return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    };`);
  await writeFile(media, 'export const useWhatsAppMessageMediaURL=({mediaUrl})=>({mediaUrl,loading:false,failed:false,refresh:async()=>null});');
  await writeFile(attachments, 'export const useCreateLeadAttachment=()=>({isPending:false,mutateAsync:async()=>{throw new Error("Unexpected attachment mutation")}});');
  await writeFile(toast, 'export const toast=()=>{};');
  await writeFile(image, "import React from 'react';export default function Image({unoptimized,priority,fill,...props}){return React.createElement('img',props)}");
  await writeFile(mention, 'export const useMentionNames=()=>({});');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {MessageBubble} from ${JSON.stringify(bubblePath)};
    const root=createRoot(document.getElementById('root'));
    window.h={replies:[],reactions:[],props:{},render(next={}){this.props=next;flushSync(()=>root.render(React.createElement(Host)))}};
    function Host(){const p=h.props;const id=p.messageId||'00000000-0000-4000-8000-000000000001';
      return React.createElement('div',{role:'log'},React.createElement(MessageBubble,{
        content:'Mensagem de teste',messageType:'text',mediaUrl:null,mediaMimeType:null,mediaStatus:null,mediaError:null,
        fromMe:false,status:'received',sentAt:'2026-10-12T10:00:00Z',senderName:null,isGroup:false,
        messageId:id,leadId:'lead-one',leadName:'Lead',reactions:[],reactionPickerPosition:'outside',...p,
        onReply:p.replyAllowed===false?undefined:()=>h.replies.push({id,fromMe:Boolean(p.fromMe),gesture:p.gesture||'current'}),
        onReact:p.reactAllowed===false?undefined:emoji=>h.reactions.push({id,emoji})}));}
  `);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'reply.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/hooks/use-whatsapp-message-media-url': media, '@/hooks/use-lead-attachments': attachments,
          '@/hooks/use-toast': toast, '@/hooks/use-mention-names': mention, 'next/image': image, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error)
      : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'reply.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(directory).startsWith('vimob-reply-actions-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function open(t, props = {}) {
  const page = await browser.newPage();page.setDefaultTimeout(3000);
  const errors=[],network=[];
  await page.route('**/*', route => { network.push(route.request().url());return route.abort(); });
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close();assert.deepEqual(errors, [], 'No uncaught browser failure');assert.deepEqual(network, [], 'No external request started'); });
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(props => h.render(props), props);
  return page;
}

for (const fromMe of [false, true]) test(`reply and reaction are adjacent outside the ${fromMe ? 'outgoing' : 'incoming'} bubble`, async t => {
  const page=await open(t,{fromMe,status:fromMe?'sent':'received'});
  const reply=page.getByRole('button',{name:replyLabel,exact:true});
  assert.equal(await reply.count(),1);assert.equal(await reply.getAttribute('title'),'Responder');assert.equal(await reply.innerText(),'');
  assert.equal(await page.getByText('Responder',{exact:true}).count(),0);
  const dom=await page.evaluate(() => {
    const row=document.querySelector('[data-message-id]'),actions=row.querySelector('[data-message-actions-outside]');
    const body=[...row.children].find(node=>node!==actions),button=actions?.querySelector('[data-message-reply-outside]');
    return {sibling:actions?.parentElement===row,bodyContainsReply:body?.contains(button),side:[...row.children].indexOf(actions),
      order:[...actions?.children||[]].map(node=>node.hasAttribute('data-message-reply-outside')?'reply':'reaction'),
      contentInBody:body?.textContent.includes('Mensagem de teste')};
  });
  assert.equal(dom.sibling,true);assert.equal(dom.bodyContainsReply,false);assert.equal(dom.contentInBody,true);
  assert.equal(dom.side,fromMe?0:1);assert.deepEqual(dom.order,fromMe?['reply','reaction']:['reaction','reply']);
});

test('pointer click cites exactly the canonical message callback once',async t=>{
  const id='00000000-0000-4000-8000-000000000002',page=await open(t,{messageId:id,fromMe:true,status:'delivered'});
  await page.getByRole('button',{name:replyLabel,exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>h.replies),[{id,fromMe:true,gesture:'current'}]);assert.deepEqual(await page.evaluate(()=>h.reactions),[]);
});
test('reply is keyboard accessible through Enter and Space with one callback per gesture',async t=>{
  const page=await open(t),reply=page.getByRole('button',{name:replyLabel,exact:true});await reply.focus();
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>h.replies.length),1);
  await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>h.replies.length),2);
  assert.deepEqual(await page.evaluate(()=>h.replies.map(value=>value.id)),Array(2).fill('00000000-0000-4000-8000-000000000001'));
});
test('inside reaction mode stays inside while reply remains an outside sibling',async t=>{
  const page=await open(t,{reactionPickerPosition:'inside'});
  assert.equal(await page.locator('[data-message-reaction-outside]').count(),0);
  const react=page.getByRole('button',{name:'Reagir à mensagem',exact:true});
  assert.equal(await react.count(),1);
  assert.equal(await react.evaluate(node=>Boolean(node.closest('[data-message-actions-outside]'))),false);
  assert.equal(await page.getByRole('button',{name:replyLabel,exact:true}).evaluate(node=>Boolean(node.closest('[data-message-actions-outside]'))),true);
  await react.click();await page.getByRole('button',{name:'Reagir com 👍',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>h.reactions),[{id:'00000000-0000-4000-8000-000000000001',emoji:'👍'}]);assert.equal(await page.evaluate(()=>h.replies.length),0);
});
test('a reader without a reply callback gets no reply action even for a confirmed unquoted message',async t=>{
  const page=await open(t,{replyAllowed:false});assert.equal(await page.getByRole('button',{name:replyLabel,exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Reagir à mensagem',exact:true}).count(),1);
  assert.equal(await page.locator('[data-message-reply-outside]').count(),0);
});
for(const status of ['pending','queued','sending','failed','error','confirming','unconfirmed',''])test(`reply stays unavailable for outgoing status ${status||'unknown'}`,async t=>{
  const page=await open(t,{fromMe:true,status});assert.equal(await page.getByRole('button',{name:replyLabel,exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>h.replies.length),0);
});
for(const messageType of ['deleted','reaction'])test(`${messageType} messages expose no reply`,async t=>{
  const page=await open(t,{messageType,fromMe:true,status:'sent'});assert.equal(await page.getByRole('button',{name:replyLabel,exact:true}).count(),0);
  assert.equal(await page.locator('[data-message-reply-outside]').count(),0);
});
test('without reactions the outside reply button remains available for a confirmed message',async t=>{
  const page=await open(t,{reactAllowed:false,status:'read'});assert.equal(await page.getByRole('button',{name:'Reagir à mensagem',exact:true}).count(),0);
  assert.equal(await page.locator('[data-message-actions-outside] [data-message-reply-outside]').count(),1);
});
test('a rerender uses the latest reply callback and removes it after permission revocation',async t=>{
  const page=await open(t);await page.evaluate(()=>h.render({messageId:'00000000-0000-4000-8000-000000000003',gesture:'new'}));
  await page.getByRole('button',{name:replyLabel,exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>h.replies),[{id:'00000000-0000-4000-8000-000000000003',fromMe:false,gesture:'new'}]);
  await page.evaluate(()=>h.render({replyAllowed:false}));assert.equal(await page.getByRole('button',{name:replyLabel,exact:true}).count(),0);
});
test('long text and image captions keep reply outside the body in the DOM',async t=>{
  const page=await open(t);
  for(const messageType of ['text','image']){
    await page.evaluate(messageType=>h.render({messageType,content:'Conteúdo longo '.repeat(60),mediaStatus:messageType==='image'?'failed':null,mediaMimeType:messageType==='image'?'image/png':null}),messageType);
    assert.equal(await page.getByRole('button',{name:replyLabel,exact:true}).count(),1);
    assert.equal(await page.locator('[data-message-actions-outside]').evaluate(node=>node.textContent.trim()),'');
    assert.equal(await page.getByText('Conteúdo longo',{exact:false}).count(),1);
  }
});
