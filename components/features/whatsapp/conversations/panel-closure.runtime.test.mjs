import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// The real lead pane and automation control use only closed caller/hook data.
// Reuse the established deferred API harness, with no DB/provider/server reads.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-panel-closure-'));
const source = await readFile(join(repository, 'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf('async function confirmAttachments(page)');
assert.ok(boundary > 0);
let bootstrap = source.slice(0, boundary)
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace('  async function mock(name, source)', '  let mockSerial=0;\n  async function mock(name, source)')
  .replace('${Object.keys(aliases).length}.js', '${mockSerial++}.js')
  .replace("['dialog','alert-dialog','tooltip','popover','hover-card','command','select']", "['dialog','alert-dialog']")
  .replace("export const useOrganizationModules=()=>({hasModule:k=>k==='whatsapp',isLoading:false});", "export const useOrganizationModules=()=>({hasModule:k=>(window.harness.modules||['whatsapp']).includes(k),isLoading:false});")
  .replace("data:{id,name:id,phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{}}", "data:{id,name:id,phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{},...h().leadDetail}")
  .replace('export const useLeadAttachments=()=>h().emptyQuery;', 'export const useLeadAttachments=()=>h().attachmentsQuery||h().emptyQuery;')
  .replace('export const useScheduleEvents=()=>h().emptyQuery;', 'export const useScheduleEvents=()=>h().scheduleQuery||h().emptyQuery;')
  .replace('  // Controlled recorder sentinel', "  await mock('@/components/features/schedule/CompactScheduleEventsList',`import React from 'react';export const CompactScheduleEventsList=p=>React.createElement('div',{'data-events-list':true},p.events.length?'Lista de compromissos sintéticos':p.emptyLabel);`);\n  // Controlled recorder sentinel")
  .replace('  // Controlled recorder sentinel', "  await mock('@/components/features/schedule/EventSheet',`import React from 'react';export const EventSheet=p=>p.open?React.createElement('div',{'data-agenda-open':p.leadId},React.createElement('button',{onClick:()=>p.onOpenChange(false)},'Fechar agenda sintética')):null;`);\n  // Controlled recorder sentinel")
  .replace("  const ts=require('typescript');", "  await mock('@/hooks/use-mention-names',`export const useMentionNames=()=>({namesMap:{}});`);\n  await mock('@/lib/local-read-only',`export const isLocalReadOnlyMode=()=>Boolean(window.harness.localReadOnly);`);\n  const ts=require('typescript');")
  .replace("export const useWhatsAppSessions=()=>({data:h().sessions,isLoading:false,isError:false,refetch:()=>{}});", "export const useWhatsAppSessions=()=>({data:h().sessions,isLoading:false,isError:!!h().sessionsFailed,refetch:()=>h().requests.push({kind:'sessions-refetch'})});")
  .replace("export const useAccessibleSessions=()=>({data:h().sessions,isLoading:false});", "export const useAccessibleSessions=()=>({data:h().sessions,isLoading:false,isError:!!h().sessionsFailed,refetch:()=>h().requests.push({kind:'sessions-refetch'})});")
  .replace("  aliases['@/contexts/FloatingChatContext']=sources.Context;", "  aliases['@/contexts/FloatingChatContext']=sources.Context;\n  aliases['@/components/features/whatsapp/ConversationLeadPanel']=sources.Panel;")
  .replace('    import ConversationsScreen from', "    import {ConversationAutomationAction} from '@/components/features/whatsapp/ConversationAutomationAction';\n    import ConversationsScreen from")
  .replace("      if(h.mode==='panel')", "      if(h.mode==='automation')return React.createElement(ConversationAutomationAction,{...h.automation,onStart:()=>h.requests.push({kind:'automation-start'}),onCancel:()=>h.requests.push({kind:'automation-cancel'})});\n      if(h.mode==='panel')")
  .replace("await page.route('**/*',r=>r.abort());", "const network=[];await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(network,[],'no external network attempted'));");
assert.ok(bootstrap.includes("aliases['@/components/features/whatsapp/ConversationLeadPanel']=sources.Panel;"));
assert.ok(bootstrap.includes('h().attachmentsQuery||h().emptyQuery'));
assert.ok(bootstrap.includes('data-events-list'));
assert.ok(bootstrap.includes("useAccessibleSessions=()=>({data:h().sessions,isLoading:false,isError:!!h().sessionsFailed"));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {harness,conversation};`);
const { harness, conversation } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
let css;
const compactScreenshots = process.env.WHATSAPP_PANEL_COMPACT_SCREENSHOTS;
before(async () => {
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n@source "${join(repository, 'components/features/whatsapp').replaceAll('\\', '/')}";\n@source "${join(repository, 'components/ui').replaceAll('\\', '/')}";`, { from: join(repository, 'app/panel-closure-fixture.css') })).css;
}, { timeout: 300000 });
after(async () => {
  const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^vimob-panel-closure-/);
  await rm(target, { recursive: true, force: true });
});
async function fixture(t) {
  const page = await harness(t, 'panel'); await page.setViewportSize({ width: 390, height: 900 });
  await page.addStyleTag({ content: `${css}\nhtml,body,#root{height:100%;margin:0} #root{padding:12px}` });
  await page.evaluate(() => {
    const h = window.harness; h.leadDetail = { name: 'Lead sintético A', tags: [] };
    h.updateLead = { isPending: false, mutateAsync: p => h.request('feedback', p) }; h.render();
  });
  return page;
}
const field = page => page.getByRole('textbox', { name: 'Feedback do atendimento do lead' });
const save = page => page.getByRole('button', { name: 'Registrar feedback', exact: true });
async function submit(page, text) {
  await field(page).fill(text); await save(page).click(); await page.waitForFunction(() => window.harness.requests.some(r => r.kind === 'feedback'));
}

for (const navigation of ['A-B', 'A-B-A', 'unmount', 'scope']) test(`feedback completion after ${navigation} cannot clear or toast into another context`, async t => {
  const page = await fixture(t); await submit(page, '  Feedback original A  ');
  assert.deepEqual(await page.evaluate(() => window.harness.requests[0].params), { id: 'lead-a', feedback: 'Feedback original A' });
  await page.evaluate(navigation => {
    const h = window.harness;
    if (navigation === 'unmount') return h.unmount();
    if (navigation === 'scope') { h.scope = { ...h.scope, userId: 'user-b' }; h.render(); return; }
    h.leadId = 'lead-b'; h.leadDetail = { name: 'Lead sintético B', tags: [] }; h.render();
    if (navigation === 'A-B-A') { h.leadId = 'lead-a'; h.leadDetail = { name: 'Lead sintético A', tags: [] }; h.render(); }
  }, navigation);
  if (navigation !== 'unmount') await field(page).fill('Novo rascunho atual');
  await page.evaluate(() => window.harness.requests[0].resolve({}));
  await page.waitForTimeout(30);
  assert.deepEqual(await page.evaluate(() => window.harness.toasts), []);
  if (navigation !== 'unmount') await expect(field(page)).toHaveValue('Novo rascunho atual');
  assert.equal(await page.evaluate(() => window.harness.requests.length), 1);
});

test('current feedback preserves a draft typed during save and clears only the submitted unchanged value', async t => {
  const page = await fixture(t); await submit(page, 'Rascunho inicial'); await field(page).fill('Nova edição');
  await page.evaluate(() => window.harness.requests[0].resolve({})); await expect(field(page)).toHaveValue('Nova edição');
  await page.waitForFunction(() => window.harness.toasts.length === 1);
  assert.deepEqual(await page.evaluate(() => window.harness.toasts), ['Feedback registrado com sucesso!']);
  await save(page).click(); await page.waitForFunction(() => window.harness.requests.length === 2);
  await page.evaluate(() => window.harness.requests[1].resolve({})); await expect(field(page)).toHaveValue('');
  assert.deepEqual(await page.evaluate(() => window.harness.requests[1].params), { id: 'lead-a', feedback: 'Nova edição' });
});

test('feedback failure remains truthful and operation permission disables persistence', async t => {
  const page = await fixture(t); await submit(page, 'Manter rascunho');
  await page.evaluate(() => window.harness.requests[0].reject(new Error('Falha sintética')));
  await page.waitForFunction(() => window.harness.toasts.length === 1); await expect(field(page)).toHaveValue('Manter rascunho');
  assert.deepEqual(await page.evaluate(() => window.harness.toasts), ['Erro ao registrar feedback: Falha sintética']);
  await page.evaluate(() => { const h = window.harness; h.permissions = ['whatsapp_view']; h.render(); });
  await expect(field(page)).toBeDisabled(); await expect(save(page)).toBeDisabled();
  await save(page).evaluate(n => n.click()); assert.equal(await page.evaluate(() => window.harness.requests.length), 1);
});

test('agenda loading and failure never report a false zero; cached events remain visible with retry', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { const h = window.harness; h.modules = ['whatsapp', 'agenda']; h.permissions.push('schedule_view'); h.scheduleQuery = { ...h.emptyQuery, isLoading: true }; h.render(); });
  await expect(page.getByText('Carregando agenda...', { exact: true })).toBeVisible();
  await expect(page.getByText('0 compromisso(s)', { exact: true })).toHaveCount(0); await expect(page.locator('[data-events-list]')).toHaveCount(0);
  await page.evaluate(() => { const h = window.harness; h.scheduleQuery = { ...h.emptyQuery, isError: true, refetch: () => h.requests.push({ kind: 'agenda-refetch' }) }; h.render(); });
  await expect(page.getByText('Agenda indisponível', { exact: true })).toBeVisible(); await expect(page.getByText('0 compromisso(s)', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.harness.requests.map(r => r.kind)), ['agenda-refetch']);
  await page.evaluate(() => { const h = window.harness; h.scheduleQuery = { ...h.scheduleQuery, data: [{ id: 'event-a' }] }; h.render(); });
  await expect(page.getByText('1 compromisso(s)', { exact: true })).toBeVisible(); await expect(page.locator('[data-events-list]')).toHaveText('Lista de compromissos sintéticos');
  await page.evaluate(() => { const h = window.harness; h.scheduleQuery = h.emptyQuery; h.render(); });
  await expect(page.getByText('0 compromisso(s)', { exact: true })).toBeVisible(); await expect(page.getByText('Nenhum compromisso agendado', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-events-list]')).toHaveCount(0);
});

test('documents expand all twelve real rows and a new lead starts collapsed; load failures stay explicit', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { const h = window.harness; h.attachmentsQuery = { ...h.emptyQuery, data: Array.from({ length: 12 }, (_, index) => ({ id: 'doc-' + index, filename: 'Documento ' + (index + 1) + '.pdf', file_name: 'Documento ' + (index + 1) + '.pdf', file_url: 'https://document.synthetic.invalid/' + index })) }; h.render(); });
  await expect(page.getByRole('button', { name: /^Abrir documento/ })).toHaveCount(4);
  const expand = page.getByRole('button', { name: 'Ver todos os 12 documentos', exact: true }); await expect(expand).toHaveAttribute('aria-expanded', 'false'); await expand.click();
  await expect(page.getByRole('button', { name: /^Abrir documento/ })).toHaveCount(12); await expect(page.getByRole('button', { name: 'Mostrar menos documentos' })).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { const h = window.harness; h.leadId = 'lead-b'; h.render(); }); await expect(page.getByRole('button', { name: /^Abrir documento/ })).toHaveCount(4);
  await page.evaluate(() => { const h = window.harness; h.attachmentsQuery = { ...h.emptyQuery, isLoading: true }; h.render(); });
  await expect(page.getByRole('status')).toHaveText('Carregando documentos...'); await expect(page.getByText('Nenhum documento anexado.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { const h = window.harness; h.attachmentsQuery = { ...h.emptyQuery, isError: true, refetch: () => h.requests.push({ kind: 'documents-refetch' }) }; h.render(); });
  await expect(page.getByRole('alert')).toHaveText(/Não foi possível carregar os documentos/); await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.harness.requests.map(r => r.kind)), ['documents-refetch']);
});

for (const width of [320, 1440]) for (const theme of ['light', 'dark']) test(`compact lead controls preserve actions without empty blocks at ${width}/${theme}`, async t => {
  const page = await fixture(t); await page.setViewportSize({ width, height: 900 });
  await page.addStyleTag({ content: '#root{max-width:354px;box-sizing:border-box}.app-shell{height:100%}' });
  await page.evaluate(theme => {
    document.documentElement.className = theme; document.getElementById('root').classList.add('app-shell');
    const h = window.harness; h.modules = ['whatsapp', 'agenda']; h.permissions.push('schedule_view', 'schedule_manage');
    h.scheduleQuery = h.emptyQuery; h.attachmentsQuery = h.emptyQuery; h.render();
  }, theme);
  const documentationTitle = page.getByRole('heading', { name: 'Documentação', exact: true });
  const documentation = documentationTitle.locator('xpath=ancestor::section[1]');
  await expect(documentation).toHaveCSS('height', '32px');
  await expect(documentationTitle).toHaveCSS('font-size', '11px');
  const documentationMetrics = await documentationTitle.evaluate(node => {
    const section = node.closest('section'), button = section.querySelector('button');
    const box = section.getBoundingClientRect(), action = button.getBoundingClientRect();
    const title = getComputedStyle(node), control = getComputedStyle(button);
    const reference = getComputedStyle([...document.querySelectorAll('h3')].find(heading => heading.textContent === 'Dados do contato'));
    return { titleSize: title.fontSize, titleWeight: title.fontWeight, referenceSize: reference.fontSize,
      referenceWeight: reference.fontWeight, buttonSize: control.fontSize, buttonWeight: control.fontWeight,
      buttonHeight: action.height, gapTop: action.top - box.top, gapBottom: box.bottom - action.bottom,
      rightPadding: box.right - action.right };
  });
  assert.deepEqual({ size: documentationMetrics.titleSize, weight: documentationMetrics.titleWeight },
    { size: documentationMetrics.referenceSize, weight: documentationMetrics.referenceWeight });
  assert.deepEqual({ height: documentationMetrics.buttonHeight, size: documentationMetrics.buttonSize, weight: documentationMetrics.buttonWeight },
    { height: 24, size: '10px', weight: '300' });
  assert.ok(documentationMetrics.gapTop >= 4 && documentationMetrics.gapBottom >= 4);
  assert.equal(documentationMetrics.rightPadding, 12);
  await expect(page.getByText('Nenhum documento anexado.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Nenhum compromisso agendado', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-events-list]')).toHaveCount(0);
  await expect(field(page)).toHaveCSS('height', '64px'); await expect(field(page)).toHaveCSS('font-size', '12px');
  await expect(field(page)).toHaveCSS('font-weight', '300'); await expect(field(page)).toHaveCSS('border-top-width', '0px');
  const schedule = page.getByRole('button', { name: 'Agendar', exact: true }); await expect(schedule).toBeEnabled();
  await expect(schedule).toHaveCSS('color', 'rgb(255, 255, 255)');
  assert.match(await schedule.evaluate(node => getComputedStyle(node).backgroundColor), /(?:0\.5|50%)/);
  await schedule.hover(); await expect(schedule).toHaveCSS('background-color', 'rgb(255, 69, 41)');
  await expect(schedule).toHaveCSS('color', 'rgb(255, 255, 255)'); await page.mouse.move(0, 0);
  await expect.poll(() => schedule.evaluate(node => getComputedStyle(node).backgroundColor)).toMatch(/(?:0\.5|50%)/);
  await expect(page.getByRole('button', { name: 'Anexar', exact: true })).toBeEnabled();
  await expect(save(page)).toBeVisible(); await expect(save(page)).toBeDisabled();
  if (compactScreenshots) {
    await mkdir(compactScreenshots, { recursive: true });
    await writeFile(join(compactScreenshots, `documentation-${width}-${theme}.json`), JSON.stringify(documentationMetrics, null, 2));
    await page.screenshot({ path: join(compactScreenshots, `panel-${width}-${theme}.png`), fullPage: true });
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.equal(await page.evaluate(() => window.harness.requests.length), 0);
  await schedule.click(); await expect(page.locator('[data-agenda-open]')).toHaveAttribute('data-agenda-open', 'lead-a');
  await page.getByRole('button', { name: 'Fechar agenda sintética', exact: true }).click();
  await expect(page.locator('[data-agenda-open]')).toHaveCount(0);
  await page.locator('input[type="file"]').evaluate(node => node.addEventListener('click', () => window.harness.filePickerClicks = (window.harness.filePickerClicks || 0) + 1));
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Anexar', exact: true }).click(); await chooser;
  assert.equal(await page.evaluate(() => window.harness.filePickerClicks), 1);
  await page.evaluate(() => { const h = window.harness; h.permissions = ['whatsapp_view', 'schedule_view']; h.render(); });
  await expect(page.getByRole('button', { name: 'Anexar', exact: true })).toBeDisabled();
  await expect(schedule).toBeDisabled(); await expect(field(page)).toBeDisabled(); await expect(save(page)).toBeDisabled();
});

test('shared automation states expose only valid actions with bounded controls and reduced motion', async t => {
  const page = await fixture(t); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { const h = window.harness; h.automation = { loading: true, unavailable: false, active: false, cancelling: false }; h.render('automation'); });
  await expect(page.getByRole('status', { name: 'Verificando automações ativas' })).toBeVisible(); await expect(page.getByRole('button')).toHaveCount(0); await expect(page.locator('.animate-spin')).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => { const h = window.harness; h.automation = { loading: false, unavailable: true, active: false, cancelling: false }; h.render(); });
  await expect(page.getByRole('img', { name: 'Estado das automações indisponível' })).toBeVisible(); await expect(page.getByRole('button')).toHaveCount(0);
  await page.evaluate(() => { const h = window.harness; h.automation.unavailable = false; h.render(); }); await page.getByRole('button', { name: 'Iniciar automação' }).click();
  await page.evaluate(() => { const h = window.harness; h.automation.active = true; h.render(); }); await page.getByRole('button', { name: 'Parar automação ativa' }).click();
  await page.evaluate(() => { const h = window.harness; h.automation.cancelling = true; h.render(); });
  const cancel = page.getByRole('button', { name: 'Parar automação ativa' }); await expect(cancel).toBeDisabled(); await expect(cancel).toHaveAttribute('aria-busy', 'true');
  await expect(cancel.locator('.animate-spin')).toHaveCSS('animation-name', 'none'); await cancel.evaluate(n => n.click());
  assert.deepEqual(await page.evaluate(() => window.harness.requests.map(r => r.kind)), ['automation-start', 'automation-cancel']);
});

for (const mode of ['screen', 'floating']) test(`${mode} history Escape restores its real trigger and leaves the selected conversation open`, async t => {
  const page = await harness(t, mode); await page.setViewportSize({ width: 1440, height: 900 });
  await page.addStyleTag({ content: css });
  await page.evaluate(conversations => {
    const h = window.harness; h.sessions = [{ ...h.sessions[0], status: 'connected' }]; h.conversations = conversations; h.render();
    if (h.mode === 'floating') h.ctx.openConversation(conversations[0]);
  }, [conversation('chat-a', 'lead-a'), conversation('chat-b', 'lead-b')]);
  if (mode === 'screen') await page.getByRole('button', { name: 'Abrir chat-a', exact: true }).click();
  const trigger = page.getByRole('button', { name: mode === 'screen' ? 'Pesquisar nesta conversa' : 'Buscar nesta conversa', exact: true }); await trigger.click();
  const search = page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' }); await expect(search).toBeVisible(); await search.press('Escape');
  await expect(search).toHaveCount(0); await expect(trigger).toBeFocused();
  if (mode === 'screen') await expect(page.locator('[data-screen-chat="chat-a"]')).toBeVisible();
  else assert.equal(await page.evaluate(() => window.harness.ctx.state.activeConversation?.id), 'chat-a');
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['send', 'archive', 'delete', 'link'].includes(r.kind)).length), 0);
});

for (const mode of ['screen', 'floating']) test(`${mode} unavailable notice survives readonly preview and failed session discovery without a false start action`, async t => {
  const page = await harness(t, mode); await page.setViewportSize({ width: 1440, height: 900 }); await page.addStyleTag({ content: css });
  await page.evaluate(conversation => {
    const h = window.harness; h.localReadOnly = true; h.sessions = [{ ...h.sessions[0], status: 'connected' }]; h.conversations = [conversation]; h.render();
    if (h.mode === 'floating') h.ctx.openConversation(conversation);
  }, conversation('chat-a', 'lead-a'));
  if (mode === 'screen') await page.getByRole('button', { name: 'Abrir chat-a', exact: true }).click();
  await expect(page.locator('[data-whatsapp-unavailable="read_only"]')).toHaveText('Envios indisponíveis nesta prévia em somente leitura');
  await expect(page.getByRole('button', { name: 'Iniciar conversa pelo seu WhatsApp', exact: true })).toHaveCount(0); await expect(page.locator('[data-whatsapp-own-start]')).toHaveCount(0);
  await page.evaluate(() => { const h = window.harness; h.localReadOnly = false; h.sessionsFailed = true; h.render(); });
  const status = page.locator('[data-whatsapp-unavailable="sessions_failed"]'); await expect(status).toHaveText('Não foi possível verificar a conexão do WhatsAppTentar novamente'); await status.getByRole('button', { name: 'Tentar novamente' }).click();
  assert.deepEqual(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'sessions-refetch').map(r => r.kind)), ['sessions-refetch']);
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['send', 'archive', 'delete', 'link', 'start'].includes(r.kind)).length), 0);
});
