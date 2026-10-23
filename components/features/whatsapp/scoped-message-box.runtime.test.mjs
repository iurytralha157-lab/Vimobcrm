import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-scoped-composer-'));
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js'), recorder = join(directory, 'recorder.js'), quickReplies = join(directory, 'quick-replies.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  // This pre-existing recorder/typography suite exercises an unavailable personal-reply scope.
  await writeFile(quickReplies, `export const useWhatsAppQuickReplyScope=()=>({identity:'unavailable',enabled:false});export const useWhatsAppQuickReplies=()=>({data:[],isPending:false,isError:false,refetch:async()=>{}});export const useCreateWhatsAppQuickReply=()=>({});export const useUpdateWhatsAppQuickReply=()=>({});export const useDeleteWhatsAppQuickReply=()=>({});`);
  await writeFile(recorder, `import React,{useEffect} from 'react';export function AudioRecorderButton(p){useEffect(()=>{h.mounts++;return()=>h.unmounts++;},[]);
    return React.createElement('button',{'aria-label':'Gravar áudio',className:'h-8 w-8',disabled:p.disabled,'data-context':p.contextKey,onClick:()=>{p.onActiveChange(true);h.calls.push(['record',p.contextKey]);}},'Áudio');}`);
  await writeFile(entry, `import React,{useRef} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{ScopedMessageBox}from${JSON.stringify(join(repository, 'components/features/whatsapp/ScopedMessageBox.tsx'))};
    const root=createRoot(document.getElementById('root'));window.h={props:{},calls:[],mounts:0,unmounts:0,render(p=this.props){this.props=p;flushSync(()=>root.render(React.createElement(Host)))}};
    function Host(){const p=h.props,ref=useRef(null);h.field=ref;return React.createElement(ScopedMessageBox,{
      value:p.value||'',onChange:value=>{h.calls.push(['change',value]);h.render({...h.props,value});},onSend:()=>h.calls.push(['send',h.props.value]),
      onKeyDown:p.customKeys?event=>h.calls.push(['keydown',event.key]):undefined,inputRef:ref,multiline:!!p.multiline,
      disabled:!!p.disabled,isSending:!!p.sending,compact:p.compact,className:p.className,leftActions:React.createElement('button',{type:'button','aria-label':'Anexar arquivo'},'Anexo'),
      audio:{contextKey:p.context||'actor/org/chat-a',disabled:!!p.disabled,onSend:async()=>{h.calls.push(['audio-send']);return true;}}});}
  `);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'composer.js', publicPath: '' },
      resolve: { symlinks: false, extensions: ['.tsx', '.ts', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@/components/features/whatsapp/AudioRecorderButton': recorder, '@/hooks/whatsapp/use-whatsapp-quick-replies': quickReplies, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] }, plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'composer.js'), 'utf8');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n@source "${join(repository, 'components/features/whatsapp/ScopedMessageBox.tsx').replaceAll('\\', '/')}";\n@source "${join(repository, 'components/ui/message-box.tsx').replaceAll('\\', '/')}";`, { from: join(repository, 'app/composer-fixture.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });

after(async () => {
  await browser?.close();
  if (directory) { const path = resolve(directory); assert.ok(path.startsWith(resolve(tmpdir()) + sep)); assert.match(basename(path), /^vimob-scoped-composer-/); await rm(path, { recursive: true, force: true }); }
});
async function open(t, props = {}) {
  const page = await browser.newPage(); page.setDefaultTimeout(3000);
  const errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => { network.push(r.request().url()); return r.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(network, [], 'no network attempted'); });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.setContent(`<style>${css}</style><main class="app-shell" style="padding:16px"><div id="root"></div></main>`);
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(p => h.render(p), props);
  return page;
}
const field = page => page.getByRole('textbox', { name: 'Mensagem', exact: true });
const calls = page => page.evaluate(() => h.calls);

test('WhatsApp wrapper defaults to compact caption typography and send radius6 at320/1440', async t => {
  const page = await open(t, { value: 'Mensagem sintética' });
  for (const width of [320, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    assert.deepEqual(await field(page).evaluate(node => { const s=getComputedStyle(node),box=getComputedStyle(node.parentElement);return {size:s.fontSize,weight:s.fontWeight,min:box.minHeight,height:box.height}; }), { size:'12px',weight:'300',min:'42px',height:'42px' });
    assert.equal(await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).evaluate(node=>getComputedStyle(node).borderRadius), '6px');
    assert.equal(await page.locator('#root').evaluate(node=>node.scrollWidth>node.clientWidth), false);
  }
});

test('typing Enter and clicking preserve exactly one send per gesture and the input ref', async t => {
  const page = await open(t);
  await page.evaluate(() => h.field.current.focus()); await expect(field(page)).toBeFocused();
  await field(page).fill('Primeira mensagem'); await field(page).press('Enter');
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'), [['send','Primeira mensagem']]);
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'), [['send','Primeira mensagem'],['send','Primeira mensagem']]);
});

test('idle recorder aligns with the compact field while explicit noncompact keeps its prior inset', async t => {
  const page = await open(t);
  for (const width of [320,1440]) for (const compact of [undefined,false]) {
    await page.setViewportSize({width,height:700}); await page.evaluate(p=>h.render(p),{compact});
    await expect.poll(()=>field(page).evaluate(node=>getComputedStyle(node.parentElement).height)).toBe(compact===false?'48px':'42px');
    const fieldBox = await field(page).evaluate(node=>{const r=node.parentElement.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
    const audioBox = await page.getByRole('button',{name:'Gravar áudio'}).boundingBox();
    assert.ok(audioBox); const inset=compact===false?8:5;
    assert.equal(audioBox.y-fieldBox.top,inset); assert.equal(fieldBox.bottom-audioBox.y-audioBox.height,inset);
    assert.equal(audioBox.height,32);
  }
});

test('multiline shift Enter keeps its newline and disabled fields cannot send', async t => {
  const page = await open(t, { multiline: true, value: 'Linha um' });
  await field(page).press('End'); await field(page).press('Shift+Enter'); await page.keyboard.insertText('Linha dois');
  assert.match(await field(page).inputValue(), /\n/); assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'), []);
  await page.evaluate(()=>h.render({...h.props,disabled:true})); await expect(field(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Enviar mensagem', exact: true })).toBeDisabled();
  assert.equal(await page.evaluate(()=>h.field.current.tagName), 'TEXTAREA');
});

test('caller key handler and explicit noncompact override remain intact', async t => {
  const page = await open(t, { value:'Mensagem',customKeys:true,compact:false,className:'caller-style' });
  await field(page).press('Enter'); assert.deepEqual(await calls(page), [['keydown','Enter']]);
  assert.equal(await field(page).evaluate(node=>getComputedStyle(node).fontSize), '13px');
  assert.equal(await page.locator('.caller-style').count(), 1);
});

test('recording sentinel remains mounted across typing sending and physical context changes', async t => {
  const page = await open(t);
  await page.getByRole('button', { name:'Gravar áudio' }).click();
  await field(page).fill('Texto durante gravação');
  await page.evaluate(()=>h.render({...h.props,sending:true}));
  await expect(page.getByRole('button', { name:'Gravar áudio' })).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>[h.mounts,h.unmounts]), [1,0]);
  await page.evaluate(()=>h.render({...h.props,sending:false,context:'actor/org/chat-b'}));
  await expect(page.getByRole('button', { name:'Gravar áudio' })).toBeHidden();
  assert.deepEqual(await page.evaluate(()=>[h.mounts,h.unmounts]), [1,0]);
  assert.deepEqual((await calls(page)).filter(c=>['record','audio-send'].includes(c[0])), [['record','actor/org/chat-a']]);
});

test('sending and blank input preserve the original disabled send guards', async t => {
  const page = await open(t, { value:'Texto',sending:true });
  await field(page).press('Enter'); await expect(page.getByRole('button', {name:'Enviando mensagem'})).toBeDisabled();
  await page.evaluate(()=>h.render({value:'   '})); await field(page).press('Enter');
  assert.deepEqual((await calls(page)).filter(c=>c[0]==='send'), []);
});
