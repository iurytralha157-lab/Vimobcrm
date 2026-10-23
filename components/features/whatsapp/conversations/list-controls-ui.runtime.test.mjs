import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Real page/floating list controls and compiled product CSS. APIs and auth are
// closed synthetic fixtures: these tests do not prove authenticated loading.
const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const directory = await mkdtemp(join(tmpdir(), 'vimob-list-controls-'));
const source = await readFile(join(repository, 'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf('async function confirmAttachments(page)');
assert.ok(boundary > 0);
let bootstrap = source.slice(0, boundary)
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace("['dialog','alert-dialog','tooltip','popover','hover-card','command','select']", "['dialog','alert-dialog']")
  .replace('module.exports=s=>ts.transpileModule(s,', `const fs=require('node:fs'),path=require('node:path');module.exports=function(s){const baseline=process.env.VIMOB_WHATSAPP_LIST_BASELINE_DIR;if(baseline){const relative=path.relative(${JSON.stringify(repository.replaceAll('\\', '/'))},this.resourcePath).split(path.sep).join('/');const candidate=path.join(baseline,relative.replaceAll('/','__')+'.before');if(!relative.startsWith('..')&&fs.existsSync(candidate))s=fs.readFileSync(candidate,'utf8');}return ts.transpileModule(s,`)
  .replace('}).outputText;`);', '}).outputText;};`);')
  .replace("  const ts=require('typescript');", `  await mock('@/hooks/use-teams', 'export const useTeams=()=>({data:[],isLoading:false});');
    await mock('@/hooks/use-mention-names', 'export const useMentionNames=()=>({namesMap:{}});');
    const ts=require('typescript');`)
  .replace('export const useUsers=()=>h().emptyQuery;', 'export const useUsers=()=>h().emptyQuery;export const useOrganizationUsers=()=>h().emptyQuery;')
  .replace('export const getDateRangeFromPreset=()=>null;', 'export const datePresetOptions=[];export const getDateRangeFromPreset=()=>null;')
  .replace('export const useWhatsAppConversations=()=>({...h().emptyQuery,data:h().conversations});', 'export const useWhatsAppConversations=()=>({...h().emptyQuery,data:h().conversations,hasMoreConversations:h().listHasMore,isLoadingMoreConversations:h().listBusy,loadMoreConversations:()=>h().listCalls.push(\'more\')});')
  .replace('export const useWhatsAppConversationFilterOptions=()=>h().emptyQuery;', 'export const useWhatsAppConversationFilterOptions=()=>({...h().emptyQuery,data:{teams:[],users:[],pipelines:[],sources:[],pages:[],campaigns:[],adSets:[],ads:[],tags:[]}});')
  .replace('export const ConversationFilters=()=>null;', `export { ConversationFilters } from ${JSON.stringify(join(repository, 'components/features/whatsapp/conversations/ConversationFilters.tsx').replaceAll('\\', '/'))};`)
  .replace("export const ConversationList=p=>React.createElement('div',null,p.conversations.map(c=>React.createElement('button',{key:c.id,onClick:()=>p.onSelect(c)},'Abrir '+c.id)));", `export { ConversationList } from ${JSON.stringify(join(repository, 'components/features/whatsapp/conversations/ConversationList.tsx').replaceAll('\\', '/'))};`)
  .replace("permissions:['lead_operate','whatsapp_view','whatsapp_operate'],", "listHasMore:true,listBusy:false,listCalls:[],permissions:['lead_operate','whatsapp_view','whatsapp_operate'],")
  .replace("import React,{useEffect} from 'react';import{createRoot}", `import {SharedFilters} from ${JSON.stringify(join(repository, 'components/shared/SharedFilters.tsx').replaceAll('\\', '/'))};
    import React,{useEffect} from 'react';import{createRoot}`)
  .replace("      if(h.mode==='panel')", `      if(h.mode==='default-filter')return React.createElement('section',{'data-default-filter':true},React.createElement(SharedFilters,{datePreset:null,onDatePresetChange:noop,customDateRange:null,onCustomDateRangeChange:noop,teamId:null,onTeamChange:noop,userId:null,onUserChange:noop,pipelineId:null,onPipelineChange:noop,source:null,onSourceChange:noop,pageId:null,onPageChange:noop,campaignId:null,onCampaignChange:noop,tagIds:[],onTagsChange:noop,dealStatus:null,onDealStatusChange:noop,searchQuery:'',onSearchChange:noop,onClear:()=>h.listCalls.push('default-clear'),hasActiveFilters:true,hideSearch:true,loadDynamicOptions:false,scopeTeams:[],scopeUsers:[]}));
      if(h.mode==='panel')`)
  .replace("await page.route('**/*',r=>r.abort());", "const network=[];await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(network,[],'no external network')); ")
  .replace('e=>errors.push(e.message)', 'e=>errors.push(e.stack || e.message)')
  .replace("await page.setContent('<div id=\"root\"></div>');", "await page.setContent('<main class=\"app-shell\"><div id=\"root\"></div></main>');");
assert.ok(bootstrap.includes('listCalls.push(\'more\')'));
assert.ok(bootstrap.includes("mode==='default-filter'"));
assert.ok(bootstrap.includes('export { ConversationFilters }'));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {harness,conversation};`);
const { harness, conversation } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
let css;

before(async () => {
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/whatsapp', 'components/features/chat/FloatingChat.tsx', 'components/shared', 'components/ui', 'config/filter-ui.ts']
    .map(path => `@source "${join(repository, path).replaceAll('\\', '/')}";`).join('\n');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n${sources}`, { from: join(repository, 'app/list-controls-fixture.css') })).css;
}, { timeout: 300000 });
after(async () => {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-list-controls-/);
  await rm(target, { recursive: true, force: true });
});

async function fixture(t, mode = 'screen') {
  const page = await harness(t, mode);
  page.setDefaultTimeout(3500);
  // The shared fixture's context Probe is diagnostic JSON, not a product node.
  await page.addStyleTag({ content: `${css}\nhtml,body{margin:0}html,body,#root,.app-shell{height:100%}#root>output{display:none}` });
  await page.evaluate(({ mode, conversation }) => {
    const h = window.harness;
    h.sessions = [{ ...h.sessions[0], status: 'connected' }];
    h.conversations = [conversation];
    h.filters = { ...h.filters, setSearchQuery: value => { h.filters = { ...h.filters, searchQuery: value }; h.listCalls.push(['query', value]); h.render(); } };
    h.render(mode);
    if (mode === 'floating') h.ctx.openChat();
  }, { mode, conversation: conversation('chat-a', 'lead-a') });
  return page;
}

async function pixels(locator, property) {
  return locator.evaluate((node, property) => {
    const context = document.createElement('canvas').getContext('2d');
    context.fillStyle = getComputedStyle(node)[property];
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, property);
}
async function typography(locator, pseudo) {
  return locator.evaluate((node, pseudo) => {
    const style = getComputedStyle(node, pseudo || null);
    return { size: style.fontSize, weight: style.fontWeight, height: style.height, radius: style.borderRadius, border: style.borderTopWidth };
  }, pseudo);
}

test('page and floating list controls use caption typography and orange at 50 percent across widths and themes', async t => {
  for (const mode of ['screen', 'floating']) {
    const page = await fixture(t, mode);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(({ width, mode }) => { const h = window.harness; h.mobile = width === 390; h.render(mode); }, { width, mode });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
        const search = page.getByRole('textbox', { name: 'Buscar conversas', exact: true });
        assert.deepEqual(await typography(search), { size: '12px', weight: '300', height: '32px', radius: '6px', border: '0px' }, `${mode}/${width}/${theme}`);
        const placeholder = await typography(search, '::placeholder');
        assert.equal(placeholder.size, '12px'); assert.equal(placeholder.weight, '300');
        assert.equal(await search.getAttribute('maxlength'), '180');
        const more = page.getByRole('button', { name: 'Carregar mais conversas', exact: true });
        await page.mouse.move(0, 0);
        assert.deepEqual(await typography(more), { size: '12px', weight: '300', height: '32px', radius: '6px', border: '0px' });
        assert.ok(Math.abs((await pixels(more, 'backgroundColor'))[3] - 128) <= 1);
        if (mode === 'screen') {
          const channel = page.getByRole('button', { name: 'WhatsApp', exact: true });
          assert.deepEqual(await typography(channel), { size: '12px', weight: '300', height: '32px', radius: '6px', border: '0px' });
          assert.ok(Math.abs((await pixels(channel, 'backgroundColor'))[3] - 128) <= 1);
        } else {
          const heading = page.getByText('WhatsApp', { exact: true });
          assert.equal((await typography(heading)).size, '12px');
          assert.equal((await typography(heading)).weight, '300');
          assert.ok(Math.abs((await pixels(heading.locator('../..'), 'backgroundColor'))[3] - 128) <= 1);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${mode}/${width}/${theme} has no horizontal overflow`);
      }
    }
  }
});

test('WhatsApp clear stays gray until hover while the default SharedFilters presentation remains unchanged', async t => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 1440, height: 800 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.className = theme; const h = window.harness; h.mobile = false; h.filters = { ...h.filters, source: 'synthetic' }; h.render('screen'); }, theme);
    const clear = page.getByRole('button', { name: 'Limpar todos os filtros', exact: true });
    await page.mouse.move(0, 0);
    const gray = await pixels(clear, 'color');
    await clear.hover();
    await page.waitForFunction(() => {
      const node = document.querySelector('[aria-label="Limpar todos os filtros"]');
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(); context.fillRect(0, 0, 1, 1);
      const expected = Array.from(context.getImageData(0, 0, 1, 1).data);
      context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).every((value, index) => value === expected[index]);
    });
    const orange = await pixels(clear, 'color');
    assert.notDeepEqual(orange, gray);
    await page.evaluate(() => window.harness.render('default-filter'));
    const defaultClear = page.getByRole('button', { name: 'Limpar todos os filtros', exact: true });
    await page.mouse.move(0, 0);
    assert.deepEqual(await pixels(defaultClear, 'color'), gray);
    await defaultClear.hover();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-default-filter] button[aria-label="Limpar todos os filtros"]');
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--app-text-primary').trim(); context.fillRect(0, 0, 1, 1);
      const expected = Array.from(context.getImageData(0, 0, 1, 1).data);
      context.clearRect(0, 0, 1, 1); context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).every((value, index) => value === expected[index]);
    });
    assert.notDeepEqual(await pixels(defaultClear, 'color'), orange);
    await defaultClear.click();
    assert.equal(await page.evaluate(() => window.harness.listCalls.at(-1)), 'default-clear');
  }
});

test('list query and pagination retain their handlers and busy state with no write requests', async t => {
  for (const mode of ['screen', 'floating']) {
    const page = await fixture(t, mode);
    await page.getByRole('textbox', { name: 'Buscar conversas', exact: true }).fill('lead');
    assert.equal(await page.getByRole('textbox', { name: 'Buscar conversas', exact: true }).inputValue(), 'lead');
    const more = page.getByRole('button', { name: 'Carregar mais conversas', exact: true });
    await more.click();
    assert.deepEqual(await page.evaluate(() => window.harness.listCalls.filter(call => call === 'more')), ['more']);
    if (mode === 'screen') assert.deepEqual(await page.evaluate(() => window.harness.listCalls.filter(Array.isArray)), [['query', 'lead']]);
    await page.evaluate(mode => { window.harness.listBusy = true; window.harness.render(mode); }, mode);
    assert.equal(await more.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.harness.requests), []);
  }
});
