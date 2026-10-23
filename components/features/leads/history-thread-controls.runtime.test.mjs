import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { buildLeadHistory } from '../../../hooks/lead-history/build-history.ts';

// Actual LeadUnifiedThread and message-navigation hook in Chromium. Auth, query
// outcomes and unrelated WhatsApp controls are synthetic; no CRM/API is started.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-lead-history-controls-'));
  const aliases = {};
  const h = 'const h=()=>window.harness;';
  async function mock(name, source) {
    const path = join(directory, `${Object.keys(aliases).length}.js`);
    await writeFile(path, source);
    aliases[name] = path;
  }
  await mock('@/contexts/AuthContext', `${h} export const useAuth=()=>h().auth;`);
  await mock('@/hooks/use-user-permissions', 'export const useUserPermissions=()=>({hasPermission:()=>true});');
  await mock('@/hooks/use-organization-modules', 'export const useOrganizationModules=()=>({hasModule:()=>true});');
  await mock('@/hooks/use-whatsapp-query-scope', `${h} export const useWhatsAppQueryScope=()=>h().scope;`);
  await mock('@/hooks/use-lead-history', `${h} export const useLeadHistory=()=>h().history;`);
  await mock('@/hooks/use-lead-messages', `${h} export const useLeadMessages=()=>h().messages;`);
  await mock('@/hooks/use-accessible-sessions', 'export const useAccessibleSessions=()=>({data:[],isLoading:false});');
  await mock('@/hooks/use-whatsapp-conversation-draft', `${h} export const useWhatsAppConversationDraft=()=>{h().writeHookMounts++;return h().draft};`);
  await mock('@/hooks/use-whatsapp-thread-scroll', 'export const useWhatsAppThreadScroll=()=>({onScroll:()=>{},showScrollToLatest:false,loadOlderPreservingPosition:fn=>fn()});');
  await mock('@/hooks/use-whatsapp-media-gallery', 'export const useWhatsAppMediaGallery=()=>({});');
  await mock('@/hooks/use-whatsapp-attachments', `${h} export const useWhatsAppAttachments=()=>{h().writeHookMounts++;return{}};`);
  await mock('@/hooks/integrations/whatsapp/use-own-whatsapp-session-selection', 'export const useOwnWhatsAppSessionSelection=()=>({ownConnectedSessions:[],selectedOwnSessionId:null});');
  await mock('@/hooks/use-whatsapp-attendance', `${h} export const useWhatsAppAttendanceGate=()=>{h().writeHookMounts++;return{dialogProps:{open:false}}};`);
  await mock('@/hooks/use-start-conversation', `${h} export const useStartConversation=()=>{h().writeHookMounts++;return h().mutation};`);
  await mock('@/hooks/use-whatsapp-conversations', `${h}
    export const useWhatsAppConversations=(session,filters,sessionIds,limit,options)=>{h().passive={session,filters,sessionIds,limit,options};return{data:[]}};
    export const useSendWhatsAppMessage=()=>{h().writeHookMounts++;return h().mutation};
    export const useReactToWhatsAppMessage=()=>{h().writeHookMounts++;return h().mutation};
    export const useLinkConversationToLead=()=>{h().writeHookMounts++;return h().mutation};
    export const useResolveWhatsAppSendIntent=()=>()=>{};
    export const useDiscardFailedLocalWhatsAppMessage=()=>()=>{};
    export const useWhatsAppLeadRealtime=(enabled,leadIds,options)=>{h().realtime={enabled,leadIds,options}};`);
  await mock('@/lib/api/whatsapp', 'export const whatsappAPI=new Proxy({},{get(){throw Error("Unexpected HTTP in history-controls test");}});');
  await mock('@/components/features/whatsapp$', `export const LoadOlderMessagesButton=()=>null;
    export {DateSeparator} from '@/components/features/whatsapp/DateSeparator';
    export {ScrollToLatestButton} from '@/components/features/whatsapp/ScrollToLatestButton';`);
  for (const [path, name] of [
    ['AudioRecorderButton', 'AudioRecorderButton'], ['AttachmentPreviewComposer', 'AttachmentPreviewComposer'],
    ['EnterAttendanceDialog', 'EnterAttendanceDialog'], ['ConfirmConversationLeadLinkDialog', 'ConfirmConversationLeadLinkDialog'],
    ['OwnWhatsAppStartNotice', 'OwnWhatsAppStartNotice'],
  ]) await mock(`@/components/features/whatsapp/${path}`, `export const ${name}=()=>null;`);
  await mock('@/components/features/whatsapp/MessageBubble', `import React from 'react';
    export const MessageBubble=p=>React.createElement('div',{'data-message-id':p.messageId},p.content,
      React.createElement('button',{onClick:()=>void p.onNavigateQuoted('missing-quote')},'Abrir mensagem citada'));`);
  await mock('@/components/ui/avatar', `import React from 'react';
    export const Avatar=({children})=>React.createElement('span',null,children);
    export const AvatarFallback=Avatar;export const AvatarImage=()=>null;`);
  const loader = join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{LeadUnifiedThread}from'@/components/features/leads/LeadUnifiedThread';
    import{ConversationHistorySearch}from'@/components/features/whatsapp/conversations/ConversationHistorySearch';
    import{useWhatsAppMessageNavigation}from'@/hooks/use-whatsapp-message-navigation';
    const root=createRoot(document.getElementById('root')),noop=()=>{};
    const h=window.harness={auth:{activeOrganization:{organizationId:'org-a'},profile:{id:'user-a',organization_id:'org-a'},user:{id:'user-a'}},
      scope:{organizationId:'org-a',userId:'user-a',accessScope:'read'},historyReads:0,messageReads:0,olderReads:0,
      draft:{text:'',setText:noop,clearConversation:noop},mutation:{isPending:false,mutateAsync:input=>{window.harness.writes.push(input);throw Error('Unexpected history write')},mutate:input=>{window.harness.writes.push(input);throw Error('Unexpected history write')}},
      history:{data:[],isLoading:false,isFetching:false,isError:false,hasOlderHistory:false},
      messages:{data:[],isLoading:false,isError:false,hasOlderMessages:false,isLoadingOlder:false},
      mode:'lead',writeHookMounts:0,writes:[],realtime:null,
      render(){flushSync(()=>root.render(React.createElement(App)));}};
    h.history.refetch=async()=>{h.historyReads++;h.history.isError=false;h.render();return{isError:false};};
    h.messages.refetch=async()=>{h.messageReads++;return{isError:false};};
    h.messages.loadOlderMessages=async()=>{h.olderReads++;return{data:{pages:[]},isError:false,isFetchNextPageError:false,hasNextPage:false};};
    function SearchProbe(){const n=useWhatsAppMessageNavigation({scopeKey:'whatsapp',messages:[{id:'probe',content:'Texto sintético',sent_at:'2026-10-16T10:00:00Z'}]});
      return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>n.setOpen(true)},'Abrir busca WhatsApp'),React.createElement(ConversationHistorySearch,{navigation:n}));}
    function App(){return h.mode==='search'?React.createElement(SearchProbe):React.createElement(LeadUnifiedThread,{leadId:'lead-a',leadName:'Lead sintético',historyPagination:true});}
    h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error)
      : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });

after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'vimob-lead-history-controls-')));
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(t) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  t.after(async () => { try { assert.deepEqual(errors, []); } finally { await page.close(); } });
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('log', { name: 'Histórico de mensagens do lead' }).waitFor();
  return page;
}

// History surface assertions
test('lead history has no search button or search panel', async t => {
    const page = await fixture(t);
    assert.equal(await page.getByRole('button', { name: /Buscar.*histórico do lead|Buscar mensagens/ }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Pesquisa no histórico da conversa' }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' }).count(), 0);
});

test('history activity retry refetches activities only and recovers the alert', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.harness.history.isError = true; window.harness.render(); });
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o histórico de atividades.' }).waitFor();
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => [window.harness.historyReads, window.harness.messageReads]), [1, 0]);
  assert.equal(await page.getByRole('alert').count(), 0);
});

test('quoted-message navigation still reports an unavailable message without showing search', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const h = window.harness;
    h.messages.data = [{ id: 'message-a', conversation_id: 'chat-a', session_id: 'session-a', lead_id: 'lead-a',
      message_type: 'text', content: 'Mensagem sintética', sent_at: '2026-10-16T12:00:00Z', from_me: false }];
    h.render();
  });
  await page.getByRole('button', { name: 'Abrir mensagem citada', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Não foi possível localizar a mensagem.' }).waitFor();
  assert.equal(await page.evaluate(() => window.harness.olderReads), 1);
  assert.equal(await page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' }).count(), 0);
});

test('the shared WhatsApp search remains usable outside the lead history', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.harness.mode = 'search'; window.harness.render(); });
  await page.getByRole('button', { name: 'Abrir busca WhatsApp' }).click();
  await page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' }).fill('sintético');
  await page.getByRole('button', { name: 'Buscar mensagens', exact: true }).click();
  await page.getByText('1 resultado(s)', { exact: true }).waitFor();
});

test('legacy history omits the fixed notice while preserving cached events and incomplete coverage', async t => {
  const page = await fixture(t);
  const notice = page.getByRole('status').filter({ hasText: 'Algumas atividades antigas podem não estar disponíveis neste histórico.' });
  assert.equal(await notice.count(), 0);
  await page.evaluate(() => {
    const h = window.harness;
    h.history.data = [{ id: 'legacy-note-a', type: 'note', label: 'Nota adicionada',
      content: 'Anotação sintética preservada', timestamp: '2026-10-16T12:00:00Z', source: 'activity' }];
    h.cachedHistoryEvents = h.history.data;
    h.history.historyComplete = false;
    h.history.historyPaginationUnavailable = true;
    h.render();
  });
  await page.getByText('Anotação sintética preservada', { exact: true }).waitFor();
  assert.equal(await notice.count(), 0);
  assert.deepEqual(await page.evaluate(() => ({
    incomplete: window.harness.history.historyComplete === false,
    unavailable: window.harness.history.historyPaginationUnavailable,
    sameEvents: window.harness.history.data === window.harness.cachedHistoryEvents,
    eventIds: window.harness.history.data.map(event => event.id),
    reads: [window.harness.historyReads, window.harness.messageReads],
  })), { incomplete: true, unavailable: true, sameEvents: true, eventIds: ['legacy-note-a'], reads: [0, 0] });
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Tentar novamente' }).count(), 0);
  await page.evaluate(() => { window.harness.history.historyPaginationUnavailable = false; window.harness.render(); });
  assert.equal(await notice.count(), 0);
  assert.equal(await page.getByText('Anotação sintética preservada', { exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.harness.history.historyComplete), false);
});

for (const width of [320, 390, 1440]) {
  test(`Agenda history renders authorized context and restricted facts at ${width}px`, async t => {
    const page = await fixture(t);
    await page.setViewportSize({ width, height: 900 });
    const labels = ['Atividade agendada', 'Atividade remarcada', 'Atividade concluída',
      'Cliente não compareceu', 'Atividade cancelada', 'Comentário em atividade', 'Atividade atualizada'];
    const actions = ['created', 'rescheduled', 'completed', 'no_show', 'cancelled', 'commented', 'updated'];
    const rows = actions.map((action, index) => ({ id: `agenda-${index}`, event_type: `agenda_${action}`,
      created_at: `2026-10-19T12:0${index}:00Z`, metadata: {
        event_title: `Compromisso sintético ${index}`, start_time: '2026-10-20T12:00:00Z', time_zone: 'America/Sao_Paulo',
      } }));
    rows.push({ id: 'cancelled-restricted', event_type: 'agenda_cancelled', created_at: '2026-10-19T12:10:00Z' });
    const events = buildLeadHistory({ timelineEvents: rows, historyCoverage: { complete: false,
      canonicalPresence: { leadCreated: false, firstResponse: false, assignment: false } } }, 'lead-a', {
      formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String,
    });
    await page.evaluate(events => {
      window.harness.history.data = events;
      window.harness.render();
    }, events);
    for (const label of labels) await page.getByText(label, { exact: true }).first().waitFor();
    for (let index = 0; index < actions.length; index++) {
      const row = page.locator(`[data-thread-item-id="event-timeline-agenda-${index}"]`);
      assert.ok((await row.textContent()).includes(`Compromisso sintético ${index}`));
      assert.ok((await row.textContent()).includes('20/10/2026 às 09:00'));
      assert.equal((await row.textContent()).includes('2026-10-20T'), false);
    }
    const restricted = page.locator('[data-thread-item-id="event-timeline-cancelled-restricted"]');
    assert.ok((await restricted.textContent()).includes('Atividade cancelada'));
    assert.equal((await restricted.textContent()).includes('Compromisso sintético'), false);
    assert.equal((await restricted.textContent()).includes('20/10/2026'), false);
    assert.deepEqual(await page.evaluate(() => [window.harness.historyReads, window.harness.messageReads]), [0, 0]);
  });
}

for (const width of [1366, 390]) test(`read-only history preserves data, quote navigation, passive reads and realtime wiring without mounting writers at ${width}px`, async t => {
  const page = await fixture(t);
  await page.setViewportSize({ width, height: 844 });
  const history = buildLeadHistory({
    activityEvents: [
      { id: 'feedback-a', type: 'note', content: 'Feedback ativo preservado', created_at: '2026-10-19T12:00:00Z', metadata: { kind: 'feedback' } },
      { id: 'property-a', type: 'property_selected', content: 'Imóvel ativo preservado', created_at: '2026-10-19T12:01:00Z', metadata: { property_code: 'QA-001', property_title: 'Imóvel ativo preservado' } },
    ],
    timelineEvents: [{ id: 'agenda-a', event_type: 'agenda_created', created_at: '2026-10-19T12:02:00Z',
      metadata: { event_title: 'Agenda ativa preservada', start_time: '2026-10-20T12:00:00Z', time_zone: 'America/Sao_Paulo' } }],
  }, 'lead-a', { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String });
  await page.evaluate(history => {
    const h = window.harness;
    h.history.data = history;
    h.messages.data = [{ id: 'message-a', conversation_id: 'chat-a', session_id: 'session-a', lead_id: 'lead-a',
      message_type: 'text', content: 'Mensagem ativa preservada', sent_at: '2026-10-19T12:03:00Z', from_me: false }];
    h.render();
  }, history);
  for (const text of ['Feedback ativo preservado', 'Mensagem ativa preservada', 'Agenda ativa preservada'])
    await page.getByText(text, { exact: false }).first().waitFor();
  assert.ok((await page.getByRole('log').textContent()).includes('QA-001'));
  assert.deepEqual(await page.evaluate(() => window.harness.realtime), { enabled: true, leadIds: ['lead-a'], options: { reconcileOnSubscribe: false } });
  assert.deepEqual(await page.evaluate(() => window.harness.passive), { session: undefined, filters: { hideGroups: true }, sessionIds: [], limit: 80, options: { enabled: false } });
  assert.equal(await page.evaluate(() => window.harness.writeHookMounts), 0, 'Read-only history never initializes writer/composer hooks');
  for (const name of ['Enviar mensagem', 'Gravar áudio', 'Responder mensagem', 'Verificar envio'])
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
  assert.equal(await page.locator('textarea,input[type=file]').count(), 0);

  // A cache refresh models the rendering half of realtime; the subscription
  // transport is closed. It is not a real broadcast/network integration test.
  await page.evaluate(() => {
    const h = window.harness;
    h.history.data = [...h.history.data, { id: 'feedback-new', type: 'note', label: 'Nota adicionada', content: 'Feedback atualizado pelo cache',
      timestamp: '2026-10-19T12:04:00Z', source: 'activity', metadata: { kind: 'feedback' } }];
    h.messages.data = [...h.messages.data, { ...h.messages.data[0], id: 'message-new', content: 'Mensagem atualizada pelo cache', sent_at: '2026-10-19T12:05:00Z' }];
    h.render();
  });
  await page.getByText('Feedback atualizado pelo cache', { exact: true }).waitFor();
  await page.getByText('Mensagem atualizada pelo cache', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Abrir mensagem citada', exact: true }).first().click();
  await page.getByRole('status').filter({ hasText: 'Não foi possível localizar a mensagem.' }).waitFor();
  assert.equal(await page.evaluate(() => window.harness.olderReads), 1);
  assert.deepEqual(await page.evaluate(() => window.harness.writes), []);

  const drops = await page.locator('.lead-thread-panel').evaluate(node => {
    const data = new DataTransfer(); data.items.add(new File(['synthetic'], 'readonly.txt'));
    const drag = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }); node.dispatchEvent(drag);
    const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }); node.dispatchEvent(drop);
    const text = new DataTransfer(); text.setData('text/plain', 'Texto sem arquivo');
    const ordinary = new DragEvent('drop', { dataTransfer: text, bubbles: true, cancelable: true }); node.dispatchEvent(ordinary);
    return { drag: drag.defaultPrevented, drop: drop.defaultPrevented, ordinary: ordinary.defaultPrevented };
  });
  assert.deepEqual(drops, { drag: true, drop: true, ordinary: false });
  assert.equal(await page.evaluate(() => window.harness.writeHookMounts), 0);
  assert.deepEqual(await page.evaluate(() => window.harness.writes), []);
});
