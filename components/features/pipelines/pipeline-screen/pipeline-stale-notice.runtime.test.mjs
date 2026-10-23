import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';

// Actual Board, Radix menus/buttons, Tailwind and filename-matched CSS Modules.
// Auth/action hooks are synthetic; no CRM service, login, database or network.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const artifacts = resolve(process.env.PIPELINE_STALE_NOTICE_ARTIFACT_DIR || join(tmpdir(), 'vimob-pipeline-stale-notice-artifacts'));
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
const { transform } = require('lightningcss');
const evidence = [], errors = [], requests = [];
let directory, browser, bundle, css, moduleExports;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-pipeline-stale-notice-'));
  await mkdir(artifacts, { recursive: true });
  const aliases = {};
  const mock = async (name, source) => {
    const file = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(file, source); aliases[name + '$'] = file;
  };
  const icons = ['ChevronDown', 'ChevronLeft', 'ChevronRight', 'Loader2', 'MoreVertical', 'Plus', 'RefreshCw', 'Target', 'Phone', 'Mail', 'MessageCircle', 'Clock', 'User', 'Zap', 'Trophy', 'XCircle', 'RotateCw', 'AlertTriangle', 'X', 'Check', 'Circle'];
  const iconFile = join(directory, 'icons.js');
  await writeFile(iconFile, icons.map(name => {
    const file = name.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z])([0-9])/g, '$1-$2').toLowerCase();
    return `export{default as ${name}}from${JSON.stringify(join(repository, 'node_modules/lucide-react/dist/esm/icons', file + '.mjs'))};`;
  }).join('\n'));
  aliases['lucide-react$'] = iconFile;
  aliases['date-fns$'] = join(repository, 'node_modules/date-fns/format.js');
  aliases['date-fns/locale$'] = join(repository, 'node_modules/date-fns/locale/pt-BR.js');
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>({user:{id:"synthetic-user"},profile:{id:"synthetic-user"},activeOrganization:{organizationId:"synthetic-org"}});');
  await mock('@/contexts/FloatingChatContext', 'export const useFloatingChat=()=>({openNewChat:()=>{throw Error("Unexpected chat")}});');
  await mock('@/hooks/use-first-response', 'export const useRecordFirstResponseOnAction=()=>({recordFirstResponse:async()=>{throw Error("Unexpected action")}});');
  await mock('@/hooks/use-activities', 'export const useCreateActivity=()=>({mutateAsync:async()=>{throw Error("Unexpected write")},isPending:false});');
  await mock('@/hooks/leads/use-record-lead-contact-outcome', 'export const useRecordLeadContactOutcome=()=>({mutateAsync:async()=>{throw Error("Unexpected outcome")},isPending:false});');
  await mock('@/hooks/leads/use-claim-queue-pool', 'export const useClaimQueuePool=()=>({mutate:()=>{throw Error("Unexpected claim")},isPending:false});');
  await mock('@/hooks/use-sla-reports', 'export const formatSlaTime=()=>"2h";');
  await mock('@/components/features/leads/TaskOutcomeDialog', 'export const TaskOutcomeDialog=()=>null;');
  const loader = join(directory, 'tsx-loader.cjs'), cssLoader = join(directory, 'css-loader.cjs'), entry = join(directory, 'entry.tsx');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;`);
  await writeFile(cssLoader, `const{transform}=require(${JSON.stringify(require.resolve('lightningcss'))});module.exports=function(s){const out=transform({filename:this.resourcePath,code:Buffer.from(s),cssModules:true});return'export default '+JSON.stringify(Object.fromEntries(Object.entries(out.exports).map(([key,value])=>[key,value.name])))+';'};`);
  await writeFile(entry, `import React from'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{PipelineBoard}from'@/components/features/pipelines/pipeline-screen/PipelineBoard';
    const h=window.h={stale:true,refreshing:false,critical:false,events:[]},root=createRoot(document.getElementById('app')),client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    const stages=[{id:'stage-a',name:'Base',color:'#2563eb',leads:[],total_lead_count:0},{id:'stage-b',name:'Contato',color:'#6b7280',leads:[],total_lead_count:0}],noop=()=>{};
    h.render=()=>root.render(<QueryClientProvider client={client}><main className="app-shell" style={{height:'100dvh',display:'flex',flexDirection:'column',padding:12,paddingInline:h.shellProxy?(innerWidth<768?20:24):12,paddingBottom:h.shellProxy?(innerWidth<768?65:12):12,minWidth:0}}><div style={{height:52,flexShrink:0}}>Pipeline sintética</div><PipelineBoard
      stages={stages} filteredStages={stages} visibleStages={innerWidth<768?stages.slice(0,1):stages} stageValueMap={new Map()} stageCountMetaMap={new Map(stages.map(s=>[s.id,{total:0,remaining:0,canLoadMore:false}]))}
      selectedPipelineId="synthetic-pipeline" isMobile={innerWidth<768} isLoading={false} isInitialLeadsLoading={false} isPipelineBoardTransitioning={false} leadsPlaceholderData={false}
      hasCriticalLoadError={h.critical} hasPipelineBoardError={h.stale&&!h.critical} isRefreshing={h.refreshing} pipelinesFetching={false} leadVisibilityFetching={false} hasPreviousMobileStage={false} hasNextMobileStage
      canEditPipeline hasWhatsAppModule={false} canViewWhatsApp={false} canOperateWhatsApp={false} canShowColumnActions={innerWidth>=768} isDragDisabled nowMs={0} editingStageId={null} editingStageName="" savingStageNameId={null} loadMoreIsPending={false}
      onDragStart={noop} onDragEnd={noop} onCriticalLoadRetry={()=>h.events.push('critical-retry')} onBoardRefresh={()=>{h.events.push('retry');h.refreshing=true;h.render()}} onMobileStageNavigation={direction=>h.events.push(direction)} onEditingStageNameChange={noop}
      onStartEditingStage={()=>h.events.push('rename')} onCommitStageName={noop} onCancelEditingStage={noop} onOpenStageSettings={()=>h.events.push('settings')} onOpenLead={noop} onAssignLeadNow={noop} onLoadMore={noop} onCreateStage={noop} onCreatePipeline={noop}/></main></QueryClientProvider>);h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.module\.css$/, use: cssLoader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/pipelines/pipeline-screen/PipelineBoard.tsx', 'components/features/pipelines/pipeline-screen/StageColumnMenu.tsx', 'components/ui'];
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(globals + '\n' + sources.map(file => `@source ${JSON.stringify(join(repository, file).replaceAll('\\', '/'))};`).join('\n'), { from: join(repository, 'app/globals.css') })).css;
  const filename = join(repository, 'components/features/pipelines/pipeline-screen/PipelineBoard.module.css');
  const cssModule = transform({ filename, code: await readFile(filename), cssModules: true });
  moduleExports = Object.fromEntries(Object.entries(cssModule.exports).map(([key, value]) => [key, value.name]));
  css += cssModule.code.toString();
  await writeFile(join(artifacts, 'css-module-receipt.json'), JSON.stringify({ filename, moduleExports }, null, 2));
  await writeFile(join(artifacts, 'fixture.js'), bundle);
  await writeFile(join(artifacts, 'fixture.css'), css);
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });

after(async () => {
  await browser?.close();
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify({ evidence, errors, requests }, null, 2));
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(basename(directory).startsWith('vimob-pipeline-stale-notice-'));
    await rm(directory, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
});

async function open(width, theme, height = 480) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 768 });
  page.setDefaultTimeout(4000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
  await page.locator('[data-pipeline-part="column-header"]').first().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page;
}

async function geometry(page) {
  return page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]'), alertRect = alert.getBoundingClientRect();
    const headers = [...document.querySelectorAll('[data-pipeline-part="column-header"]')].map(header => {
      const rect = header.getBoundingClientRect();
      const targets = ['button[aria-label^="Renomear"]', '[data-pipeline-part="stage-count"]', 'button[aria-label^="Configurar"]'].map(selector => {
        const target = header.querySelector(selector), r = target.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { selector, hitInsideTarget: !!hit && target.contains(hit), hitInsideAlert: !!hit?.closest('[role="alert"]'), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
      });
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, targets };
    });
    return { alert: { top: alertRect.top, bottom: alertRect.bottom, x: alertRect.x, width: alertRect.width }, headers,
      documentWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
  });
}

function unobstructed(state) {
  assert(state.alert.width > 0);
  for (const header of state.headers) {
    assert(state.alert.bottom <= header.top + 1 || state.alert.top >= header.bottom - 1 ||
      state.alert.x + state.alert.width <= header.left || state.alert.x >= header.right,
    'notice must not intersect column headers');
    for (const target of header.targets) {
      assert.equal(target.hitInsideAlert, false, target.selector + ' intercepted by notice');
      assert.equal(target.hitInsideTarget, true, target.selector + ' center must remain reachable');
    }
  }
  assert(state.scrollWidth <= state.documentWidth, 'notice must not create horizontal document overflow');
}

for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) {
  test(`stale notice preserves headers, menu, retry and recovery at ${width}/${theme}`, async () => {
    const page = await open(width, theme);
    try {
      const state = await geometry(page); evidence.push({ width, theme, state });
      await page.screenshot({ path: join(artifacts, `stale-${width}-${theme}.png`) });
      unobstructed(state);
      const column = page.locator('[data-tour="pipeline-column"]').first();
      const reservedHeight = (await column.boundingBox()).height;
      assert((await column.getAttribute('class')).includes(moduleExports[width < 768 ? 'mobileColumn' : 'column']), 'CSS Module mapping must match the actual filename');
      const menu = page.getByRole('button', { name: 'Configurar coluna Base', exact: true });
      if (width < 768) await menu.tap(); else await menu.click();
      await expect(page.getByRole('menu')).toBeVisible(); await page.keyboard.press('Escape');
      await menu.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('menu')).toBeVisible();
      await page.getByRole('menuitem', { name: 'Configurações da coluna', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['settings']);
      const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true });
      await retry.click(); await expect(retry).toBeDisabled();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['settings', 'retry']);
      unobstructed(await geometry(page));
      await page.evaluate(() => { window.h.stale = false; window.h.refreshing = false; window.h.render(); });
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(menu).toBeVisible(); await expect(page.locator('[data-pipeline-part="stage-count"]').first()).toHaveText('0');
      await expect.poll(async () => (await column.boundingBox()).height).toBeGreaterThan(reservedHeight + 1);
    } finally { await page.close(); }
  });
}

for (const width of [320, 390, 1280]) {
  test(`a long notice wraps without covering controls at ${width}`, async () => {
    const page = await open(width, 'dark');
    try {
      await page.getByRole('alert').locator('span').first().evaluate(node => { node.textContent = 'Os dados desta Pipeline podem estar desatualizados. Tente novamente para consultar as informações mais recentes das colunas e dos leads.'; });
      const state = await geometry(page); evidence.push({ width, theme: 'dark', long: true, state }); unobstructed(state);
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Tentar novamente', exact: true })).toBeDisabled();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['retry']);
    } finally { await page.close(); }
  });
  test(`critical error keeps its existing blocking retry at ${width}`, async () => {
    const page = await open(width, 'light');
    try {
      await page.evaluate(() => { window.h.critical = true; window.h.render(); });
      await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a pipeline');
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['critical-retry']);
    } finally { await page.close(); }
  });
}

for (const width of [320, 390]) for (const height of [320, 360]) for (const theme of ['light', 'dark']) {
  test(`low mobile viewport keeps menu, retry and fixed navigation reachable at ${width}x${height}/${theme}`, async () => {
    const page = await open(width, theme, height);
    try {
      const state = await geometry(page); evidence.push({ width, height, theme, low: true, state }); unobstructed(state);
      const next = page.getByRole('button', { name: 'Ver próxima coluna', exact: true });
      await expect(next).toBeEnabled(); await next.tap();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['next']);
      const menu = page.getByRole('button', { name: 'Configurar coluna Base', exact: true });
      await menu.tap(); await expect(page.getByRole('menu')).toBeVisible(); await page.keyboard.press('Escape');
      const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true });
      const reached = await retry.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
      assert.equal(reached, true, 'fixed navigation must not intercept retry');
      await retry.tap(); await expect(retry).toBeDisabled();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['next', 'retry']);
      unobstructed(await geometry(page));
      await page.screenshot({ path: join(artifacts, `stale-${width}x${height}-${theme}.png`) });
    } finally { await page.close(); }
  });
}

async function launcherProxy(page, side) {
  await page.evaluate(side => {
    window.h.shellProxy = true; window.h.render();
    const proxy = document.createElement('button');
    proxy.type = 'button'; proxy.dataset.geometricLauncherProxy = side;
    proxy.setAttribute('aria-label', 'Proxy geométrico do launcher');
    proxy.textContent = 'Chat';
    Object.assign(proxy.style, { position: 'fixed', bottom: innerWidth < 768 ? '80px' : '24px', [side]: '24px',
      width: '56px', height: '56px', borderRadius: '50%', zIndex: '50', background: '#ff4529', color: 'white' });
    document.body.append(proxy);
  }, side);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function proxyHitTest(page) {
  return page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]'), button = alert.querySelector('button'), message = alert.querySelector('span');
    const sample = node => {
      const r = node.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return [[x, y], [r.left + 2, y], [r.right - 2, y], [x, r.top + 2], [x, r.bottom - 2]].map(([px, py]) => {
        const hit = document.elementFromPoint(px, py);
        return { x: px, y: py, hitProxy: !!hit?.closest('[data-geometric-launcher-proxy]'), hitAlert: !!hit && alert.contains(hit), hitButton: !!hit && button.contains(hit) };
      });
    };
    return { retry: sample(button), message: sample(message) };
  });
}

for (const width of [320, 390, 430, 1280]) for (const height of [320, 360, 480]) for (const side of ['left', 'right']) {
  test(`geometric launcher proxy preserves notice and retry at ${width}x${height}/${side}`, async () => {
    const page = await open(width, 'light', height);
    try {
      await launcherProxy(page, side);
      const state = await geometry(page), hits = await proxyHitTest(page);
      evidence.push({ width, height, side, geometricLauncherProxy: true, state, hits }); unobstructed(state);
      assert(hits.retry.every(hit => !hit.hitProxy && hit.hitButton), 'launcher proxy must not intercept any sampled retry point');
      assert(hits.message.every(hit => !hit.hitProxy && hit.hitAlert), 'launcher proxy must not intercept message');
      const retry = page.getByRole('button', { name: 'Tentar novamente', exact: true });
      if (width < 768) await retry.tap(); else await retry.click();
      await expect(retry).toBeDisabled(); assert.deepEqual(await page.evaluate(() => window.h.events), ['retry']);
      if (height === 320) await page.screenshot({ path: join(artifacts, `launcher-proxy-${width}x${height}-${side}.png`) });
    } finally { await page.close(); }
  });
}

for (const width of [320, 390, 430]) for (const side of ['left', 'right']) {
  test(`long notice stays readable with geometric launcher proxy at ${width}/${side}`, async () => {
    const page = await open(width, 'dark', 480);
    try {
      await launcherProxy(page, side);
      await page.getByRole('alert').locator('span').first().evaluate(node => { node.textContent = 'Os dados desta Pipeline podem estar desatualizados. Tente novamente para consultar as informações mais recentes das colunas e dos leads.'; });
      const state = await geometry(page), hits = await proxyHitTest(page);
      evidence.push({ width, height: 480, side, geometricLauncherProxy: true, long: true, state, hits }); unobstructed(state);
      assert(hits.retry.every(hit => !hit.hitProxy && hit.hitButton));
      assert(hits.message.every(hit => !hit.hitProxy && hit.hitAlert));
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).tap();
      assert.deepEqual(await page.evaluate(() => window.h.events), ['retry']);
    } finally { await page.close(); }
  });
}
