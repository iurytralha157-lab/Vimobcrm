import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from '@playwright/test';

// Actual clipboard helper and Radix/Vaul focus scopes, with synthetic values.
// Clipboard writes, reads and execCommand are all intercepted before use.
const require = createRequire(import.meta.url), ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let directory, browser, page, bundle, source;
const errors = [];
before(async () => {
  source = await readFile(process.env.CLIPBOARD_SOURCE_FILE || join(root, 'lib/clipboard.ts'), 'utf8');
  directory = await mkdtemp(join(tmpdir(), 'vimob-clipboard-'));
  const entry = join(directory, 'entry.tsx'), loader = join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(join(directory, 'clipboard.ts'), source);
  await writeFile(entry, `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{copyTextToClipboard}from'./clipboard';
    import{Dialog,DialogContent,DialogTitle,DialogDescription}from'@/components/ui/dialog';import{Drawer,DrawerContent,DrawerTitle,DrawerDescription}from'@/components/ui/drawer';
    import{DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem}from'@/components/ui/dropdown-menu';
    const h=window.h={modern:[],fallbacks:[],payloads:[],mode:'modern',text:'  Synthetic\\r\\nmessage\\t \\n',options:{preserveWhitespace:true},calls:0};
    Object.defineProperty(navigator,'clipboard',{configurable:true,get(){if(h.mode==='getter-throw')throw Error('Synthetic clipboard unavailable');if(h.mode==='absent')return undefined;return{readText(){throw Error('Clipboard read is forbidden')},writeText(text){h.modern.push({text,synchronous:h.calling});if(h.mode==='deferred')return new Promise((resolve,reject)=>{h.finishModern=resolve;h.rejectModern=reject});if(h.mode==='reject')return Promise.reject(Error('Synthetic clipboard rejection'));if(h.mode==='sync-throw')throw Error('Synthetic write rejection');return Promise.resolve()}}}});
    document.execCommand=command=>{const area=document.activeElement;h.fallbacks.push({command,text:area?.value,selectionStart:area?.selectionStart,selectionEnd:area?.selectionEnd,fontSize:getComputedStyle(area).fontSize,readonly:area?.readOnly,insideMenu:Boolean(area.closest('[role="menu"]')),insideDialog:Boolean(area.closest('[role="dialog"]')),attached:area.isConnected});if(h.fallback==='throw')throw Error('Synthetic exec rejection');if(h.fallback==='false')return false;
      const event=new Event('copy',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{setData(type,value){h.payloads.push({type,value});if(h.transferThrows)throw Error('Synthetic transfer rejection')}}});area.dispatchEvent(event);return true;};
    h.copy=()=>{h.calling=true;h.calls++;h.result=undefined;const pending=copyTextToClipboard(h.text,h.options);h.syncModern=h.modern.length;h.calling=false;h.pending=pending.then(result=>{h.result=result;return result});return h.pending;};
    function Content(){return <><button data-testid='copy' style={{position:'fixed',top:12,right:12,zIndex:999}} onMouseDown={event=>event.preventDefault()} onClick={()=>void h.copy()}>Copiar</button>
      <DropdownMenu><DropdownMenuTrigger data-testid='menu-trigger' style={{position:'fixed',top:45,right:12,zIndex:999}}>Ações</DropdownMenuTrigger><DropdownMenuContent style={{background:'white'}}><DropdownMenuItem onSelect={()=>void h.copy()}>Copiar mensagem</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <div data-testid='outer' style={{height:160,overflow:'auto'}}><div style={{height:80}}/><div data-testid='inner' style={{height:90,overflow:'auto'}}><div style={{height:300}}/><input data-testid='composer' defaultValue='Rascunho sintético para preservar'/><textarea data-testid='draft' defaultValue='Rascunho de várias linhas'/><div data-testid='editable' contentEditable suppressContentEditableWarning>Seleção sintética para preservar</div><div style={{height:450}}/></div><div style={{height:400}}/></div></>}
    function Fixture(){const[variant,setVariant]=useState('plain');h.variant=setVariant;
      const style={position:'fixed',top:100,left:20,right:20,height:300,background:'white',overflow:'auto'};
      return <><div style={{height:1800}}/>{variant==='plain'?<Content/>:variant==='dialog'?<Dialog open><DialogContent style={style}><DialogTitle>Diálogo sintético</DialogTitle><DialogDescription>Ensaio de foco sem clipboard real.</DialogDescription><Content/></DialogContent></Dialog>:<Drawer open shouldScaleBackground={false}><DrawerContent style={style} showHandle={false}><DrawerTitle>Drawer sintético</DrawerTitle><DrawerDescription>Ensaio de foco sem clipboard real.</DrawerDescription><Content/></DrawerContent></Drawer>}</>}
    createRoot(document.getElementById('app')).render(<Fixture/>);
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [join(root, 'node_modules'), 'node_modules'], alias: { '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8'); browser = await chromium.launch({ headless: true });
}, { timeout: 120_000 });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(5_000);
  page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="app"></div></body></html>'); await page.addScriptTag({ content: bundle });
  await page.getByTestId('copy').waitFor();
});
afterEach(async () => page?.close());
after(async () => {
  await browser?.close();
  if (directory) { const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert(target.split(/[/\\]/).at(-1).startsWith('vimob-clipboard-')); await rm(target, { recursive: true, force: true }); }
  assert.deepEqual(errors, []);
});

async function configure(patch) { await page.evaluate(patch => Object.assign(window.h, patch), patch); }
async function copy() { await page.getByTestId('copy').click(); await page.waitForFunction(() => window.h.result !== undefined); return page.evaluate(() => window.h.result); }
async function prepare(kind = 'composer') {
  await page.evaluate(kind => {
    const h = window.h, outer = document.querySelector('[data-testid="outer"]'), inner = document.querySelector('[data-testid="inner"]'), field = document.querySelector('[data-testid="'+kind+'"]');
    field.focus({preventScroll:true});
    if (kind === 'editable') { const text = field.firstChild; document.getSelection().setBaseAndExtent(text, 22, text, 3); }
    else field.setSelectionRange(2, 10, 'backward');
    outer.scrollTop=60;inner.scrollTop=190;if(!field.closest('[role="dialog"]'))window.scrollTo(0,180);
    h.snapshot=()=>{const selection=document.getSelection(),active=document.activeElement;return{active:active?.getAttribute('data-testid'),start:active?.selectionStart,end:active?.selectionEnd,direction:active?.selectionDirection,range:selection?.toString(),anchor:selection?.anchorOffset,focus:selection?.focusOffset,window:[window.scrollX,window.scrollY],outer:[outer.scrollLeft,outer.scrollTop],inner:[inner.scrollLeft,inner.scrollTop]}};
    h.before=h.snapshot();
  },kind);
}
async function assertRestored() {
  const state=await page.evaluate(()=>({before:window.h.before,after:window.h.snapshot(),temporary:[...document.querySelectorAll('textarea')].filter(node=>!node.hasAttribute('data-testid')).length}));
  assert.deepEqual(state.after,state.before);assert.equal(state.temporary,0);
}

test('modern write is immediate in the click, preserves exact whitespace and never falls back on success',async()=>{
  assert.equal(await copy(),true);
  const state=await page.evaluate(()=>({modern:window.h.modern,text:window.h.text,sync:window.h.syncModern,fallbacks:window.h.fallbacks}));
  assert.deepEqual(state.modern,[{text:state.text,synchronous:true}]);assert.equal(state.sync,1);assert.deepEqual(state.fallbacks,[]);
});

test('default behavior still trims the phone caller while whitespace-preserving mode copies whitespace-only text',async()=>{
  await configure({text:'  +55 11 99999-0000  ',options:{}});assert.equal(await copy(),true);
  assert.equal(await page.evaluate(()=>window.h.modern[0].text),'+55 11 99999-0000');
  await configure({text:' \t\n ',options:{preserveWhitespace:true}});assert.equal(await copy(),true);
  assert.equal(await page.evaluate(()=>window.h.modern[1].text),' \t\n ');
  await configure({mode:'absent',text:'  +55 11 99999-0000  ',options:{}});assert.equal(await copy(),true);
  assert.equal(await page.evaluate(()=>window.h.payloads[0].value),'+55 11 99999-0000');
});

for(const options of [{},{preserveWhitespace:true}])test('empty text returns false without any clipboard operation '+JSON.stringify(options),async()=>{
  await configure({text:options.preserveWhitespace?'':'  \t ',options});assert.equal(await copy(),false);
  assert.equal(await page.evaluate(()=>window.h.modern.length+window.h.fallbacks.length),0);
});

for(const mode of ['absent','reject','sync-throw','getter-throw'])test('fallback after '+mode+' preserves exact payload, caret, focus and nested/window scroll',async()=>{
  await configure({mode});await prepare();assert.equal(await copy(),true);await assertRestored();
  const state=await page.evaluate(()=>({text:window.h.text,fallbacks:window.h.fallbacks,payloads:window.h.payloads}));
  assert.equal(state.fallbacks.length,1);assert.equal(state.fallbacks[0].readonly,true);assert.equal(state.fallbacks[0].fontSize,'16px');
  assert.deepEqual(state.payloads,[{type:'text/plain',value:state.text}]);
  assert.equal(await page.evaluate(()=>{let writes=0;const event=new Event('copy',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{setData(){writes++}}});document.dispatchEvent(event);return writes}),0);
});

for(const fallback of ['false','throw'])test('fallback '+fallback+' returns false and still restores editable selection',async()=>{
  await configure({mode:'absent',fallback});await prepare('editable');assert.equal(await copy(),false);await assertRestored();
});

test('failed explicit text transfer cannot report success even if execCommand returns true',async()=>{
  await configure({mode:'absent',transferThrows:true});await prepare();assert.equal(await copy(),false);await assertRestored();
});

test('an unavailable legacy command returns false, removes the temporary field and restores focus',async()=>{
  await configure({mode:'absent'});await prepare();await page.evaluate(()=>{document.execCommand=undefined});assert.equal(await copy(),false);await assertRestored();
});

test('a DOM snapshot failure returns false without attempting copy or disturbing focus',async()=>{
  await configure({mode:'absent'});await prepare();
  await page.evaluate(()=>{window.h.getSelectionOriginal=document.getSelection;document.getSelection=()=>{throw Error('Synthetic selection unavailable')}});
  assert.equal(await copy(),false);assert.equal(await page.evaluate(()=>window.h.fallbacks.length),0);
  await page.evaluate(()=>{document.getSelection=window.h.getSelectionOriginal});await assertRestored();
});

test('failed focus restoration preserves a confirmed copy and still restores scroll and removes the temporary field',async()=>{
  await configure({mode:'absent'});await prepare();
  await page.getByTestId('composer').evaluate(field=>{field.focus=()=>{throw Error('Synthetic restore rejected')}});
  assert.equal(await copy(),true);
  const state=await page.evaluate(()=>({before:window.h.before,after:window.h.snapshot(),temporary:[...document.querySelectorAll('textarea')].filter(node=>!node.hasAttribute('data-testid')).length,caret:[document.querySelector('[data-testid="composer"]').selectionStart,document.querySelector('[data-testid="composer"]').selectionEnd]}));
  assert.deepEqual(state.after.window,state.before.window);assert.deepEqual(state.after.outer,state.before.outer);assert.deepEqual(state.after.inner,state.before.inner);
  assert.equal(state.temporary,0);assert.deepEqual(state.caret,[state.before.start,state.before.end]);
});

for(const variant of ['dialog','drawer'])test('fallback remains inside real '+variant+' focus scope and restores input selection',async()=>{
  await page.evaluate(variant=>window.h.variant(variant),variant);await page.getByRole('dialog').waitFor();
  await configure({mode:'absent'});await prepare('draft');assert.equal(await copy(),true);await assertRestored();
  assert.equal(await page.evaluate(()=>window.h.fallbacks[0].insideDialog),true);
});

test('a modal Dropdown inside a real Dialog retains its active copy selection',async()=>{
  await page.evaluate(()=>window.h.variant('dialog'));await page.getByRole('dialog').waitFor();await configure({mode:'absent'});
  await page.getByTestId('menu-trigger').click();await page.getByRole('menuitem',{name:'Copiar mensagem',exact:true}).click();
  await page.waitForFunction(()=>window.h.result!==undefined);assert.equal(await page.evaluate(()=>window.h.result),true);
  assert.equal(await page.evaluate(()=>window.h.fallbacks[0].insideMenu),true);
  assert.equal(await page.getByRole('menu').count(),0);
  assert.equal(await page.getByTestId('menu-trigger').evaluate(element=>element===document.activeElement),true);
});

test('successful fallback restores a backward contenteditable range',async()=>{
  await configure({mode:'absent'});await prepare('editable');assert.equal(await copy(),true);await assertRestored();
});

test('a late rejected modern write restores the focus present at fallback time, not the old conversation',async()=>{
  await configure({mode:'deferred'});await prepare('composer');await page.getByTestId('copy').click();
  await page.waitForFunction(()=>typeof window.h.rejectModern==='function');await prepare('draft');
  await page.evaluate(()=>window.h.rejectModern(Error('Synthetic async rejection')));await page.waitForFunction(()=>window.h.result!==undefined);
  assert.equal(await page.evaluate(()=>window.h.result),true);await assertRestored();
});

test('without a browser DOM the actual helper returns false rather than throwing',async()=>{
  const fixtureModule={exports:{}},code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(`(function(module,exports){${code}\n})`,{})(fixtureModule,fixtureModule.exports);
  assert.equal(await fixtureModule.exports.copyTextToClipboard('Synthetic'),false);
});
