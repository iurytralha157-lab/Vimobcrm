import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real board/button, production handler, hooks, QueryProvider, page/access leases,
// API and Zod. Auth/transport and unrelated drag/card presentation are synthetic.
const require = createRequire(import.meta.url), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const org = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
const pipeline = '33333333-3333-4333-8333-333333333333', stageA = '44444444-4444-4444-8444-444444444444', stageB = '55555555-5555-4555-8555-555555555555';
const lead = '66666666-6666-4666-8666-666666666666';
let directory, browser, page, bundle;
const errors = [];
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-empty-column-'));
  const stub = path.join(directory, 'synthetic.tsx'), entry = path.join(directory, 'entry.tsx'), loader = path.join(directory, 'loader.cjs'), cssLoader = path.join(directory, 'css-loader.cjs'), validation = path.join(directory, 'validation.ts');
  const ts = require('typescript'), screen = 'components/features/pipelines/PipelinesScreen.tsx';
  const parsed = ts.createSourceFile(screen, await readFile(path.join(root, screen), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function find(node) { if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleLoadMore') handler = node.getText(parsed);ts.forEachChild(node, find); }find(parsed);assert(handler);
  await writeFile(validation, `export * from ${JSON.stringify(path.join(root, 'lib/validation/pipelines.ts'))};export * from ${JSON.stringify(path.join(root, 'lib/validation/common.ts'))};`);
  await writeFile(stub, `import React,{createContext,useContext}from'react';export const Auth=createContext(null),useAuth=()=>useContext(Auth);
    export{VimobAPIError}from${JSON.stringify(path.join(root, 'lib/api/vimob-error.ts'))};export const vimobAPIRequest=(url,options)=>window.h.request(url,options);
    export const getVimobAPIAccessTokenUserId=()=>window.h.scope.actor,getVimobAPIAccessTokenSessionId=()=>window.h.scope.sid;
    export const useWhatsAppQueryScope=()=>({organizationId:'test',userId:'test',accessScope:'test'});
    export const toast={error:message=>window.h.notices.push(message)};
    export const LeadCard=({lead})=><div data-lead={lead.id}>{lead.id}</div>;
    export const PipelineDragBoard=({children})=><>{children}</>,PipelineDropColumn=({children})=><div>{children}</div>,PipelineSortableLeadCard=LeadCard;
  `);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(cssLoader, "module.exports=()=> 'export default {}';");
  await writeFile(entry, `import React,{useState,useCallback}from'react';import{createRoot}from'react-dom/client';import{useQueryClient}from'@tanstack/react-query';
    import{Auth,toast,VimobAPIError}from'./synthetic';import{QueryProvider}from'@/components/providers/query-provider';
    import{useStagesWithLeads,useLoadMoreLeads}from'@/hooks/use-stages';import{PipelineBoard}from'@/components/features/pipelines/pipeline-screen/PipelineBoard';
    import{buildStageCountMetaMap,getPipelineErrorMessage}from'@/components/features/pipelines/pipeline-screen/model';import{getPipelineLeadPageCursor}from'@/lib/pipeline-pagination-state';import{stageWithLeadsQueryKey}from'@/lib/pipeline-query-key';
    import{registerPendingPipelineMove,clearPendingPipelineMoves}from'@/lib/pipeline-board-cache';
    const h=window.h={pipeline:'${pipeline}',stageA:'${stageA}',stageB:'${stageB}',lead:'${lead}',boards:[],pages:[],invalidations:[],callbacks:[],notices:[],finishes:0,replies:[],gates:[]};
    h.row=(stage,organizationId='${org}',id='${lead}')=>({id,stage_id:stage,pipeline_id:'${pipeline}',organization_id:organizationId,team_id:null,can_operate:true,name:'Synthetic lead',created_at:'2026-10-19T12:00:00Z',stage_entered_at:'2026-10-19T12:00:00Z'});
    h.stage=(id,leads,total,has_more)=>({id,name:id==='${stageA}'?'Source':'Destination',pipeline_id:'${pipeline}',position:id==='${stageA}'?0:1,is_qualified:false,leads,total_lead_count:total,has_more});
    h.initial=organizationId=>[h.stage('${stageA}',[h.row('${stageA}',organizationId)],0,false),h.stage('${stageB}',[],1,true)];h.coherent=organizationId=>[h.stage('${stageA}',[],0,false),h.stage('${stageB}',[h.row('${stageB}',organizationId)],1,false)];
    h.clients=new WeakSet();h.setup=client=>{h.client=client;if(h.clients.has(client))return;h.clients.add(client);client.getMutationCache().config.onMutate=()=>h.beforeGate?new Promise(resolve=>h.gates.push(resolve)):undefined;client.getMutationCache().config.onSettled=()=>{h.finishes++};
      const invalidate=client.invalidateQueries.bind(client);client.invalidateQueries=(filters,...rest)=>{h.invalidations.push({key:filters.queryKey,exact:filters.exact,refetchType:filters.refetchType});return invalidate(filters,...rest)};
    };
    h.request=async(url,options={})=>{if(url==='/v1/pipeline-board'){h.boards.push({organizationId:options.organizationId,query:structuredClone(options.query)});if(h.failRecoveryOnce&&h.boards.length>1){h.failRecoveryOnce=false;throw new VimobAPIError('Synthetic read rejected',{status:400,code:'synthetic_read_failure'})}return{data:h.stayEmpty||h.boards.length===1?h.initial(options.organizationId):h.nextBoard||h.coherent(options.organizationId)}};
      if(url!=='/v1/pipeline-stage-leads')throw Error('Unexpected synthetic route '+url);
      if(options.signal?.aborted||(options.expectedUserId!==undefined&&options.expectedUserId!==h.scope.actor)||(options.expectedSessionId!==undefined&&options.expectedSessionId!==h.scope.sid))throw new VimobAPIError('Retired page',{status:409,code:'api_request_identity_changed'});
      h.pages.push({organizationId:options.organizationId,query:structuredClone(options.query),expectedUserId:options.expectedUserId,expectedSessionId:options.expectedSessionId,hasSignal:Boolean(options.signal)});
      const response=()=>({stageId:h.wrongStage?'${stageA}':'${stageB}',leads:h.replyEmpty?[]:h.pageRows||[h.row('${stageB}',options.organizationId)]});if(h.replyGate)return await new Promise(resolve=>h.replies.push(()=>resolve(response())));return response();
    };
    const noop=()=>{};
    function Content(){h.setup(useQueryClient());const filters={searchQuery:h.scope.filter},filterUserId=undefined,pipelineBoardFilters=filters,effectivePipelineFilterUser=filterUserId,selectedPipelineId=h.pipeline;
      const board=useStagesWithLeads(h.pipeline,filterUserId,filters),loadMoreLeads=useLoadMoreLeads(),stages=board.data||[];h.currentKey=stageWithLeadsQueryKey({organizationId:h.scope.org,pipelineId:h.pipeline,filterUserId,filters});h.data=stages;h.status=loadMoreLeads.status;
      const ${handler};
      h.start=()=>{const target=stages.find(stage=>stage.id===h.stageB),cursor=getPipelineLeadPageCursor(target?.leads.at(-1));h.oldClient=h.client;h.input={pipelineId:h.pipeline,stageId:h.stageB,offset:target?.leads.length||0,...cursor,filters};loadMoreLeads.mutateAsync(h.input,{onSuccess:()=>h.callbacks.push('success'),onError:()=>h.callbacks.push('error')}).then(()=>h.outcome={ok:true},error=>h.outcome={ok:false,message:error.message})};
      h.patch=(next)=>h.client.setQueryData(h.currentKey,next);h.pending=()=>{registerPendingPipelineMove(h.currentKey,{leadId:h.lead,sourceStageId:h.stageA,destinationStageId:h.stageB,destinationIndex:0,fallbackLead:h.row(h.stageA,h.scope.org),optimisticPatch:{stage_id:h.stageB},keepInDestination:true,version:1})};h.clearPending=()=>clearPendingPipelineMoves(h.currentKey);
      return <><span>ready</span><div style={{height:500,width:'100%',display:'flex',flexDirection:'column'}}><PipelineBoard stages={stages} filteredStages={stages} visibleStages={h.scope.mobile?stages.slice(-1):stages} stageValueMap={new Map()} stageCountMetaMap={buildStageCountMetaMap(stages)} selectedPipelineId={h.pipeline} isMobile={h.scope.mobile} isLoading={board.isPending} isInitialLeadsLoading={board.isPending} isPipelineBoardTransitioning={false} leadsPlaceholderData={false} hasCriticalLoadError={false} hasPipelineBoardError={board.isError} isRefreshing={false} pipelinesFetching={false} leadVisibilityFetching={false} hasPreviousMobileStage={false} hasNextMobileStage={false} canEditPipeline={false} hasWhatsAppModule={false} canViewWhatsApp={false} canOperateWhatsApp={false} canShowColumnActions={false} isDragDisabled nowMs={0} editingStageId={null} editingStageName='' savingStageNameId={null} loadMoreIsPending={loadMoreLeads.isPending} loadingMoreStageId={h.stageB} onDragStart={noop} onDragEnd={noop} onCriticalLoadRetry={noop} onBoardRefresh={noop} onMobileStageNavigation={noop} onEditingStageNameChange={noop} onStartEditingStage={noop} onCommitStageName={noop} onCancelEditingStage={noop} onOpenStageSettings={noop} onOpenLead={noop} onAssignLeadNow={noop} onLoadMore={handleLoadMore} onCreateStage={noop} onCreatePipeline={noop}/></div></>}
    function Fixture(){const[scope,setScope]=useState({org:'${org}',actor:'${actor}',sid:'sid-a',permissions:['pipeline_manage'],filter:'',nonce:0,mobile:false}),[shown,setShown]=useState(true);h.scope=scope;h.change=patch=>setScope(old=>({...old,...patch}));h.close=()=>setShown(false);
      const auth={activeOrganization:{organizationId:scope.org},user:{id:scope.actor},session:{access_token:'header.'+btoa(JSON.stringify({sub:scope.actor,session_id:scope.sid,iat:scope.nonce}))+'.synthetic'},tenantContext:{organizationId:scope.org,permissions:scope.permissions,enabledModules:['automations'],isSuperAdmin:false,memberRole:'user'}};
      return <Auth.Provider value={auth}><QueryProvider>{shown&&<Content/>}</QueryProvider></Auth.Provider>};createRoot(document.getElementById('app')).render(<Fixture/>);
  `);
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', devtool: false, entry, output: { path: directory, filename: 'fixture.js' },
      plugins: [new webpack.NormalModuleReplacementPlugin(/(^|[/\\])vimob-client(\.ts)?$/, stub), new webpack.NormalModuleReplacementPlugin(/(^|[/\\])PipelineDragBoard(\.tsx)?$/, stub)],
      resolve: { extensions: ['.tsx', '.ts', '.js'], modules: [path.join(root, 'node_modules'), 'node_modules'], alias: { '@/contexts/AuthContext$': stub, '@/hooks/use-whatsapp-query-scope$': stub, '@/lib/api/vimob-client$': stub, '@/lib/validation$': validation, '@/components/features/leads/LeadCard$': stub, '@/components/features/pipelines/pipeline-screen/PipelineDragBoard$': stub, 'sonner$': stub, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }, { test: /\.module\.css$/, use: cssLoader }] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });bundle = await readFile(path.join(directory, 'fixture.js'), 'utf8');browser = await chromium.launch({ headless: true });
}, { timeout: 180_000 });
beforeEach(async () => { page = await browser.newPage({ viewport: { width: 1200, height: 800 } });page.setDefaultTimeout(5_000);page.on('pageerror', error => errors.push(error.stack || error.message));await page.route('**/*', route => route.request().url() === 'https://empty-column.invalid/' ? route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }) : route.abort());await page.goto('https://empty-column.invalid/');await page.addScriptTag({ content: 'window.process={env:{NODE_ENV:"test"}};' });await page.addScriptTag({ content: bundle });await page.waitForFunction(() => window.h.data?.length === 2); });
afterEach(async () => { await page?.close(); });
after(async () => { await browser?.close();if (directory) { assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));assert(path.basename(directory).startsWith('vimob-empty-column-'));await rm(directory, { recursive: true, force: true }); }assert.deepEqual(errors, []); });
async function finish(count = 1) { await page.waitForFunction(count => window.h.finishes === count && window.h.client.getQueryState(window.h.currentKey)?.fetchStatus !== 'fetching' && window.h.data === window.h.client.getQueryData(window.h.currentKey), count);return page.evaluate(() => ({ data: window.h.data, pages: window.h.pages, boards: window.h.boards, invalidations: window.h.invalidations, callbacks: window.h.callbacks })); }
async function replace(patch) { await page.evaluate(patch => window.h.change(patch), patch);await page.waitForFunction(patch => Object.entries(patch).every(([key, value]) => JSON.stringify(window.h.scope[key]) === JSON.stringify(value)), patch); }
function coherent(state) { assert.equal(state.data[0].leads.length, 0);assert.deepEqual(state.data[1].leads.map(row => row.id), [lead]);assert.equal(state.data[1].has_more, false);assert.equal(state.data.flatMap(stage => stage.leads).filter(row => row.id === lead).length, 1); }

for (const mobile of [false, true]) test('real load-more button recovers the empty column and moved duplicate: ' + (mobile ? 'mobile' : 'desktop'), async () => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 });await replace({ mobile: true }); }
  await page.getByRole('button', { name: 'Carregar mais (1 restantes)', exact: true }).click();const state = await finish();coherent(state);assert.equal(state.pages.length, 1);assert.equal(state.boards.length, 2);assert.equal(state.invalidations.length, 1);assert.equal(state.invalidations[0].exact, true);assert.equal(state.pages[0].query.offset, 0);assert.equal(state.pages[0].query.cursorBefore, undefined);assert.equal(state.pages[0].expectedSessionId, 'sid-a');
});
test('an empty page causes one exact refetch and no automatic loop', async () => {
  await page.evaluate(() => { window.h.replyEmpty = true;window.h.stayEmpty = true;window.h.start(); });const state = await finish();assert.equal(state.boards.length, 2);assert.equal(state.pages.length, 1);assert.deepEqual(state.callbacks, []);assert.equal(state.data[1].has_more, true);await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));assert.equal(await page.evaluate(() => window.h.boards.length), 2);assert.equal(await page.evaluate(() => window.h.pages.length), 1);
});
test('normal nonempty pagination still appends once and preserves cursor/dedup', async () => {
  await page.evaluate(() => { const h = window.h;h.pageRows = Array.from({ length: 12 }, (_, i) => h.row(h.stageB,h.scope.org,'77777777-7777-4777-8777-'+String(i).padStart(12,'0')));h.patch([h.stage(h.stageA,[],0,false),h.stage(h.stageB,[h.row(h.stageB)],13,true)]); });await page.evaluate(() => window.h.start());const state = await finish();assert.equal(state.data[1].leads.length, 13);assert.equal(state.pages.length, 1);assert.equal(state.boards.length, 1);assert.equal(state.pages[0].query.offset, 1);assert.equal(state.pages[0].query.cursorBeforeId, lead);assert.deepEqual(state.callbacks, ['success']);
});
for (const patch of [{ sid: 'sid-b' }, { org: '88888888-8888-4888-8888-888888888888' }, { permissions: [] }]) for (const gate of ['before', 'reply']) test('retired access never recovers into the current cache: ' + gate + '/' + JSON.stringify(patch), async () => {
  await page.evaluate(gate => { window.h[gate === 'before' ? 'beforeGate' : 'replyGate'] = true;window.h.start(); }, gate);await page.waitForFunction(gate => window.h[gate === 'before' ? 'gates' : 'replies'].length === 1, gate);await replace(patch);const invalidations = await page.evaluate(() => window.h.invalidations.length);
  await page.evaluate(gate => gate === 'before' ? window.h.gates[0]() : window.h.replies[0](), gate);await page.waitForFunction(() => window.h.outcome);assert.equal(await page.evaluate(() => window.h.invalidations.length), invalidations);assert.deepEqual(await page.evaluate(() => window.h.callbacks), []);assert.equal(await page.evaluate(() => window.h.pages.length), gate === 'before' ? 0 : 1);
});
test('same-SID token refresh retains a legitimate page recovery', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1 && window.h.status === 'pending');await replace({ nonce: 1 });assert.equal(await page.evaluate(() => window.h.status), 'pending');await page.evaluate(() => window.h.replies[0]());coherent(await finish());
});
test('a pending move keeps its optimistic location while old pagination reconciles', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);await page.evaluate(() => { window.h.pending();window.h.replies[0](); });const state = await finish();coherent(state);assert.deepEqual(state.callbacks, []);await page.evaluate(() => window.h.clearPending());
});
test('filter replacement does not refetch or append into the new filtered snapshot', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);await replace({ filter: 'different' });await page.waitForFunction(() => window.h.boards.length === 2);const key = await page.evaluate(() => window.h.currentKey);await page.evaluate(() => window.h.replies[0]());await page.waitForFunction(() => window.h.outcome);assert.equal(await page.evaluate(() => window.h.boards.length), 2);assert(await page.evaluate(key => window.h.invalidations.every(item => JSON.stringify(item.key) !== JSON.stringify(key)), key));coherent(await page.evaluate(() => ({ data: window.h.data })));
});
test('normal close only invalidates its captured snapshot without refetch', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);await page.evaluate(() => window.h.close());await page.getByText('ready', { exact: true }).waitFor({ state: 'detached' });await page.evaluate(() => window.h.replies[0]());await page.waitForFunction(() => window.h.outcome);assert.equal(await page.evaluate(() => window.h.boards.length), 1);assert.deepEqual(await page.evaluate(() => window.h.callbacks), []);assert(await page.evaluate(() => window.h.invalidations.every(item => item.refetchType === 'none')));
});
test('a rejected recovery read remains manually recoverable without an automatic loop', async () => {
  await page.evaluate(() => { window.h.failRecoveryOnce = true;window.h.start(); });const failed = await finish();assert.equal(failed.boards.length, 2);assert.equal(failed.pages.length, 1);assert.equal(failed.data[1].has_more, true);assert.deepEqual(failed.callbacks, []);await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));assert.equal(await page.evaluate(() => window.h.boards.length), 2);
  await page.getByRole('button', { name: 'Carregar mais (1 restantes)', exact: true }).click();const recovered = await finish(2);coherent(recovered);assert.equal(recovered.boards.length, 3);assert.equal(recovered.pages.length, 1);
});
test('a changed page snapshot rejects the old append and reconciles only its exact board', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1);await page.evaluate(() => { const h = window.h;h.nextBoard = h.coherent(h.scope.org);h.nextBoard[1].leads[0].name = 'New snapshot';h.patch(h.nextBoard);h.replies[0](); });const state = await finish();coherent(state);assert.equal(state.data[1].leads[0].name, 'New snapshot');assert.deepEqual(state.callbacks, []);assert.equal(state.invalidations.length, 1);assert.equal(state.invalidations[0].exact, true);
});
test('a retired pending page cannot block or unlock a new session recovery', async () => {
  await page.evaluate(() => { window.h.replyGate = true;window.h.start(); });await page.waitForFunction(() => window.h.replies.length === 1 && window.h.status === 'pending');await replace({ sid: 'sid-b' });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Carregar mais'))?.disabled === false);
  await page.getByRole('button', { name: 'Carregar mais (1 restantes)', exact: true }).click();await page.waitForFunction(() => window.h.replies.length === 2 && window.h.status === 'pending');await page.evaluate(() => window.h.replies[0]());await page.waitForFunction(() => window.h.finishes === 1);assert.equal(await page.getByRole('button', { name: 'Carregar mais (1 restantes)', exact: true }).isDisabled(), true);assert.deepEqual(await page.evaluate(() => window.h.invalidations), []);
  await page.evaluate(() => window.h.replies[1]());const state = await finish(2);coherent(state);assert.equal(state.boards.length, 2);assert.deepEqual(state.pages.map(item => item.expectedSessionId), ['sid-a', 'sid-b']);
});
