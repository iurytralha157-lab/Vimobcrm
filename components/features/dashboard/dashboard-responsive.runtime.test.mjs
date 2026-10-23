import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real Dashboard TSX, Radix, Recharts and compiled production Tailwind. Only
// auth/data boundaries and the shared shell/filter panel are synthetic.
// No HTTP service, login, database or external request is used.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifacts = resolve(process.env.DASHBOARD_VISUAL_ARTIFACT_DIR || 'D:/Vimob/tmp/dashboard-responsive-hardening-20261012');
let directory, browser, bundle, css;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-dashboard-responsive-'));
  await mkdir(artifacts, { recursive: true });
  const aliases = {};
  async function mock(name, source) {
    const path = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(path, source); aliases[name] = path;
  }
  const dataHook = 'const result=data=>({data,isLoading:false,isPending:false,isError:false,isFetching:false,refetch:async()=>{},error:null});';
  await mock('next/navigation', 'export const useRouter=()=>({push:()=>{}});');
  await mock('next/link', "import React from 'react';export default function Link(p){return React.createElement('a',p)}");
  await mock('next/image', "import React from 'react';export default function Image({unoptimized,priority,fill,...p}){return React.createElement('img',p)}");
  await mock('@/lib/performance', 'export const performanceTracker={addMetric:(...args)=>window.h.metrics.push(args),trackTimed:(_name,fn)=>fn()};');
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>({activeOrganization:{organizationId:"synthetic-org"}});');
  await mock('@/contexts/FilterContext', 'export const useFilters=()=>({pipelineId:window.h.pipelineId??null,setPipelineId:value=>{window.h.pipelineId=value;window.h.render();}});');
  await mock('@/hooks/use-user-permissions', 'export const useUserPermissions=()=>({hasPermission:()=>true});');
  await mock('@/hooks/use-organization-modules', 'export const useOrganizationModules=()=>({hasModule:()=>true});');
  await mock('@/hooks/use-stages', `${dataHook}export const usePipelines=()=>result(window.h.pipelines);`);
  await mock('@/hooks/use-dashboard-stats', `${dataHook}
    export const useDashboardQueryScope=()=>({organizationId:'synthetic-org',currentUserId:'synthetic-user',accessSignature:'synthetic-access',isReady:window.h.scopeReady,canViewLeadDistribution:true});
    export const useEnhancedDashboardStats=(_filters,options)=>({...result(window.h.noStats?undefined:window.h.stats),isError:options?.includeDetails?Boolean(window.h.detailsDenied):Boolean(window.h.statsDenied),error:{status:403}});
    export const useDealsEvolutionData=()=>({...result(window.h.noEvolution?undefined:window.h.evolution),isError:window.h.evolutionDenied});
    export const useLeadSourcesData=()=>result(window.h.sources);
    export const useDashboardLeadDistribution=()=>result(window.h.distribution);
    export const useDashboardFirstContact=()=>result(undefined);
    export const useDashboardFirstContactLeads=()=>({...result({pages:[]}),hasNextPage:false});
    export const useFunnelData=()=>result(window.h.funnel);`);
  await mock('@/hooks/use-dashboard-campaigns', `${dataHook}export const useDashboardCampaigns=()=>result(window.h.campaigns);`);
  await mock('@/hooks/use-dashboard-creatives', `${dataHook}export const useDashboardCreatives=()=>result({creatives:[]});`);
  await mock('@/hooks/use-dashboard-creative-media', `${dataHook}export const useDashboardCreativeMedia=()=>result(undefined);`);
  await mock('@/hooks/use-dashboard-lead-entries', `${dataHook}export const useDashboardLeadEntries=()=>({...result({pages:[]}),hasNextPage:false});`);
  await mock('@/hooks/use-dashboard-visits', `${dataHook}export const useDashboardVisits=()=>result(undefined);`);
  await mock('@/hooks/use-dashboard-filters', 'export const sourceLabels={};export const datePresetOptions=[];');
  await mock('@/lib/api/dashboard', 'export const getDashboardExtraCounts=async()=>({propertyCount:12345,siteVisits:1234567,scheduledVisits:12345});export const getDashboardFiltersQueryKey=f=>JSON.stringify(f);');
  await mock('@/components/shared/SharedFilters', "import React from 'react';export const SharedFilters=()=>React.createElement('button',{style:{height:28}},'Filtros');");
  await mock('@/components/shared/layout/AppLayout', `import React from 'react';export const AppLayout=({children})=>React.createElement('div',{style:{height:'100dvh',display:'flex',overflow:'hidden'}},React.createElement('aside',{className:'hidden md:block',style:{width:216,flexShrink:0}},'Sidebar preservada'),React.createElement('div',{style:{display:'flex',flexDirection:'column',flex:1,minWidth:0,minHeight:0}},React.createElement('header',{style:{height:60,flexShrink:0}},'Dashboard'),React.createElement('main',{style:{flex:1,minHeight:0,minWidth:0,overflow:'hidden',padding:innerWidth>=768?'12px 24px':'8px 20px 64px'}},children)));`);
  await mock('@/hooks/use-shared-filters', `import{useState}from'react';const noop=()=>{};export function useSharedFilters(){const[source,setSource]=useState(null);const choose=x=>{window.h.source=x;setSource(x)};return{filters:{source},source,setSource:choose,datePreset:null,customDateRange:undefined,teamId:null,userId:null,pageId:null,campaignId:null,campaignIds:[],adSetId:null,adId:null,tagIds:[],dealStatus:null,searchQuery:'',dynamicSources:[],pages:[],campaigns:[],adSets:[],ads:[],tags:[],isFiltersHydrated:true,setDatePreset:noop,setCustomDateRange:noop,clearDateFilter:noop,setTeamId:noop,setUserId:noop,setPageId:noop,setCampaignIds:noop,setAdSetId:noop,setAdId:noop,setTagIds:noop,setDealStatus:noop,setSearchQuery:noop,clearFilters:noop,refetchLeadMetaFilters:noop,refetchTags:noop,refetchTeams:noop}}`);
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import Dashboard from ${JSON.stringify(join(repository, 'components/features/dashboard/DashboardScreen.tsx'))};
    const h=window.h={source:null,metrics:[],scopeReady:window.initialMode!=='disabled',statsDenied:window.initialMode==='denied',evolutionDenied:window.initialMode==='evolution-error',noStats:window.initialMode==='missing-stats',noEvolution:window.initialMode==='missing-evolution',pipelines:[{id:'pipeline',name:'Funil sintético',is_default:true},{id:'pipeline-two',name:'Outro funil com nome longo'}],
      stats:{totalLeads:149878,totalEntries:149878,uniqueLeads:149878,reentries:0,entryBreakdownAvailable:true,openLeads:123456,lostLeads:1234,closedLeads:4321,conversionRate:2.88,avgResponseTime:'9d 18h',totalSalesValue:9876543210,wonDeals:[{id:'won',name:'Private Synthetic Won',source:'Private Source',value:999,createdAt:'2026-10-01T12:00:00Z',wonAt:'2026-10-10T12:00:00Z',conversionDays:9}],lostDeals:[{id:'lost',name:'Private Synthetic Lost',source:'Private Source',lostReasonGroup:'Private Reason',lostReason:'Synthetic reason',createdAt:'2026-10-01T12:00:00Z',lostAt:'2026-10-10T12:00:00Z'}],wonConversionBuckets:[],lostReasonBuckets:[]},
      sources:Array.from({length:547},(_,i)=>({name:'Origem importada '+i+' '+(i===0?'x'.repeat(118):''),rawSource:'raw:'+i,value:i+1})),
      evolution:Array.from({length:30},(_,i)=>({date:(i+1)+'/10',ganhos:i*3,perdas:i,abertos:i*10})),
      distribution:{users:Array.from({length:12},(_,i)=>({id:'user'+i,name:'Corretor sintético '+i,kind:'entity',leadCount:(i+1)*50})),teams:Array.from({length:4},(_,i)=>({id:'team'+i,name:'Equipe '+i,kind:'entity',leadCount:200+i}))},
      funnel:Array.from({length:6},(_,i)=>({name:'Etapa longa '+i,value:1234567-i*10,percentage:17,stage_key:'stage'+i})),
      campaigns:{campaigns:Array.from({length:334},(_,i)=>({key:'campaign'+i,campaignId:'campaign'+i,name:'Campanha importada longa '+i,leadCount:i+1})),unattributed:{leadCount:50}}};
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const root=createRoot(document.getElementById('root'));h.render=()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Dashboard)));h.render();`);
  console.info('Dashboard visual harness: compiling real TSX');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'dashboard.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'dashboard.js'), 'utf8');
  console.info('Dashboard visual harness: compiling production CSS');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/dashboard', 'components/ui', 'config/dashboard-layout.ts'].map(path => `@source "${join(repository, path).replaceAll('\\', '/')}";`).join('\n');
  css = (await postcss([tailwind({ base: repository })]).process(`${globals}\n${sources}`, { from: join(repository, 'app/globals.css') })).css;
  console.info('Dashboard visual harness: launching isolated Chromium');
  browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });
after(async () => {
  await browser?.close();
  if (directory) { assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && basename(directory).startsWith('vimob-dashboard-responsive-')); await rm(directory, { recursive: true, force: true }); }
});

for (const [width, height] of [[320, 568], [390, 844], [1024, 768], [1280, 800], [1440, 900]]) {
  test(`real dashboard fits ${width}x${height} with 547 origins and large values`, async () => {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('Dashboard visual page error:', error.stack); });
    await page.route('**/*', route => route.abort());
    try {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
      await page.locator('[data-tour="dashboard-kpi-leads"] p').nth(1).waitFor();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (width < 1024) await page.getByRole('tab', { name: 'Origem', exact: true }).click();
      const source = page.locator('[data-tour="dashboard-sources"]');
      await source.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      assert.equal(await source.locator('path.recharts-sector').count(), 8);
      const overflowing = await source.evaluate(element => [...element.querySelectorAll('button')].filter(button => {
        const b = button.getBoundingClientRect(), c = element.getBoundingClientRect();
        return b.left < c.left - 1 || b.right > c.right + 1 || b.bottom > c.bottom + 1;
      }).map(button => button.textContent));
      assert.deepEqual(overflowing, []);
      await page.screenshot({ path: join(artifacts, `dashboard-${width}x${height}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Ver 547 origens', exact: true }).click();
      await page.getByRole('textbox', { name: 'Buscar origem', exact: true }).fill('raw:0');
      await page.getByRole('dialog').getByRole('button', { name: /Origem importada 0/ }).click();
      assert.equal(await page.evaluate(() => window.h.source), 'raw:0');
      if (width === 1280) {
        for (const [kpi, privateName] of [['lost', 'Private Synthetic Lost'], ['won', 'Private Synthetic Won']]) {
          await page.evaluate(() => { window.h.detailsDenied = false; window.h.render(); });
          await page.locator(`[data-tour="dashboard-kpi-${kpi}"]`).click();
          await page.getByRole('dialog').getByText(privateName, { exact: true }).waitFor();
          await page.evaluate(() => { window.h.detailsDenied = true; window.h.render(); });
          await page.getByRole('dialog').getByText('Não foi possível carregar os registros detalhados.', { exact: true }).waitFor();
          assert.equal(await page.getByRole('dialog').getByText(privateName, { exact: true }).count(), 0);
          await page.getByRole('dialog').getByRole('button', { name: /Close|Fechar/i }).click();
        }
        await page.evaluate(() => { window.h.statsDenied = true; window.h.render(); });
        await page.getByText('Não foi possível carregar os indicadores.', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-tour="dashboard-sources"]').count(), 0);
        assert.equal(await page.locator('[data-tour="dashboard-kpi-leads"]').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Filtros', exact: true }).count(), 0);
        assert.equal(await page.getByText('Private Synthetic Won', { exact: true }).count(), 0);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('load metric records elapsed time only after scoped stats and evolution both succeed', async () => {
  for (const mode of ['success', 'denied', 'evolution-error', 'disabled', 'missing-stats', 'missing-evolution']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/*', route => route.abort());
    try {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css });
      await page.evaluate(mode => { window.initialMode = mode; }, mode);
      await page.addScriptTag({ content: bundle });
      await page.waitForFunction(() => window.h && document.getElementById('root').children.length > 0);
      await page.waitForTimeout(100);
      const metrics = await page.evaluate(() => window.h.metrics);
      assert.equal(metrics.length, mode === 'success' ? 1 : 0, mode);
      if (mode === 'success') {
        assert.equal(metrics[0][0], 'Dashboard Stats and Evolution Load');
        assert.ok(metrics[0][1] >= 0);
        assert.ok(metrics[0][1] < await page.evaluate(() => performance.now()));
      }
    } finally { await page.close(); }
  }
});

test('range ticks preserve years and DST offsets without overlapping at mobile and desktop widths', async () => {
  const scenarios = {
    years: Array.from({ length: 24 }, (_, index) => `${String(index + 1).padStart(2, '0')}/12/2025–${String(index + 1).padStart(2, '0')}/01/2026`),
    dst: Array.from({ length: 24 }, (_, index) => `01/11 ${String(index).padStart(2, '0')}:00 -04:00–01/11 ${String(index).padStart(2, '0')}:59 -05:00`),
    'hour-years': Array.from({ length: 24 }, (_, index) => `31/12/2025 ${String(index).padStart(2, '0')}:00 -03:00–01/01/2026 ${String(index).padStart(2, '0')}:59 -03:00`),
  };
  for (const width of [320, 390, 1024, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    try {
      await page.setContent('<html><body><div id="root"></div></body></html>');
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
      await page.locator('[data-tour="dashboard-evolution"]').waitFor();
      const evolution = page.locator('[data-tour="dashboard-evolution"]');
      for (const [name, labels] of Object.entries(scenarios)) {
        await page.evaluate(labels => { window.h.evolution = labels.map((date, index) => ({ date, ganhos: index * 3, perdas: index, abertos: index * 10 })); window.h.render(); }, labels);
        await evolution.scrollIntoViewIfNeeded();
        await page.waitForTimeout(120);
        const geometry = await evolution.evaluate(element => {
          const svg = element.querySelector('svg.recharts-surface').getBoundingClientRect();
          const ticks = [...element.querySelectorAll('[data-evolution-tick]')].map(tick => {
            const rect = tick.getBoundingClientRect();
            return { text: tick.textContent, label: tick.getAttribute('aria-label'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          }).sort((left, right) => left.left - right.left);
          return { svg: { left: svg.left, right: svg.right, bottom: svg.bottom }, ticks };
        });
        assert.ok(geometry.ticks.length >= 1, `${name}/${width}: missing ticks`);
        for (let index = 0; index < geometry.ticks.length; index++) {
          const tick = geometry.ticks[index];
          assert.ok(tick.left >= geometry.svg.left - 1 && tick.right <= geometry.svg.right + 1 && tick.bottom <= geometry.svg.bottom + 1, `${name}/${width}: clipped ${tick.text}`);
          assert.ok(labels.includes(tick.label), `${name}/${width}: original range lost`);
          if (index > 0) assert.ok(geometry.ticks[index - 1].right <= tick.left, `${name}/${width}: tick boxes intersect`);
        }
        const svg = await evolution.locator('svg.recharts-surface').boundingBox();
        await page.mouse.move(svg.x + svg.width * 0.5, svg.y + svg.height * 0.4);
        await page.waitForFunction(() => {
          const wrapper = document.querySelector('[data-tour="dashboard-evolution"] .recharts-tooltip-wrapper');
          return wrapper && window.h.evolution.some(point => wrapper.textContent.includes(point.date));
        });
        await evolution.screenshot({ path: join(artifacts, `evolution-${name}-${width}.png`) });
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});
