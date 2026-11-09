import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Real controls and CSS; callers, image delivery and media download stay synthetic.
// The browser blocks every external request; no CRM provider, account or API is used.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const evidence = process.env.WHATSAPP_VISUAL_CLOSURE_EVIDENCE;
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-visual-closure-'));
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  const mentions = join(directory, 'mentions.js'), image = join(directory, 'image.js'), download = join(directory, 'download.js');
  const filters = join(directory, 'filters.js'), dateFilter = join(directory, 'date-filter.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}),fs=require('node:fs'),path=require('node:path');module.exports=function(s){const baseline=process.env.WHATSAPP_VISUAL_CLOSURE_BASELINE;if(baseline){const relative=path.relative(${JSON.stringify(repository)},this.resourcePath).split(path.sep).join('/'),candidate=path.join(baseline,relative.replaceAll('/','__')+'.before');if(!relative.startsWith('..')&&fs.existsSync(candidate))s=fs.readFileSync(candidate,'utf8');}return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(mentions, 'export const useMentionNames=()=>({});');
  await writeFile(image, `import React from 'react';export default function Image({unoptimized,...p}){return React.createElement('img',p);}`);
  await writeFile(download, `export {getSafeMessageMediaUrl,sanitizeMediaFilename} from ${JSON.stringify(join(repository, 'components/features/whatsapp/message-media.ts'))};export const downloadMessageMedia=async()=>{h.calls.push(['download']);return 'downloaded';};`);
  await writeFile(filters, `import React from 'react';export const SharedFilters=p=>React.createElement('div',null,p.advancedContent);`);
  await writeFile(dateFilter, 'export const DateFilterPopover=()=>null;');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {ConversationHeaderActions} from '@/components/features/whatsapp/conversations/ConversationHeaderActions';
    import {ConversationFilters} from '@/components/features/whatsapp/conversations/ConversationFilters';
    import {ConversationHistorySearch} from '@/components/features/whatsapp/conversations/ConversationHistorySearch';
    import {ConversationLeadTagBar} from '@/components/features/whatsapp/conversations/ConversationLeadTagBar';
    import {ConversationList} from '@/components/features/whatsapp/conversations/ConversationList';
    import {ConversationListPreview} from '@/components/features/whatsapp/conversations/ConversationListPreview';
    import {MessageStatus} from '@/components/features/whatsapp/message-bubble/MessageStatus';
    import {MessageReactionPicker} from '@/components/features/whatsapp/message-bubble/MessageReactions';
    import {LoadOlderMessagesButton} from '@/components/features/whatsapp/LoadOlderMessagesButton';
    import {MediaViewer} from '@/components/features/whatsapp/MediaViewer';
    import {OwnWhatsAppStartNotice} from '@/components/features/whatsapp/OwnWhatsAppStartNotice';
    const root=createRoot(document.getElementById('root')),noop=()=>{},png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
    window.h={mode:'header',props:{},calls:[],escapes:0,render(mode=this.mode,p=this.props){this.mode=mode;this.props=p;flushSync(()=>root.render(React.createElement(Host)));}};
    window.addEventListener('keydown',e=>{if(e.key==='Escape')h.escapes++;});
    const options=[{id:'tag-a',name:'Financiamento sintético',color:'#6b7280'}],tags=[{tag:{id:'tag-existing',name:'Tag atribuída sintética',color:'#0891b2'}}];
    const conversation={id:'chat-a',lead_id:'lead-a',session_id:'session-a',contact_name:'Ana sintética',last_message:'Mensagem sintética',last_message_from_me:true,last_message_status:'queued',contact_picture:null,lead:{id:'lead-a',name:'Ana sintética',tags:[]},contact_phone:null,remote_jid:'5511999998888@s.whatsapp.net',unread_count:0,is_group:false,last_message_at:'2026-10-14T10:00:00Z'};
    const navigation=p=>({open:p.open!==false,query:p.query||'',error:p.error||'',results:p.results||[],hasMore:!!p.hasMore,isSearching:!!p.busy,navigating:!!p.navigating,setQuery:q=>{h.calls.push(['query',q]);h.render('history',{...p,query:q});},setOpen:o=>{h.calls.push(['open',o]);h.render('history',{...p,open:o});},search:async()=>h.calls.push(['search']),searchMore:async()=>h.calls.push(['more']),navigateTo:async(id,scope)=>h.calls.push(['navigate',id,scope])});
    function Host(){const p=h.props;
      if(h.mode==='header')return React.createElement(ConversationHeaderActions,{leadId:'lead-a',canOperate:p.canOperate!==false,onArchive:()=>h.calls.push(['archive']),onDelete:()=>h.calls.push(['remove']),onReassignLead:noop,onSearch:noop,onToggleLeadPanel:noop,isArchiving:!!p.busy});
      if(h.mode==='filters')return React.createElement(ConversationFilters,{layout:p.mobile?'mobile':'desktop',activePlatform:'whatsapp',sessions:[],currentChannelValue:'whatsapp-all',optionsHasMore:false,optionsLoadingMore:false,showArchived:false,onlyLeads:false,withoutLeadOnly:false,pendingReplyOnly:false,tagIds:[],campaignIds:[],activeFilterCount:0,searchTerm:p.query||'',onSearchTermChange:q=>{h.calls.push(['main-query',q]);h.render('filters',{...p,query:q});}});
      if(h.mode==='history')return React.createElement(React.Fragment,null,React.createElement('button',{id:'history-trigger',onClick:()=>h.render('history',{...p,open:true})},'Pesquisar nesta conversa'),React.createElement(ConversationHistorySearch,{navigation:navigation(p),onClose:()=>{h.calls.push(['restore-focus']);document.getElementById('history-trigger').focus();}}));
      if(h.mode==='tags')return React.createElement(ConversationLeadTagBar,{tags:p.tags===false?[]:tags,availableTags:p.cold?[]:options,canManage:p.canManage!==false,busy:!!p.busy,loading:!!p.loading,failed:!!p.failed,onRetry:()=>h.calls.push(['retry']),onAdd:id=>h.calls.push(['add',id]),onRemove:id=>h.calls.push(['remove-tag',id])});
      if(h.mode==='list')return React.createElement(ConversationList,{layout:'desktop',channel:'whatsapp',conversations:p.empty||p.loading&&!p.keepRows?[]:[conversation],isLoading:!!p.loading,isSearching:!!p.searching,isError:false,onRetry:noop,canManageWhatsApp:false,onConnectWhatsApp:noop,canOperate:false,canManageTags:false,canCreateLead:false,availableTags:[],onSelect:noop,onArchive:noop,onDelete:noop,onAddTag:noop,onRemoveTag:noop,onCreateLead:noop,formatTime:()=> '10:00',hasMoreConversations:true,isLoadingMoreConversations:!!p.busy,onLoadMoreConversations:()=>h.calls.push(['more-conversations'])});
      if(h.mode==='status')return React.createElement(React.Fragment,null,React.createElement(MessageStatus,{fromMe:p.fromMe!==false,status:p.status||'queued'}),React.createElement(ConversationListPreview,{conversation:{...conversation,contact_presence:p.presence===false?null:'composing',presence_updated_at:new Date().toISOString()}}),React.createElement(LoadOlderMessagesButton,{loading:!!p.busy,onClick:()=>h.calls.push(['older'])}));
      if(h.mode==='reactions')return React.createElement(MessageReactionPicker,{fromMe:false,reactions:[],isReacting:!!p.busy,onReact:emoji=>h.calls.push(['reaction',emoji])});
      if(h.mode==='own-start')return React.createElement(OwnWhatsAppStartNotice,{notice:p.none?null:{kind:p.connect?'connect':'start',ownConnectedSessionIds:p.connect?[]:['session-a']},unavailableReason:p.unavailableReason,onRetry:()=>h.calls.push(['retry-session']),busy:!!p.busy,onStart:()=>h.calls.push(['start-own'])});
      if(h.mode==='viewer')return React.createElement(MediaViewer,{src:png,type:'image',isOpen:p.open!==false,onClose:()=>{h.calls.push(['viewer-close']);h.render('viewer',{...p,open:false});},messageId:'image-a',filename:'Primeira.png',galleryScopeKey:'synthetic-viewer',gallery:[{id:'image-a',url:png,type:'image',filename:'Primeira.png'},{id:'image-b',url:png,type:'image',filename:'Segunda.png'}]});
      return null;
    }`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'fixture.js', publicPath: '' },
      resolve: { symlinks: false, extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: {
        'next/image': image, './message-media$': download, '@/hooks/use-mention-names': mentions,
        '@/components/shared/SharedFilters': filters, '@/components/ui/date-filter-popover': dateFilter, '@': repository,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] }, plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n@source "${join(repository, 'components/features/whatsapp').replaceAll('\\', '/')}";\n@source "${join(repository, 'components/ui').replaceAll('\\', '/')}";\n@source "${join(repository, 'config').replaceAll('\\', '/')}";`, { from: join(repository, 'app/visual-closure-fixture.css') })).css;
  browser = await chromium.launch({ headless: true });
  if (evidence) await mkdir(evidence, { recursive: true });
}, { timeout: 300000 });

after(async () => {
  await browser?.close();
  if (directory) { const target = resolve(directory); assert.ok(target.startsWith(resolve(tmpdir()) + sep)); assert.match(basename(target), /^vimob-visual-closure-/); await rm(target, { recursive: true, force: true }); }
});

async function open(t, mode, props = {}) {
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } }); page.setDefaultTimeout(3500);
  const errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message)); await page.route('**/*', r => { network.push(r.request().url()); return r.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no uncaught errors'); assert.deepEqual(network, [], 'no external network'); });
  await page.setContent(`<style>${css}</style><main class="app-shell" style="min-height:100vh;padding:12px"><div id="root"></div></main>`);
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle }); await page.evaluate(({ mode, props }) => h.render(mode, props), { mode, props }); return page;
}
async function render(page, props) { await page.evaluate(props => h.render(h.mode, props), props); }
const computed = node => { const s = getComputedStyle(node); return { size: s.fontSize, weight: s.fontWeight, radius: s.borderRadius, height: s.height }; };
async function screen(page, name) { if (evidence) await page.screenshot({ path: join(evidence, name), fullPage: true }); }

test('header menu stays12/300 radius6 and callbacks work across320/390/1440 themes', async t => {
  const page = await open(t, 'header');
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    await page.getByRole('button', { name: 'Mais ações da conversa' }).click();
    for (const item of await page.getByRole('menuitem').all()) assert.deepEqual(await item.evaluate(computed), { size: '12px', weight: '300', radius: '6px', height: '32px' });
    if (width === 320 || width === 1440) await screen(page, `header-menu-${width}-${theme}.png`);
    await page.getByRole('menuitem', { name: 'Arquivar', exact: true }).click();
  }
  assert.equal(await page.evaluate(() => h.calls.filter(c => c[0] === 'archive').length), 6);
  await render(page, { canOperate: false }); await expect(page.getByRole('button', { name: 'Mais ações da conversa' })).toBeDisabled();
});

test('actual main search remains12/300 h32 and deleted filter controls are absent', async t => {
  const page = await open(t, 'filters'); const field = page.getByRole('textbox', { name: 'Buscar conversas' });
  await expect(page.getByRole('textbox',{name:'Buscar opções de filtro nas conversas',exact:true})).toHaveCount(0);
  await expect(page.getByText('Última mensagem',{exact:true})).toHaveCount(0);
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    await field.focus(); assert.deepEqual(await field.evaluate(computed), { size: '12px', weight: '300', radius: '6px', height: '32px' });
    assert.equal(await field.evaluate(n => getComputedStyle(n).borderTopWidth), '0px');
    assert.equal(await field.evaluate(n => getComputedStyle(n, '::placeholder').fontSize), '12px');
    // Compare rendered colors, accounting for Chromium's equivalent rgb/rgba serialization.
    await expect.poll(() => field.evaluate(n => {
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      context.fillStyle = getComputedStyle(n).backgroundColor; context.fillRect(0, 0, 1, 1);
      const actual = [...context.getImageData(0, 0, 1, 1).data]; context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--app-surface-hover').trim(); context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].every((value, index) => Math.abs(value - actual[index]) <= 1);
    })).toBe(true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (width === 320 || width === 1440) await screen(page, `filter-${width}-${theme}.png`);
  }
  await field.fill('Visita'); assert.deepEqual(await page.evaluate(() => h.calls.at(-1)), ['main-query', 'Visita']);
});

test('cached tags stay selectable during refresh/error; cold and busy states preserve exact actions', async t => {
  const page = await open(t, 'tags'); await page.getByRole('button', { name: 'Adicionar tag', exact: true }).click();
  const option = page.getByRole('button', { name: 'Financiamento sintético', exact: true });
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    for (const props of [{ loading: true }, { failed: true }, {}]) { await render(page, props); await expect(option).toBeVisible(); }
  }
  await option.click(); assert.deepEqual(await page.evaluate(() => h.calls), [['add', 'tag-a']]);
  await render(page, { busy: true }); await expect(page.getByRole('button', { name: 'Adicionar tag', exact: true })).toBeDisabled();
  await render(page, {});
  const remove = page.getByRole('button', { name: 'Remover tag Tag atribuída sintética', exact: true });
  assert.deepEqual(await remove.evaluate(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })), { width: 24, height: 24 });
  await remove.click(); assert.deepEqual(await page.evaluate(() => h.calls.at(-1)), ['remove-tag', 'tag-existing']);
  await page.keyboard.press('Escape'); await render(page, { cold: true, loading: true }); await page.getByRole('button', { name: 'Adicionar tag', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Carregando tags...'); await expect(option).toHaveCount(0);
  await render(page, { cold: true, failed: true }); await page.getByRole('button', { name: 'Tentar novamente' }).click(); assert.deepEqual(await page.evaluate(() => h.calls.at(-1)), ['retry']);
});

test('history Escape closes only search and returns focus; X and canonical navigation remain intact', async t => {
  const page = await open(t, 'history', { query: 'resposta' }); const field = page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' });
  await field.press('Escape'); await expect(field).toHaveCount(0); await expect(page.getByRole('button', { name: 'Pesquisar nesta conversa' })).toBeFocused();
  assert.equal(await page.evaluate(() => h.escapes), 0); assert.deepEqual(await page.evaluate(() => h.calls), [['open', false], ['restore-focus']]);
  await page.getByRole('button', { name: 'Pesquisar nesta conversa' }).click(); await field.press('Enter'); assert.deepEqual(await page.evaluate(() => h.calls.at(-1)), ['search']);
  await page.getByRole('button', { name: 'Fechar pesquisa' }).click(); await expect(page.getByRole('button', { name: 'Pesquisar nesta conversa' })).toBeFocused();
  await render(page, { query: 'resposta', results: [{ id: 'message-a', conversation_id: 'chat-a', session_id: 'session-a', sent_at: '2026-10-14T10:00:00Z', content: 'Resposta sintética' }] });
  await page.getByRole('button', { name: /Resposta sintética/ }).click(); assert.deepEqual(await page.evaluate(() => h.calls.at(-1)), ['navigate', 'message-a', { conversationId: 'chat-a', sessionId: 'session-a' }]);
});

test('receipt and presence do not blink, including when delivery status changes', async t => {
  const page = await open(t, 'status');
  const queued = page.getByRole('img', { name: 'Mensagem na fila' });
  await expect(queued).toHaveCSS('animation-name', 'none');
  const size = await queued.evaluate(node => [node.getBoundingClientRect().width, node.getBoundingClientRect().height]);
  const presence = page.locator('[data-conversation-preview-text]');
  await expect(presence).toHaveCSS('animation-name', 'none');
  for (const [status, label] of [['confirming', 'Confirmando envio'], ['delivered', 'Mensagem entregue'], ['read', 'Mensagem lida']]) {
    await render(page, { status });
    const receipt = page.getByRole('img', { name: label });
    await expect(receipt).toHaveCSS('animation-name', 'none');
    assert.deepEqual(await receipt.evaluate(node => [node.getBoundingClientRect().width, node.getBoundingClientRect().height]), size);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('img', { name: 'Mensagem lida' })).toHaveCSS('transition-duration', '0s');
  await expect(presence).toHaveCSS('transition-duration', '0s');
});

test('reduced motion stops loading animations while accessible status remains', async t => {
  const page = await open(t, 'status', { busy: true }); await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const animation of await page.locator('.animate-pulse,.animate-spin').all()) await expect(animation).toHaveCSS('animation-name', 'none');
  await expect(page.getByRole('img', { name: 'Mensagem na fila' })).toBeVisible();
  await expect(page.locator('[data-conversation-receipt-slot]')).toHaveCount(0);
  await render(page, { presence: false, busy: true });
  assert.equal(await page.locator('[data-conversation-receipt-slot]').evaluate(n => n.getBoundingClientRect().width), 20);
  await page.evaluate(() => h.render('list', { loading: true })); await expect(page.getByRole('status', { name: 'Carregando conversas' })).toBeVisible();
  await page.evaluate(() => h.render('list', { busy: true })); const more = page.getByRole('button', { name: 'Carregar mais conversas', exact: true });
  await expect(more).toBeDisabled(); assert.equal(await more.getAttribute('aria-busy'), 'true'); await more.evaluate(n => n.click()); assert.deepEqual(await page.evaluate(() => h.calls), []);
  await render(page, {}); await more.click(); assert.deepEqual(await page.evaluate(() => h.calls), [['more-conversations']]);
});

test('search pending retains loaded cards and postpones the empty state until completion', async t => {
  const page = await open(t, 'list', { loading: true, searching: true, keepRows: true });
  await expect(page.getByText('Ana Sintética', { exact: true })).toBeVisible(); await expect(page.getByRole('status')).toHaveText('Buscando conversas...');
  await render(page, { searching: true, empty: true }); await expect(page.getByRole('status')).toHaveText('Buscando conversas...');
  await expect(page.getByText('Nenhuma conversa no WhatsApp', { exact: true })).toHaveCount(0);
  await render(page, { empty: true }); await expect(page.getByText('Nenhuma conversa no WhatsApp', { exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => h.calls), []);
  await render(page, {});
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    await screen(page, `conversation-card-${width}-${theme}.png`);
  }
});

test('reaction search remains usable without borders and custom emoji keeps one callback', async t => {
  const page = await open(t, 'reactions'); await page.getByRole('button', { name: 'Reagir à mensagem' }).click(); await page.getByRole('button', { name: 'Mais emojis' }).click();
  const search = page.getByRole('textbox', { name: 'Buscar emoji' }); await search.fill('CORAÇÃO'); await expect(page.getByRole('button', { name: 'Reagir com 💙', exact: true })).toBeVisible();
  assert.equal(await search.evaluate(n => getComputedStyle(n).borderTopWidth), '0px');
  const emoji = page.getByRole('textbox', { name: 'Outro emoji' }); await emoji.fill('👨‍👩‍👧‍👦'); await emoji.press('Enter');
  assert.deepEqual(await page.evaluate(() => h.calls), [['reaction', '👨‍👩‍👧‍👦']]);
  await render(page, { busy: true }); const trigger = page.getByRole('button', { name: 'Aplicando reação' }); await expect(trigger).toBeDisabled(); assert.equal(await trigger.getAttribute('aria-busy'), 'true');
});

test('own WhatsApp notice preserves unavailable reasons and only offers truthful connect or start actions', async t => {
  const page = await open(t, 'own-start', { unavailableReason: 'read_only' });
  await expect(page.getByRole('status')).toHaveText('Envios indisponíveis nesta prévia em somente leitura'); await expect(page.getByRole('button')).toHaveCount(0); await expect(page.getByRole('link')).toHaveCount(0);
  await render(page, { unavailableReason: 'sessions_failed' }); await expect(page.getByRole('status')).toHaveText('Não foi possível verificar a conexão do WhatsAppTentar novamente');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); assert.deepEqual(await page.evaluate(() => h.calls), [['retry-session']]);
  await expect(page.getByRole('button', { name: 'Iniciar conversa pelo seu WhatsApp' })).toHaveCount(0);
  await render(page, { connect: true }); const connect = page.getByRole('link', { name: 'Conecte o WhatsApp para iniciar o atendimento deste lead', exact: true }); await expect(connect).toHaveAttribute('href', '/settings?tab=whatsapp');
  await render(page, {}); const start = page.getByRole('button', { name: 'Iniciar conversa pelo seu WhatsApp', exact: true }); await start.click(); assert.deepEqual(await page.evaluate(() => h.calls.at(-1)), ['start-own']);
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    assert.equal(await start.evaluate(n => getComputedStyle(n).color), 'rgb(255, 255, 255)');
    assert.equal(await start.locator('..').evaluate(n => getComputedStyle(n).borderTopWidth), '0px');
    const background = await start.locator('..').evaluate(n => {
      const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.fillStyle = getComputedStyle(n).backgroundColor; ctx.fillRect(0, 0, 1, 1);
      const actual = [...ctx.getImageData(0, 0, 1, 1).data]; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = 'rgba(255,69,41,0.5)'; ctx.fillRect(0, 0, 1, 1);
      return { actual, expected: [...ctx.getImageData(0, 0, 1, 1).data] };
    }); assert.deepEqual(background.actual, background.expected);
    assert.deepEqual(await start.evaluate(computed), { size: '11px', weight: '300', radius: '6px', height: '32px' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false); await screen(page, `own-start-${width}-${theme}.png`);
  }
  await render(page, { busy: true }); await expect(start).toBeDisabled(); await expect(start).toHaveAttribute('aria-busy', 'true');
  await render(page, { none: true }); await expect(start).toHaveCount(0);
});

test('gallery with navigation and zoom fits320/390/1440 and keeps close reachable', async t => {
  const page = await open(t, 'viewer'); await expect(page.getByRole('button', { name: 'Aumentar zoom' })).toBeVisible();
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    const bounds = await page.getByRole('button', { name: 'Fechar visualizador' }).locator('..').evaluate(n => { const r = n.getBoundingClientRect(); return [...n.querySelectorAll('button')].map(b => { const v = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), left: v.left >= r.left, right: v.right <= r.right, width: v.width, height: v.height }; }); });
    assert.equal(bounds.length, 5); assert.ok(bounds.every(b => b.left && b.right), `${width}/${theme}: toolbar controls remain inside dialog`);
    assert.ok(bounds.every(b => b.width === (width < 640 ? 32 : 40) && b.height === (width < 640 ? 32 : 40)));
    const close = page.getByRole('button', { name: 'Fechar visualizador' }); const zoom = page.getByRole('button', { name: 'Aumentar zoom' });
    const a = await close.boundingBox(), b = await zoom.boundingBox(); assert.ok(a.x >= b.x + b.width || a.y >= b.y + b.height || b.y >= a.y + a.height, 'close never overlaps zoom');
    await screen(page, `gallery-${width}-${theme}.png`);
  }
  await page.getByRole('button', { name: 'Aumentar zoom' }).click(); await expect(page.getByText('125%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próxima mídia' }).click(); await expect(page.getByRole('dialog', { name: 'Segunda.png' })).toBeVisible();
  await page.getByRole('dialog').press('ArrowLeft'); await expect(page.getByRole('dialog', { name: 'Primeira.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar visualizador' }).click(); assert.deepEqual(await page.evaluate(() => h.calls), [['viewer-close']]);
});
