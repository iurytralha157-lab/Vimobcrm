import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual shared controls, primitives and compiled product CSS. Navigation is synthetic;
// this proves control presentation and callback context, not authenticated chat loading.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidence = 'D:/Vimob/tmp/whatsapp-typography-controls-20261014/mac';
const searchEvidence = process.env.WHATSAPP_HISTORY_SEARCH_EVIDENCE;
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-history-controls-'));
  if (searchEvidence) await mkdir(searchEvidence, { recursive: true });
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}),fs=require('node:fs'),path=require('node:path');module.exports=function(source){
    if(process.env.VIMOB_WHATSAPP_CONTROL_BASELINE==='1'){const rel=path.relative(${JSON.stringify(repository)},this.resourcePath).replaceAll('\\\\','/'),candidate=path.join(${JSON.stringify(join(evidence, 'baseline'))},rel.replaceAll('/','__'));if(!rel.startsWith('..')&&fs.existsSync(candidate))source=fs.readFileSync(candidate,'utf8');}
    return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {ConversationHistorySearch} from ${JSON.stringify(join(repository, 'components/features/whatsapp/conversations/ConversationHistorySearch.tsx'))};
    import {LoadOlderMessagesButton} from ${JSON.stringify(join(repository, 'components/features/whatsapp/LoadOlderMessagesButton.tsx'))};
    const root=createRoot(document.getElementById('root'));
    window.h={props:{},calls:[],render(props=this.props){this.props=props;flushSync(()=>root.render(React.createElement(Host)))}};
    function Host(){const p=h.props;const navigation={open:p.open!==false,query:p.query||'',error:p.error||'',results:p.results||[],hasMore:!!p.hasMore,isSearching:!!p.busy,navigating:!!p.navigating,
      setQuery:value=>{h.calls.push(['query',value]);h.render({...h.props,query:value})},setOpen:value=>{h.calls.push(['open',value]);h.render({...h.props,open:value})},
      search:async()=>h.calls.push(['search']),searchMore:async()=>h.calls.push(['more']),navigateTo:async(id,context)=>h.calls.push(['navigate',id,context])};
      return React.createElement('div',{'data-surface':p.surface||'page',className:p.dialog?'vimob-dialog-content':'',style:{width:p.surface==='float'?'320px':'100%',maxWidth:'100%'}},
        React.createElement(ConversationHistorySearch,{navigation}),React.createElement('div',{className:'flex justify-center py-2'},React.createElement(LoadOlderMessagesButton,{loading:!!p.loading,error:!!p.olderError,onClick:()=>h.calls.push(['older'])})));}
  `);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'controls.js', publicPath: '' },
      resolve: { symlinks: false, extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] }, plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'controls.js'), 'utf8');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/whatsapp/conversations/ConversationHistorySearch.tsx', 'components/features/whatsapp/LoadOlderMessagesButton.tsx', 'components/ui']
    .map(source => `@source "${join(repository, source).replaceAll('\\', '/')}";`).join('\n');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n${sources}`, { from: join(repository, 'app/history-controls-fixture.css') })).css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(directory).startsWith('vimob-history-controls-'));
    await rm(directory, { recursive: true, force: true });
  }
});

async function open(t, props = {}) {
  const page = await browser.newPage(); page.setDefaultTimeout(3500);
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no uncaught browser errors'); assert.deepEqual(network, [], 'no external network'); });
  await page.setViewportSize({ width: props.surface === 'float' ? 390 : 1440, height: 700 });
  await page.setContent(`<style>${css}</style><main class="app-shell" style="padding:16px"><div id="root"></div></main>`);
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(props => h.render(props), props);
  return page;
}

const input = page => page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' });
const calls = page => page.evaluate(() => h.calls);
const result = { id: 'message-canonical', conversation_id: 'conversation-a', session_id: 'session-a', content: 'Resposta sintética', sent_at: '2026-10-14T11:00:00Z' };

test('shared search uses focus-safe mobile text and desktop caption typography in compact/page and dialog hosts', async t => {
  const page = await open(t);
  const measurements = [];
  for (const width of [320, 390, 768, 1440]) for (const surface of ['float', 'page']) {
    await page.setViewportSize({ width, height: 700 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
      for (const dialog of [false, true]) {
        await page.evaluate(props => h.render(props), { surface, dialog });
        await input(page).focus();
        const style = await input(page).evaluate(node => { const s = getComputedStyle(node); return {
          size: s.fontSize, weight: s.fontWeight, height: s.height, radius: s.borderRadius,
          border: s.borderTopWidth, shadow: s.boxShadow, outlineStyle: s.outlineStyle, outlineColor: s.outlineColor,
        }; });
        const { shadow, outlineStyle, outlineColor, ...geometry } = style;
        const size = width < 768 ? '16px' : '12px';
        assert.deepEqual(geometry, { size, weight: '300', height: '32px', radius: '6px', border: '0px' }, `${width}/${surface}/${theme}/${dialog}`);
        assert.equal(await input(page).evaluate(node => getComputedStyle(node, '::placeholder').fontSize), size);
        // Tailwind ring-0 may retain a list of zero-sized shadows; none is equivalent visually.
        assert.ok(shadow === 'none' || (shadow.match(/-?[\d.]+px/g) || []).every(size => Number.parseFloat(size) === 0), `no visible ring: ${shadow}`);
        assert.ok(outlineStyle === 'none' || outlineColor === 'rgba(0, 0, 0, 0)', `no colored outline: ${outlineStyle}/${outlineColor}`);
        assert.deepEqual(await page.getByRole('region', { name: 'Pesquisa no histórico da conversa' }).evaluate(node => {
          const s = getComputedStyle(node); return [s.borderTopWidth, s.borderBottomWidth];
        }), ['0px', '0px'], 'the search block has no black or orange separator');
        const overflow = await page.locator('[data-surface]').evaluate(node => node.scrollWidth > node.clientWidth);
        assert.equal(overflow, false, 'controls fit the compact viewport');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        measurements.push({ width, surface, theme, dialog, ...geometry });
        if (searchEvidence && theme === 'light' && surface === 'page') await page.screenshot({ path: join(searchEvidence, `history-search-${width}-${dialog ? 'dialog' : 'page'}.png`) });
      }
    }
  }
  if (searchEvidence) await writeFile(join(searchEvidence, 'history-search-measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
});

test('empty search has no redundant hint and cannot submit a blank query', async t => {
  const page = await open(t, { surface: 'float' });
  assert.equal(await page.getByText('Digite o texto que deseja encontrar.', { exact: true }).count(), 0);
  assert.equal(await page.locator('section [aria-live]').textContent(), '', 'stable empty live region remains available for result updates');
  assert.equal(await page.getByRole('button', { name: 'Buscar mensagens', exact: true }).isDisabled(), true);
  await input(page).press('Enter');
  await input(page).fill('   '); await input(page).press('Enter');
  assert.deepEqual((await calls(page)).filter(entry => entry[0] === 'search'), []);
});

test('query, Enter and close preserve their navigation callbacks', async t => {
  const page = await open(t);
  assert.equal(await input(page).evaluate(node => node === document.activeElement), true, 'explicitly opened search receives typing focus');
  await input(page).fill('resposta'); await input(page).press('Enter');
  assert.deepEqual(await calls(page), [['query', 'resposta'], ['search']]);
  assert.equal(await input(page).getAttribute('maxlength'), '180');
  await page.getByRole('button', { name: 'Fechar pesquisa' }).click();
  assert.deepEqual((await calls(page)).at(-1), ['open', false]);
  assert.equal(await input(page).count(), 0);
});

test('busy navigation keeps result and continuation actions disabled', async t => {
  const page = await open(t, { query: 'resposta', busy: true, navigating: true, results: [result], hasMore: true });
  assert.equal(await page.getByRole('button', { name: 'Buscar mensagens', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /Resposta sintética/ }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Continuar busca no histórico' }).isDisabled(), true);
  await input(page).press('Enter');
  assert.deepEqual(await calls(page), []);
  assert.equal(await page.getByText('Pesquisando…', { exact: true }).count(), 1);
});

test('search results keep canonical conversation/session context and errors remain visible', async t => {
  const page = await open(t, { query: 'resposta', results: [result], hasMore: true, error: 'Falha sintética de leitura' });
  assert.equal(await page.getByRole('status').textContent(), 'Falha sintética de leitura');
  await page.getByRole('button', { name: /Resposta sintética/ }).click();
  await page.getByRole('button', { name: 'Continuar busca no histórico' }).click();
  assert.deepEqual(await calls(page), [['navigate', result.id, { conversationId: result.conversation_id, sessionId: result.session_id }], ['more']]);
  await page.evaluate(() => h.render({ open: false, error: 'Falha sintética de navegação' }));
  assert.equal(await page.getByRole('status').textContent(), 'Falha sintética de navegação');
});

test('load older uses orange at 50 percent with light standard-sized controls in both hosts', async t => {
  const page = await open(t);
  for (const surface of ['float', 'page']) {
    await page.evaluate(props => h.render(props), { surface });
    const older = page.getByRole('button', { name: 'Carregar mensagens anteriores', exact: true });
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-load-older-messages]');
      if (!node) return false;
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1);
      return Math.abs(context.getImageData(0, 0, 1, 1).data[3] - 128) <= 1;
    }, null, { timeout: 2000 });
    assert.deepEqual(await older.evaluate(node => { const s = getComputedStyle(node); return {
      size: s.fontSize, weight: s.fontWeight, height: s.height, radius: s.borderRadius, border: s.borderTopWidth,
    }; }), { size: '11px', weight: '300', height: '32px', radius: '6px', border: '0px' });
    const color = await older.evaluate(node => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    assert.ok(Math.abs(color[3] - 128) <= 1, `background alpha is 50 percent, actual ${color}`);
    assert.ok(color[0] > color[1] && color[0] > color[2], `uses the orange primary, actual ${color}`);
    await older.click();
  }
  assert.deepEqual(await calls(page), [['older'], ['older']]);
});

test('loading and retry preserve pagination feedback without duplicate actions', async t => {
  const page = await open(t, { loading: true, olderError: true });
  const older = page.getByRole('button', { name: 'Tentar carregar mensagens anteriores', exact: true });
  assert.equal(await older.isDisabled(), true); assert.equal(await older.getAttribute('aria-busy'), 'true');
  assert.equal(await older.locator('svg.animate-spin').count(), 1);
  await older.evaluate(node => node.click());
  assert.deepEqual(await calls(page), []);
  await page.evaluate(() => h.render({ olderError: true }));
  assert.equal(await older.isDisabled(), false); assert.equal(await older.getAttribute('aria-busy'), 'false');
  await older.click(); assert.deepEqual(await calls(page), [['older']]);
});
