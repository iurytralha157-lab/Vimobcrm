import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const pipelineA = '30000000-0000-4000-8000-000000000001';
const pipelineB = '30000000-0000-4000-8000-000000000002';
const stageA = '40000000-0000-4000-8000-000000000001';
// Optional read-only baseline replay; it never changes the checkout.
const screenSource = process.env.VIMOB_CONTACTS_FILTER_TEST_SOURCE
  ?? path.join(root, 'components/features/contacts/ContactsScreen.tsx');
let directory, browser, page;
const errors = [];

// The screen, model, pagination, FilterProvider and saved controls are real.
// Data hooks, identity and list/toolbar controls are synthetic; network is blocked.
const synthetic = `
import React from 'react';
import { buildContactListFilters, buildContactExportFilters, toggleContactSelection, toggleCurrentPageSelection } from '@/components/features/contacts/contacts-screen/model';
export { buildContactListFilters, buildContactExportFilters, toggleContactSelection, toggleCurrentPageSelection };
const noop=()=>{};
const auth={user:{id:'${userId}'},profile:{id:'${userId}'},session:null,isSuperAdmin:true,impersonating:null,
  activeOrganization:{organizationId:'${organizationId}'},tenantContext:{organizationId:'${organizationId}',memberRole:'admin',permissions:['lead_view_all'],enabledModules:['crm'],isSuperAdmin:true}};
export const useAuth=()=>auth;
export const useUserPermissions=()=>({hasPermission:()=>true,isLoading:false});
export const useFloatingChat=()=>({openNewChat:noop});
export const useIsMobile=()=>false;
export const useToast=()=>({toast:noop});
export const useTags=()=>({data:[],refetch:noop,isError:false,isFetching:false,isLoading:false});
export const useTeams=()=>({data:[],refetch:noop,isError:false,isFetching:false,isLoading:false,isSuccess:true});
export const useOrganizationUsers=()=>({data:[]});
export const usePipelines=()=>({data:[{id:'${pipelineA}',name:'A',is_default:true},{id:'${pipelineB}',name:'B'}]});
export const useStages=id=>({data:id==='${pipelineA}'?[{id:'${stageA}',name:'A1'}]:[]});
window.fixtureQueries=[];
// These filter cases exercise reads and selection wiring without action transport.
export const MAX_CONTACT_LEAD_ACTION_TARGETS=100;
export const useStageAutomations=()=>({data:[]});
export const useContactLeadActions=()=>({prepare:()=>{throw Error('No lead review in the filter fixture');},run:()=>{throw Error('No lead writes in the filter fixture');}});
export const useContactsList=filters=>{window.fixtureQuery=filters;window.fixtureQueries.push(JSON.parse(JSON.stringify(filters)));return {data:[],total:200,isLoading:false,isFetching:false,isError:false,isPlaceholderData:false,refetch:noop};};
export const useLead=()=>({data:null,isFetching:false,isError:false,refetch:noop});
export const useDeleteLead=()=>({isPending:false,mutateAsync:noop});
export const useBulkDeleteLeads=()=>({isPending:false,mutateAsync:noop});
const params=new URLSearchParams();
export const useSearchParams=()=>params;
export const useRouter=()=>({push:noop,replace:noop});
export const getGlobalSignOutSessionId=()=> 'synthetic-session';
export const getLeadMetaFilters=async()=>({sources:[],pages:[],campaigns:[],adsets:[],ads:[]});
export const getErrorMessageOrFallback=(_err,fallback)=>fallback;
export const AppLayout=({children})=><>{children}</>;
export const ContactsToolbar=props=>{window.fixtureToolbar=props;return <><button onClick={()=>props.filters.onStageChange('${stageA}')}>Select A1</button><button onClick={()=>props.filters.onSourceChange('manual')}>Select source</button></>;};
export const ContactsList=props=><><button onClick={()=>props.footer?.props.onPageChange(4)}>Page4</button>{props.footer}</>;
export const ContactsOverlays=props=>{window.fixtureOverlays=props;return null;};
export const ContactsBulkSelectionBar=()=>null;
export { ContactsPagination } from '@/components/features/contacts/contacts-screen/ContactsPagination';
`;
const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FilterProvider,useFilters} from '@/contexts/FilterContext';
import Contacts from ${JSON.stringify(screenSource)};
function Observer(){const context=useFilters();window.fixtureContext=context;return null;}
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function App(){const[tick,setTick]=useState(0);window.fixtureRenderTick=tick;window.fixtureRerender=()=>setTick(value=>value+1);return <FilterProvider><Observer/><Contacts renderTick={tick}/></FilterProvider>;}
createRoot(document.getElementById('app')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-contacts-filter-application-'));
  const stub = path.join(directory, 'synthetic.tsx');
  const entry = path.join(directory, 'fixture.tsx');
  const loader = path.join(directory, 'loader.cjs');
  await Promise.all([
    writeFile(stub, synthetic), writeFile(entry, fixture),
    writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`),
  ]);
  const names = ['contexts/AuthContext', 'contexts/FloatingChatContext', 'hooks/use-user-permissions', 'hooks/use-mobile', 'hooks/use-toast', 'hooks/use-tags', 'hooks/use-teams', 'hooks/use-users', 'hooks/use-stages', 'hooks/use-contacts-list', 'hooks/use-leads', 'hooks/contacts/use-contact-lead-actions', 'hooks/use-stage-automations', 'lib/api/pipeline-board', 'lib/api/vimob-error', 'lib/auth/global-sign-out', 'components/shared/layout/AppLayout', 'components/features/contacts/contacts-screen'];
  const aliases = Object.fromEntries(names.map(name => [`@/${name}$`, stub]));
  const { webpack } = require('next/dist/compiled/webpack/webpack.js');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry,
      output: { path: directory, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { ...aliases, './AuthContext$': stub, 'next/navigation$': stub, '@': root }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] },
    });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  browser = await chromium.launch({ headless: true });
});
beforeEach(async () => {
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'https://contacts-filter-application.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());
  await page.goto('https://contacts-filter-application.invalid/');
  await page.addScriptTag({ content: await readFile(path.join(directory, 'bundle.js'), 'utf8') });
  await page.waitForFunction(() => window.fixtureContext?.isHydrated && window.fixtureQuery);
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  if (directory) {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(tmpdir()));
    assert(path.basename(target).startsWith('vimob-contacts-filter-application-'));
    await rm(target, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
});
async function restore(patch) {
  const revision = await page.evaluate(() => window.fixtureContext.filterApplicationRevision);
  assert.equal(await page.evaluate(patch => window.fixtureContext.restoreFilterSnapshot({ ...window.fixtureContext.getFilterSnapshot(), ...patch }), patch), true);
  await page.waitForFunction(({patch, revision}) => window.fixtureContext.filterApplicationRevision > revision
    && Object.entries(patch).every(([key, value]) => JSON.stringify(window.fixtureContext.getFilterSnapshot()[key]) === JSON.stringify(value)), {patch, revision});
}
async function selectStage() {
  await restore({ pipelineId: pipelineA });
  await page.getByRole('button', { name: 'Select A1', exact: true }).click();
  await page.waitForFunction(stage => window.fixtureQuery.stageId === stage, stageA);
}
async function selectPage4() {
  await page.getByRole('button', { name: 'Page4', exact: true }).click();
  await page.waitForFunction(() => window.fixtureQuery.page === 4);
}

test('an explicit snapshot application resets the local stage before the restored pipeline is queried', async () => {
  await restore({ pipelineId: pipelineA });
  const snapshot = await page.evaluate(() => window.fixtureContext.getFilterSnapshot());
  await selectStage();
  await restore({ pipelineId: pipelineB });
  const count = await page.evaluate(() => window.fixtureQueries.length);
  await restore(snapshot);
  assert.equal(await page.evaluate(() => window.fixtureQuery.pipelineId), pipelineA);
  assert.equal(await page.evaluate(() => window.fixtureQuery.stageId), undefined);
  const queries = await page.evaluate(count => window.fixtureQueries.slice(count), count);
  assert(queries.some(query => query.pipelineId === pipelineA));
  assert(queries.filter(query => query.pipelineId === pipelineA).every(query => query.stageId === undefined));
});

test('applying a snapshot resets pagination before querying the new criteria', async () => {
  await selectPage4();
  const count = await page.evaluate(() => window.fixtureQueries.length);
  await restore({ source: 'manual' });
  assert.equal(await page.evaluate(() => window.fixtureQuery.page), 1);
  const queries = await page.evaluate(count => window.fixtureQueries.slice(count), count);
  assert(queries.some(query => query.source === 'manual'));
  assert(queries.filter(query => query.source === 'manual').every(query => query.page === 1));
});

test('reapplying an identical snapshot resets stage and page without changing shared criteria', async () => {
  await selectStage();
  await selectPage4();
  const snapshot = await page.evaluate(() => window.fixtureContext.getFilterSnapshot());
  await restore(snapshot);
  assert.equal(await page.evaluate(() => window.fixtureQuery.stageId), undefined);
  assert.equal(await page.evaluate(() => window.fixtureQuery.page), 1);
  assert.deepEqual(await page.evaluate(() => window.fixtureContext.getFilterSnapshot()), snapshot);
});

test('ordinary local selection and rerenders keep stage and page, while field changes reset page', async () => {
  await selectStage();
  await selectPage4();
  const tick = await page.evaluate(() => window.fixtureRenderTick);
  await page.evaluate(() => window.fixtureRerender());
  await page.waitForFunction(tick => window.fixtureRenderTick > tick, tick);
  assert.equal(await page.evaluate(() => window.fixtureQuery.stageId), stageA);
  assert.equal(await page.evaluate(() => window.fixtureQuery.page), 4);
  await page.getByRole('button', { name: 'Select source', exact: true }).click();
  await page.waitForFunction(() => window.fixtureQuery.source === 'manual' && window.fixtureQuery.page === 1);
  assert.equal(await page.evaluate(() => window.fixtureQuery.stageId), stageA);
});

test('real previous and next page controls work before and after a full filter application', async () => {
  await selectPage4();
  await page.getByRole('button', { name: 'Ir para a página anterior', exact: true }).click();
  await page.waitForFunction(() => window.fixtureQuery.page === 3);
  await page.getByRole('button', { name: 'Ir para a próxima página', exact: true }).click();
  await page.waitForFunction(() => window.fixtureQuery.page === 4);
  await restore({ source: 'manual' });
  await expect(page.getByRole('button', { name: 'Ir para a página anterior', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Ir para a próxima página', exact: true }).click();
  await page.waitForFunction(() => window.fixtureQuery.page === 2);
  await page.getByRole('button', { name: 'Ir para a página anterior', exact: true }).click();
  await page.waitForFunction(() => window.fixtureQuery.page === 1);
});

test('export refuses to open while the newly applied search is still settling', async () => {
  await page.evaluate(() => window.fixtureToolbar.filters.onSearchChange('Anterior'));
  await page.waitForFunction(() => window.fixtureQuery.search === 'Anterior');
  await page.evaluate(() => window.fixtureToolbar.filters.onSearchChange('Nova'));
  await page.evaluate(() => window.fixtureToolbar.onExport());
  assert.equal(await page.evaluate(() => window.fixtureOverlays.exportDialogOpen), false);
  await page.waitForFunction(() => window.fixtureQuery.search === 'Nova');
  await page.evaluate(() => window.fixtureToolbar.onExport());
  assert.equal(await page.evaluate(() => window.fixtureOverlays.exportDialogOpen), true);
  assert.equal(await page.evaluate(() => window.fixtureOverlays.exportFilters.search), 'Nova');
});

test('an open export dialog immediately receives the applied search without being closed', async () => {
  await page.evaluate(() => window.fixtureToolbar.filters.onSearchChange('Anterior'));
  await page.waitForFunction(() => window.fixtureQuery.search === 'Anterior');
  await page.evaluate(() => window.fixtureToolbar.onExport());
  await page.waitForFunction(() => window.fixtureOverlays.exportDialogOpen);
  await page.evaluate(() => window.fixtureToolbar.filters.onSearchChange('Nova'));
  const result = await page.evaluate(() => ({
    open: window.fixtureOverlays.exportDialogOpen,
    exportSearch: window.fixtureOverlays.exportFilters.search,
    listSearch: window.fixtureQuery.search,
  }));
  assert.equal(result.listSearch, 'Anterior', 'the list is still debounced');
  assert.equal(result.open, true, 'a filter update must not abort an existing export');
  assert.equal(result.exportSearch, 'Nova');
});
