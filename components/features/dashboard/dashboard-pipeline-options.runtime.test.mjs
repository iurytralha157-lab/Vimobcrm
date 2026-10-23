import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const parse = (path, source = read(path)) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(ast, predicate) {
  let found;
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit); }
  visit(ast); return found;
}
function functionSource(path, name) {
  const ast = parse(path), node = find(ast, candidate => ts.isFunctionDeclaration(candidate) && candidate.name?.text === name);
  assert.ok(node, `${path}: ${name}`); return node.getText(ast);
}
const referenceAst = parse('hooks/use-stages.ts');
const referenceConstants = referenceAst.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => ['PIPELINE_REFERENCE_STALE_TIME_MS', 'PIPELINE_CACHE_TIME_MS'].includes(declaration.name.getText(referenceAst))))
  .map(node => node.getText(referenceAst)).join('\n');
const screenPath = 'components/features/dashboard/DashboardScreen.tsx';
const screen = parse(screenPath, process.env.DASHBOARD_PIPELINE_TEST_SCREEN_SOURCE
  ? readFileSync(process.env.DASHBOARD_PIPELINE_TEST_SCREEN_SOURCE, 'utf8') : read(screenPath));
const screenFunction = find(screen, node => ts.isFunctionDeclaration(node) && node.name?.text === 'Dashboard');
assert.ok(screenFunction?.body);
const declarations = screenFunction.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => ['pipelinesQuery', 'pipelines', 'refreshPipelineOptions', 'retryDynamicOptions'].includes(declaration.name.getText(screen))
    || ['usePipelines()', 'useDashboardPipelineOptions(dashboardQueryScope)'].includes(declaration.initializer?.getText(screen))))
  .map(node => node.getText(screen)).join('\n');
const filterElement = find(screen, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(screen) === 'SharedFilters');
assert.ok(filterElement);
const propNames = ['pipelineId', 'onPipelineChange', 'pipelines', 'onFiltersOpenChange', 'onRetryDynamicOptions', 'hasDynamicOptionsError', 'isRetryingDynamicOptions'];
const propsSource = propNames.map(name => {
  const attr = filterElement.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(screen) === name);
  assert.ok(attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression, name);
  return `${name}: ${attr.initializer.expression.getText(screen)}`;
}).join(',');
const shared = parse('components/shared/SharedFilters.tsx');
const chipStatement = find(shared, node => ts.isIfStatement(node) && node.expression.getText(shared) === 'pipelineId && onPipelineChange');
const selectElement = find(shared, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(shared) === 'SearchableFilterSelect'
  && node.attributes.properties.some(property => ts.isJsxAttribute(property) && property.name.getText(shared) === 'ariaLabel'
    && property.initializer?.getText(shared) === '"Filtrar por pipeline"'));
assert.ok(chipStatement && selectElement);
const optionsExpression = selectElement.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(shared) === 'options').initializer.expression.getText(shared);
const provider = parse('components/providers/query-provider.tsx');
const providerGlobals = provider.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => declaration.name.getText(provider).startsWith('DEFAULT_QUERY_'))).map(node => node.getText(provider)).join('\n');
let directory, browser, bundle;

// Real React, React Query, Dashboard hook, provider boundary and chip component.
// Screen callbacks/props and SharedFilters option/chip expressions come from AST.
// API/auth/other catalogs are synthetic. No CRM service, HTTP, database or CSS build.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-dashboard-pipeline-options-'));
  const catalog = join(directory, 'catalog.ts'), loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.tsx');
  await writeFile(catalog, `import {useQuery as realUseQuery} from '@tanstack/react-query';
    import {shouldRetryPipelineQuery} from '@/lib/pipeline-reliability';
    const useQuery=options=>realUseQuery({...options,retryDelay:0});
    const useOrganizationId=()=>window.h.auth.activeOrganization.organizationId;
    const pipelinesAPI={getPipelines:(org,signal)=>window.h.readApi(org,signal)};
    ${referenceConstants}\n${functionSource('hooks/use-stages.ts', 'usePipelines')}`);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React,{act,useMemo,useLayoutEffect} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{QueryClient,QueryClientProvider,useQueryClient,notifyManager}from'@tanstack/react-query';
    import{usePipelines}from'@/hooks/use-stages';
    import{useDashboardPipelineOptions}from'@/hooks/dashboard/use-dashboard-pipeline-options';
    import{isSharedFilterOptionsAccessDenied}from'@/lib/filters/shared-filter-options';
    import{createTenantQueryAccessSignature}from'@/lib/access/tenant-query-cache';
    import{activateQueryClientAccess}from'@/lib/access/query-client-access';
    import{FilterSelectionSummary}from'@/components/shared/FilterSelectionSummary';
    window.IS_REACT_ACT_ENVIRONMENT=true;
    const h=window.h={auth:{user:{id:'actor-a'},activeOrganization:{organizationId:'org-a'},tenantContext:{memberRole:'admin',permissions:['dashboard_view']}},
      scopeReady:true,selectedId:'pipeline-a',rows:[{id:'pipeline-a',name:'Private pipeline A',is_default:true}],failure:null,gate:null,
      calls:[],clients:[],notifications:[],pauseNotifications:false,visit:0,renders:0,ancillary:{tags:0,meta:0,teams:0,load:0,selection:0}};
    notifyManager.setScheduler(callback=>h.pauseNotifications?h.notifications.push(callback):queueMicrotask(callback));
    h.readApi=async(org,signal)=>{const call={org,actor:h.auth.user.id,signal,completed:false};h.calls.push(call);const rows=h.rows,error=h.failure,gate=h.gate;if(gate)await gate;call.completed=true;if(error)throw Object.assign(Error('Synthetic catalog failure'),error);return rows;};
    const useAuth=()=>h.auth,getGlobalSignOutSessionId=session=>session?.sid,WhatsAppTenantCacheBoundary=()=>null;
    ${providerGlobals}\n${functionSource('components/providers/query-provider.tsx', 'createTenantQueryClient')}
    ${functionSource('components/providers/query-provider.tsx', 'QueryProvider')}
    function Probe(){
      h.renders++;const queryClient=useQueryClient();if(!h.clients.includes(queryClient))h.clients.push(queryClient);h.client=queryClient;
      const activeOrganizationId=h.auth.activeOrganization.organizationId;
      const dashboardQueryScope={organizationId:activeOrganizationId,accessSignature:h.auth.user.id+':'+activeOrganizationId,isReady:h.scopeReady,canViewLeadDistribution:true};
      const pipelineId=h.selectedId,setPipelineId=id=>{h.selectedId=id;h.ancillary.selection++;};
      const hasDynamicOptionsError=false,isRetryingDynamicOptions=false,hasLeadMetaFiltersError=false,hasTagsError=false,hasTeamOptionsError=false;
      const setShouldLoadFilterOptions=()=>{h.ancillary.load++;},refetchLeadMetaFilters=async()=>{h.ancillary.meta++;},refetchTags=async()=>{h.ancillary.tags++;},refetchTeams=async()=>{h.ancillary.teams++;};
      ${declarations}
      h.props={${propsSource}};
      const chips=[],addChip=(key,label,onRemove)=>chips.push({key,label,onRemove}),unavailable='indisponível';
      const onPipelineChange=h.props.onPipelineChange,handlePipelineFilterChange=onPipelineChange;
      ${chipStatement.getText(shared)}
      h.options=${optionsExpression};
      return <div><FilterSelectionSummary chips={chips}/><ul>{h.options.map(option=><li key={option.value}>{option.label}</li>)}</ul></div>;
    }
    const root=createRoot(document.getElementById('root'));
    h.render=()=>root.render(<QueryProvider><Probe key={h.visit}/></QueryProvider>);
    h.act=act;h.start=()=>act(async()=>{h.render();});
    h.refetch=()=>h.client.refetchQueries({queryKey:['pipelines',h.auth.activeOrganization.organizationId],exact:true,type:'active'},{cancelRefetch:false});
    h.remount=()=>act(async()=>{flushSync(()=>{h.visit++;h.render();});await h.refetch();});
    h.snapshot=()=>({name:document.getElementById('root').textContent,options:h.options,selectedId:h.props.pipelineId,error:h.props.hasDynamicOptionsError,
      busy:h.props.isRetryingDynamicOptions,ancillary:h.ancillary,calls:h.calls.map(c=>({org:c.org,actor:c.actor,aborted:c.signal.aborted,completed:c.completed})),
      clientCount:h.clients.length,oldName:h.clients[0]?.getQueryData(['pipelines','org-a'])?.[0]?.name,renders:h.renders,
      cached:h.client.getQueryData(['pipelines',h.auth.activeOrganization.organizationId])});
    h.close=()=>act(async()=>{root.unmount();h.clients.forEach(c=>c.clear());});
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack.js');
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(root, 'node_modules'), 'node_modules'], alias: { '@/hooks/use-stages$': catalog, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] }, optimization: { minimize: false } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8'); browser = await chromium.launch({ headless: true });
}, { timeout: 120_000 });
after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(basename(directory), /^vimob-dashboard-pipeline-options-/);
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const page = await browser.newPage(), errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.h.start());
  const snapshot = () => page.evaluate(() => window.h.snapshot());
  const idle = () => expect.poll(async () => (await snapshot()).busy).toBe(false);
  await expect.poll(async () => (await snapshot()).calls.length).toBe(1); await idle();
  return {
    page, snapshot, idle,
    async fail(status, code) { await page.evaluate(async ({ status, code }) => { const h = window.h; h.failure = { status, code }; await h.act(async () => { await h.refetch(); }); }, { status, code }); },
    async respond(name = 'Recovered pipeline') { await page.evaluate(name => { window.h.rows = [{ id: 'pipeline-a', name, is_default: true }]; window.h.failure = null; }, name); },
    async open(open = true) { await page.evaluate(open => window.h.act(async () => { window.h.props.onFiltersOpenChange(open); }), open); },
    async retry() { await page.evaluate(() => window.h.act(async () => { window.h.props.onRetryDynamicOptions(); })); },
    async stale() { await page.evaluate(() => window.h.act(async () => { const h = window.h; h.client.setQueryData(['pipelines', h.auth.activeOrganization.organizationId], h.rows, { updatedAt: 1 }); })); },
    async pause() { await page.evaluate(() => { const h = window.h; h.gate = new Promise(resolveGate => { h.release = resolveGate; }); }); },
    async release() { await page.evaluate(() => window.h.act(async () => { const h = window.h; h.gate = null; h.release?.(); })); },
    async remount() { await page.evaluate(() => window.h.remount()); await idle(); },
    async ready(value) { await page.evaluate(value => window.h.act(async () => { window.h.scopeReady = value; window.h.render(); }), value); },
    async switchTo(org, actor) { await page.evaluate(({ org, actor }) => window.h.act(async () => { const h = window.h; h.auth = { ...h.auth, user: { id: actor }, activeOrganization: { organizationId: org } }; h.render(); }), { org, actor }); await idle(); },
    async close() { try { await page.evaluate(() => window.h.close()); assert.deepEqual(errors, [], 'browser runtime errors'); assert.deepEqual(network, [], 'external requests forbidden'); } finally { await page.close(); } },
  };
}

for (const [status, code] of [[401, 'missing_session'], [403, 'permission_denied'], [503, 'session_check_unavailable']]) {
  test(`cached pipeline names disappear after ${status}/${code}, preserving the selected ID`, async () => {
    const h = await fixture(); try {
      assert.match((await h.snapshot()).name, /Private pipeline A/); await h.fail(status, code); const s = await h.snapshot();
      assert.equal(s.cached[0].name, 'Private pipeline A'); assert.equal(s.options.length, 0); assert.doesNotMatch(s.name, /Private pipeline A/);
      assert.match(s.name, /Pipeline: indisponível/); assert.equal(s.selectedId, 'pipeline-a'); assert.equal(s.ancillary.selection, 0); assert.equal(s.error, true);
    } finally { await h.close(); }
  });
}
test('ordinary 503 retains the last successful name and exposes the catalog error', async () => {
  const h = await fixture(); try {
    await h.fail(503, 'service_unavailable'); const s = await h.snapshot();
    assert.match(s.name, /Private pipeline A/); assert.equal(s.options.length, 1); assert.equal(s.error, true); assert.equal(s.selectedId, 'pipeline-a');
  } finally { await h.close(); }
});
test('access denial followed by an ordinary 503 cannot restore the previous private name', async () => {
  const h = await fixture(); try {
    await h.fail(403, 'permission_denied'); assert.equal((await h.snapshot()).options.length, 0); await h.fail(503, 'service_unavailable');
    const s = await h.snapshot(); assert.equal(s.cached[0].name, 'Private pipeline A'); assert.equal(s.options.length, 0); assert.doesNotMatch(s.name, /Private pipeline A/);
    await h.respond('New authorized catalog'); await h.open(); await h.idle(); assert.match((await h.snapshot()).name, /New authorized catalog/);
  } finally { await h.close(); }
});
for (const action of ['open', 'retry']) test(`${action} recovers an access-failed catalog without resetting the applied ID`, async () => {
  const h = await fixture(); try {
    await h.fail(403, 'permission_denied'); await h.respond(); const before = (await h.snapshot()).calls.length; await h[action](); await h.idle();
    const s = await h.snapshot(); assert.equal(s.calls.length, before + 1); assert.match(s.name, /Recovered pipeline/); assert.equal(s.error, false); assert.equal(s.selectedId, 'pipeline-a');
    assert.equal(s.ancillary.selection, 0); if (action === 'open') assert.deepEqual([s.ancillary.tags, s.ancillary.meta, s.ancillary.teams], [0, 0, 0]);
  } finally { await h.close(); }
});
test('fresh catalog opening/closing and retry add no pipeline request', async () => {
  const h = await fixture(); try {
    const before = (await h.snapshot()).calls.length; for (let i = 0; i < 5; i++) { await h.open(); await h.open(false); }
    await h.retry(); const s = await h.snapshot(); assert.equal(s.calls.length, before); assert.equal(s.selectedId, 'pipeline-a');
  } finally { await h.close(); }
});
test('stale catalog reads once on opening and uses the new name', async () => {
  const h = await fixture(); try {
    await h.stale(); await h.respond('Fresh catalog name'); const before = (await h.snapshot()).calls.length; await h.open(); await h.idle();
    const s = await h.snapshot(); assert.equal(s.calls.length, before + 1); assert.match(s.name, /Fresh catalog name/);
  } finally { await h.close(); }
});
test('slow failed-catalog recovery deduplicates openings and retry without canceling the request', async () => {
  const h = await fixture(); try {
    await h.fail(401, 'missing_session'); await h.respond('After slow recovery'); await h.pause(); const before = (await h.snapshot()).calls.length;
    await h.open(); assert.equal((await h.snapshot()).busy, true); assert.doesNotMatch((await h.snapshot()).name, /Private pipeline A/);
    for (let i = 0; i < 5; i++) { await h.open(false); await h.open(); await h.retry(); }
    const pending = await h.snapshot(); assert.equal(pending.calls.length, before + 1); assert.equal(pending.calls.at(-1).aborted, false);
    await h.release(); await h.idle(); const s = await h.snapshot(); assert.match(s.name, /After slow recovery/); assert.equal(s.selectedId, 'pipeline-a');
  } finally { await h.release(); await h.close(); }
});
test('unready scope hides catalog names and prevents recovery reads', async () => {
  const h = await fixture(); try {
    await h.ready(false); await h.stale(); const before = (await h.snapshot()).calls.length; await h.open(); await h.retry();
    const s = await h.snapshot(); assert.equal(s.calls.length, before); assert.equal(s.options.length, 0); assert.match(s.name, /indisponível/); assert.equal(s.selectedId, 'pipeline-a');
  } finally { await h.close(); }
});
for (const [org, actor] of [['org-b', 'actor-a'], ['org-a', 'actor-b']]) test(`real provider boundary isolates catalog when switching to ${org}/${actor}`, async () => {
  const h = await fixture(); try {
    await h.respond('Current actor catalog'); await h.switchTo(org, actor); let s = await h.snapshot(); assert.equal(s.clientCount, 2);
    assert.doesNotMatch(s.name, /Private pipeline A/); assert.match(s.name, /Current actor catalog/); await h.fail(403, 'permission_denied');
    assert.doesNotMatch((await h.snapshot()).name, /Current actor catalog/); await h.respond('Current recovered'); const before = (await h.snapshot()).calls.length;
    await h.open(); await h.idle(); s = await h.snapshot(); assert.equal(s.calls.length, before + 1); assert.equal(s.calls.at(-1).org, org); assert.equal(s.calls.at(-1).actor, actor); assert.equal(s.oldName, 'Private pipeline A');
  } finally { await h.close(); }
});
test('remount on the same client after denied then transient failure cannot revive cached names', async () => {
  const h = await fixture(); try {
    await h.fail(403, 'permission_denied'); await h.fail(503, 'service_unavailable'); await h.remount();
    const s = await h.snapshot(); assert.equal(s.clientCount, 1); assert.equal(s.options.length, 0); assert.doesNotMatch(s.name, /Private pipeline A/);
    await h.respond('Authorized after remount'); await h.open(); await h.idle(); assert.match((await h.snapshot()).name, /Authorized after remount/);
  } finally { await h.close(); }
});
for (const [org, actor] of [['org-b', 'actor-a'], ['org-a', 'actor-b']]) test(`late old response cannot replace current catalog after ${org}/${actor} switch`, async () => {
  const h = await fixture(); try {
    await h.stale(); await h.respond('Late old private catalog'); await h.pause(); await h.open();
    const pending = await h.snapshot(), oldCall = pending.calls.length - 1;
    assert.equal(pending.busy, true); assert.equal(pending.calls[oldCall].completed, false);
    await h.respond('New scope catalog'); await h.page.evaluate(() => { window.h.gate = null; }); await h.switchTo(org, actor);
    assert.match((await h.snapshot()).name, /New scope catalog/);
    await h.release(); await h.idle(); const s = await h.snapshot();
    assert.equal(s.clientCount, 2); assert.equal(s.calls[oldCall].completed, true, 'old synthetic transport actually resolved after the new scope');
    assert.doesNotMatch(s.name, /Late old private catalog/); assert.match(s.name, /New scope catalog/);
    assert.equal(s.calls.at(-1).org, org); assert.equal(s.calls.at(-1).actor, actor);
  } finally { await h.release(); await h.close(); }
});
test('denial and 503 batched before a React render cannot revive the old authorized snapshot', async () => {
  const h = await fixture(); try {
    const counts = await h.page.evaluate(async () => {
      const h = window.h, before = h.renders; h.pauseNotifications = true;
      await h.act(async () => {
        h.failure = { status: 403, code: 'permission_denied' }; await h.refetch();
        h.failure = { status: 503, code: 'service_unavailable' }; await h.refetch();
      });
      const beforeDelivery = h.renders; h.pauseNotifications = false;
      await h.act(async () => { h.notifications.splice(0).forEach(callback => callback()); });
      return { before, beforeDelivery };
    });
    assert.equal(counts.beforeDelivery, counts.before, 'both error states must happen before React receives a notification');
    const s = await h.snapshot(); assert.equal(s.options.length, 0); assert.doesNotMatch(s.name, /Private pipeline A/);
    await h.respond('Authorized after batch'); await h.open(); await h.idle(); assert.match((await h.snapshot()).name, /Authorized after batch/);
  } finally { await h.close(); }
});
