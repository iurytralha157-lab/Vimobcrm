import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = resolve(process.env.DASHBOARD_CACHE_TEST_DIR || tmpdir());
let directory, bundle, browser;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  directory = await mkdtemp(join(artifacts, 'vimob-dashboard-cache-'));
  const mocks = join(directory, 'mocks.ts');
  await writeFile(mocks, `
    export const useAuth = () => ({ user: {id:window.h.actor}, session: {}, activeOrganization:{organizationId:window.h.org},
      tenantContext: window.h.ready ? {organizationId:window.h.org, memberRole:'admin', permissions:['*'],enabledModules:['crm'],isSuperAdmin:false}:null,isSuperAdmin:false });
    export const useFilters = () => ({isHydrated:true,datePreset:null,customDateRange:null,activeDateRange:null,pipelineId:null,teamId:'team-a',userId:null,source:null,pageId:null,campaignId:'campaign-a',campaignIds:['campaign-a'],adSetId:null,adId:null,tagIds:['tag-a'],dealStatus:null,searchQuery:''});
    export const useUserPermissions = () => ({hasPermission:()=>true,isLoading:false});
    export const getGlobalSignOutSessionId = () => window.h.actor + '-session';
    export const getLeadMetaFilters = p => window.h.api('shared-filter-lead-meta-filters',p.organizationId);
    export const teamsAPI = {catalog:org=>window.h.api('teams',org)};
    export const tagsAPI = {catalog:org=>window.h.api('tags',org)};
    export const usersAPI = {listUsers:org=>window.h.api('organization-users',org)};
    export const performanceTracker = {trackTimed:(_name,run)=>run()};
    export const getDashboardFiltersQueryKey = f => JSON.stringify(f ?? {});
    export const getDashboardOptionalIdQueryKey = x => x ?? null;
    export const getDashboardStats = p => window.h.api('enhanced-dashboard-stats',p.organizationId);
    export const getDashboardCampaigns = p => window.h.api('dashboard-campaigns',p.organizationId);
    export const getDashboardCreatives = p => window.h.api('dashboard-creatives',p.organizationId);
    export const getDashboardCreativeMedia = p => window.h.api('dashboard-creative-media',p.organizationId);
    export const getDashboardLeadEntries = p => window.h.api('dashboard-lead-entries',p.organizationId);
    export const getDashboardFirstContactLeadPage = p => window.h.api('dashboard-first-contact-leads',p.organizationId);
    export const getDashboardDealsEvolution = ()=>[];
    export const getDashboardFunnel = ()=>[];
    export const getDashboardLeadDistribution = ()=>({});
    export const getDashboardFirstContact = ()=>({});
    export const getDashboardSources = ()=>[];
    export const getDashboardTopBrokers = ()=>({});
    export const getDashboardUpcomingTasks = ()=>[];
    export const toast = {};
    export const assertManagementRequestIntent = ()=>{};
    export const captureManagementRequestIntent = ()=>({});
    export const cacheTeamEditorSnapshot = ()=>{};
    export const loadConsistentTeamEditorSnapshot = ()=>{};
    export const observeTeamCache = ()=>{};
    export const invalidateTagConsumers = ()=>{};
    export const isCurrentManagementMutation = ()=>false;
  `);
  const entry = join(directory, 'entry.tsx');
  await writeFile(entry, `
    import React,{act} from 'react'; import {createRoot} from 'react-dom/client';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {useSharedFilters} from '@/hooks/use-shared-filters';
    import {useTeams} from '@/hooks/use-teams'; import {useOrganizationUsers} from '@/hooks/use-users';
    import {useDashboardQueryScope,useEnhancedDashboardStats,useDashboardFirstContactLeads} from '@/hooks/use-dashboard-stats';
    import {useDashboardCampaigns} from '@/hooks/use-dashboard-campaigns';
    import {useDashboardCreatives} from '@/hooks/use-dashboard-creatives';
    import {useDashboardCreativeMedia} from '@/hooks/use-dashboard-creative-media';
    import {useDashboardLeadEntries} from '@/hooks/use-dashboard-lead-entries';
    window.IS_REACT_ACT_ENVIRONMENT=true;
    const h=window.h={org:'org-a',actor:'actor-a',ready:true,mounted:true,optIn:true,mediaVersion:'version-a',status:{},calls:{},result:{}};
    const makeClient=()=>new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity,refetchOnMount:false,refetchOnWindowFocus:false}}});
    h.client=makeClient();
    h.payload=(prefix,org)=>{
      if(prefix==='teams')return[{id:'team-a',name:'Team '+org,members:[{user_id:'user-a'}]}];
      if(prefix==='tags')return[{id:'tag-a',name:'Tag '+org,color:'#fff'}];
      if(prefix==='organization-users')return[{id:'user-a',full_name:'User '+org}];
      if(prefix==='shared-filter-lead-meta-filters')return{sources:['Source '+org],pages:[],campaigns:[{id:'campaign-a',name:'Campaign '+org}],adsets:[],ads:[]};
      if(prefix==='enhanced-dashboard-stats')return{totalLeads:44,organization:org};
      if(prefix==='dashboard-campaigns')return{campaigns:[{id:'campaign-a',name:'Campaign '+org}],unattributed:{leadCount:0}};
      if(prefix==='dashboard-creatives')return{creatives:[{key:'creative-a',name:'Creative '+org}]};
      if(prefix==='dashboard-creative-media')return{imageUrl:'https://synthetic.invalid/'+org+'.png'};
      return{items:[{id:'lead-a',name:'Lead '+org}],total:1,hasMore:false};
    };
    h.api=async(prefix,org)=>{const key=prefix+'|'+org;h.calls[key]=(h.calls[key]??0)+1;const status=h.status[key];
      if(status)throw Object.assign(new Error('synthetic failure'),{status,code:status===403?'permission_denied':status===401?'missing_session':'api_unavailable'});
      return h.payload(prefix,org);};
    const view=q=>({data:q.data??null,blocked:q.isAccessBlocked??false,error:q.isError,status:q.status});
    function Screen(){const scope=useDashboardQueryScope();const policy=h.optIn?scope:undefined;
      const filters=useSharedFilters({cacheTrustScope:policy,loadDynamicOptions:true,entryMode:true,multiCampaigns:true});
      const teams=useTeams({catalog:true,cacheTrustScope:policy});const users=useOrganizationUsers({scope:'filters',cacheTrustScope:policy});
      const stats=useEnhancedDashboardStats({});const campaigns=useDashboardCampaigns({});const creatives=useDashboardCreatives({});
      const entries=useDashboardLeadEntries({},true);const first=useDashboardFirstContactLeads({},'user-a');
      const media=useDashboardCreativeMedia({},'creative-a',h.mediaVersion);
      h.result={campaignsOptions:filters.campaigns,tags:filters.tags,teamUsers:filters.selectedTeamUserIds??null,teamScope:filters.isTeamScopeReady,
        teamId:filters.filters.teamId,filtersError:filters.hasDynamicOptionsError,teams:(policy?teams.displayData:teams.data)??[],users:(policy?users.displayData:users.data)??[],
        stats:view(stats),campaigns:view(campaigns),creatives:view(creatives),entries:view(entries),first:view(first),media:view(media)};
      return React.createElement('output',null,JSON.stringify(h.result));
    }
    const root=createRoot(document.getElementById('root'));
    const tick=()=>new Promise(r=>setTimeout(r,0));
    h.render=async(patch={})=>{Object.assign(h,patch);await act(async()=>{root.render(React.createElement(QueryClientProvider,{client:h.client},h.mounted?React.createElement(Screen):null));await tick();});};
    h.find=prefix=>h.client.getQueryCache().getAll().find(q=>q.queryKey[0]===prefix&&q.queryKey[1]===h.org&&q.getObserversCount()>0);
    h.fetch=async(prefix,status=0)=>{h.status[prefix+'|'+h.org]=status;const q=h.find(prefix);try{await h.client.fetchQuery({...q.options,staleTime:0,retry:false});}catch(e){if(e.status!==status)throw e;}};
    h.sequence=async(prefix,statuses)=>{await act(async()=>{for(const status of statuses)await h.fetch(prefix,status);await tick();});};
    h.manual=async prefix=>{await act(async()=>{const q=h.find(prefix);h.client.setQueryData(q.queryKey,q.state.data??h.payload(prefix,h.org));await tick();});};
    h.remount=async()=>{await h.render({mounted:false});await h.render({mounted:true});};
    h.replaceClient=async()=>{await h.render({mounted:false});h.client.clear();h.client=makeClient();await h.render({mounted:true});};
    h.readyPromise=h.render();
  `);
  const loader = join(directory, 'loader.cjs');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const mocked = ['@/contexts/AuthContext','@/contexts/FilterContext','@/hooks/use-user-permissions','@/lib/auth/global-sign-out','@/lib/api/pipeline-board','@/lib/api/teams','@/lib/api/tags','@/lib/api/users','@/lib/api/dashboard','@/lib/api/dashboard-lead-entries','@/lib/performance','@/lib/api/management-request','@/lib/teams/team-editor-snapshot','@/lib/tags/management','sonner'];
  await new Promise((done,reject)=>{const compiler=webpack({mode:'development',target:'web',entry,output:{path:directory,filename:'cache.js'},
    resolve:{extensions:['.tsx','.ts','.js'],modules:[join(repository,'node_modules')],alias:{...Object.fromEntries(mocked.map(name=>[name+'$',mocks])),'@':repository}},
    module:{rules:[{test:/\.tsx?$/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error?reject(error):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true}))):done()));});
  bundle=await readFile(join(directory,'cache.js'),'utf8');browser=await chromium.launch({headless:true});
}, { timeout: 120_000 });

after(async()=>{await browser?.close();if(directory){const rel=relative(artifacts,directory);assert.ok(rel&&!rel.startsWith('..'));await rm(directory,{recursive:true,force:true});}});

async function withPage(run){const context=await browser.newContext();const page=await context.newPage();const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  try{await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle});await page.evaluate(()=>window.h.readyPromise);await page.waitForFunction(()=>window.h.result.stats.data?.totalLeads===44);
    await run(page);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await context.close();}}
const state=page=>page.evaluate(()=>window.h.result);
const sequence=(page,prefix,statuses)=>page.evaluate(([p,s])=>window.h.sequence(p,s),[prefix,statuses]);

for(const denied of [401,403])test(`actual mounted hooks keep all seven consumers hidden after ${denied} then 503`,async()=>{
 await withPage(async page=>{
  for(const prefix of ['shared-filter-lead-meta-filters','tags','teams','organization-users','enhanced-dashboard-stats','dashboard-campaigns','dashboard-creatives'])await sequence(page,prefix,[denied,503]);
  const result=await state(page);for(const key of ['campaignsOptions','tags','teams','users'])assert.deepEqual(result[key],[]);assert.equal(result.teamUsers,null);assert.equal(result.teamId,'team-a');
  for(const key of ['stats','campaigns','creatives']){assert.equal(result[key].data,null);assert.equal(result[key].blocked,true);}assert.equal(result.filtersError,true);
  for(const prefix of ['shared-filter-lead-meta-filters','tags','teams','organization-users','enhanced-dashboard-stats','dashboard-campaigns','dashboard-creatives'])await sequence(page,prefix,[0]);
  assert.equal((await state(page)).stats.data.totalLeads,44);assert.equal((await state(page)).campaignsOptions[0].name,'Campaign org-a');
 });
});

test('ordinary 503 preserves an authorized mounted result and names',async()=>{await withPage(async page=>{
 for(const prefix of ['enhanced-dashboard-stats','shared-filter-lead-meta-filters','tags','teams','organization-users'])await sequence(page,prefix,[503]);
 const result=await state(page);assert.equal(result.stats.data.totalLeads,44);assert.equal(result.stats.blocked,false);assert.equal(result.campaignsOptions[0].name,'Campaign org-a');assert.equal(result.users[0].full_name,'User org-a');
});});

test('remount and manual cache write do not restore a denied tracked summary',async()=>{await withPage(async page=>{
 await sequence(page,'enhanced-dashboard-stats',[403,503]);await page.evaluate(()=>window.h.manual('enhanced-dashboard-stats'));
 assert.equal((await state(page)).stats.status,'success');assert.equal((await state(page)).stats.blocked,true);
 await page.evaluate(()=>window.h.remount());assert.equal((await state(page)).stats.blocked,true);assert.equal((await state(page)).stats.data,null);
 await sequence(page,'enhanced-dashboard-stats',[0]);assert.equal((await state(page)).stats.blocked,false);
});});

test('two organizations and actors keep responses and denial separate on mounted hooks',async()=>{await withPage(async page=>{
 await sequence(page,'enhanced-dashboard-stats',[403,503]);await page.evaluate(()=>window.h.render({org:'org-b',actor:'actor-b'}));
 await page.waitForFunction(()=>window.h.result.stats.data?.organization==='org-b');assert.equal((await state(page)).users[0].full_name,'User org-b');
 await page.evaluate(()=>window.h.render({org:'org-a',actor:'actor-a'}));assert.equal((await state(page)).stats.blocked,true);
 await page.evaluate(()=>window.h.replaceClient());await sequence(page,'enhanced-dashboard-stats',[0]);assert.equal((await state(page)).stats.data.organization,'org-a');
});});

test('an unready Dashboard scope hides catalog data without clearing selection',async()=>{await withPage(async page=>{
 await page.evaluate(()=>window.h.render({ready:false}));const result=await state(page);assert.deepEqual(result.teams,[]);assert.deepEqual(result.users,[]);assert.equal(result.teamId,'team-a');assert.equal(result.stats.blocked,true);
});});

test('the shared hook without opt-in retains the other domains policy',async()=>{await withPage(async page=>{
 await page.evaluate(()=>window.h.render({optIn:false}));await sequence(page,'shared-filter-lead-meta-filters',[403,503]);await sequence(page,'tags',[403,503]);
 assert.equal((await state(page)).campaignsOptions[0].name,'Campaign org-a');assert.equal((await state(page)).tags[0].name,'Tag org-a');
});});

test('infinite details and media propagate blocked state independently of raw status',async()=>{await withPage(async page=>{
 for(const prefix of ['dashboard-lead-entries','dashboard-first-contact-leads','dashboard-creative-media']){await sequence(page,prefix,[0,403,503]);await page.evaluate(p=>window.h.manual(p),prefix);}
 const result=await state(page);for(const key of ['entries','first','media']){assert.equal(result[key].blocked,true);assert.equal(result[key].data,null);assert.equal(result[key].error,false);}
});});

test('first media failure preserves the transient-error fallback policy',async()=>{await withPage(async page=>{
 await page.evaluate(async()=>{window.h.status['dashboard-creative-media|org-a']=503;await window.h.render({mediaVersion:'first-transient'});});
 await sequence(page,'dashboard-creative-media',[503]);
 await page.waitForFunction(()=>window.h.result.media.error);
 const result=await state(page);assert.equal(result.media.data,null);assert.equal(result.media.error,true);assert.equal(result.media.blocked,false);
 await sequence(page,'dashboard-creative-media',[0]);assert.equal((await state(page)).media.blocked,false);assert.equal((await state(page)).media.data.imageUrl,'https://synthetic.invalid/org-a.png');
});});
