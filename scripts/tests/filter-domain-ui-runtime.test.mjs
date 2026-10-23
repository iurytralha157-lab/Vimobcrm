import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let directory;
let browser;
let page;
const browserErrors = [];

// Actual screens, controls and campaign query; only authentication/data transport
// and unrelated editors use inert synthetic fixtures. Every request is blocked.
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Entries from '@/components/features/financial/screens/FinancialEntriesScreen';
import Contracts from '@/components/features/financial/screens/ContractsScreen';
import DRE from '@/components/features/financial/screens/FinancialDREScreen';
import { DREReport } from '@/components/features/financial/DREReport';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { PropertyOwnerCombobox } from '@/components/features/properties/PropertyOwnerCombobox';
import { AutomationMediaGallery } from '@/components/features/automations/AutomationMediaGallery';
import { NodeConfigPanel } from '@/components/features/automations/NodeConfigPanel';
import { MetaCampaignDashboard } from '@/components/features/meta/MetaCampaignDashboard';
import { MarketingScreen } from '@/components/features/marketing/MarketingScreen';
import { useCampaignInsights } from '@/hooks/use-campaign-insights';
import { useMarketingDashboard } from '@/hooks/marketing/use-marketing-dashboard';
import { FixtureContext, dreData } from './synthetic';

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function QueryBridge({filters}) { const query = useCampaignInsights(filters); const model = useMarketingDashboard(filters); window.queryRefetch=query.refetch; window.syncFixture=model.sync; return null; }
function Fixture({name,revision}) {
  window.fixtureName=name;
  const [range,setRange]=useState({from:new Date(2024,0,1),to:new Date(2024,11,31)});
  const [owner,setOwner]=useState(null);
  const [fixtureState,setFixtureState]=useState({});
  window.setDomainFixtureState=patch=>setFixtureState(previous=>({...previous,...patch}));
  window.setFixtureLongPeriod=()=>setRange({from:new Date(2024,0,1),to:new Date(2025,0,1)});
  window.setFixtureValidPeriod=()=>setRange({from:new Date(2024,0,1),to:new Date(2024,11,31)});
  const filters={dateRange:range,datePreset:'custom',teamId:null,pipelineId:null,userId:null,source:null,pageId:null,campaignId:null,campaignIds:[],adSetId:null,adId:null,tagIds:[],dealStatus:null,searchQuery:'',...fixtureState};
  return <FixtureContext.Provider value={filters}><main data-domain-fixture={revision} className="app-shell" style={{padding:12}}>
    {name==='owner'?<div style={{marginTop:188,width:Math.min(300,window.innerWidth-24)}}><PropertyOwnerCombobox value={owner?.id} selectedLabel={owner?.name} onSelect={value=>{setOwner(value);window.selectedOwner=value?.id??null;}}/></div>:name.startsWith('gallery-')?<section style={{width:Math.min(288,window.innerWidth-24)}}><AutomationMediaGallery mediaType={name.slice(8)} onSelect={file=>{window.selectedFile=file.path;}}/></section>:name==='node-gallery'?<NodeConfigPanel selectedNode={{id:'synthetic-node',type:'video',position:{x:0,y:0},data:{}}} position={{x:12,y:12}} onClose={()=>{}} onDeleteNode={()=>{}} onNodeDataChange={(id,data)=>{window.nodeChanges={id,data};}}/>:name==='entries'?<Entries/>:name==='contracts'?<Contracts/>:name==='dre'?<DRE/>:name==='dre-report'?<DREReport data={dreData} showPrevious={false} regime="cash"/>:name==='picker'?<PropertyPickerDialog properties={[]} open onSelect={()=>{}}/>:name==='meta'?<><QueryBridge filters={filters}/><MetaCampaignDashboard filters={filters}/></>:<><QueryBridge filters={filters}/><MarketingScreen activeTab="overview" tabHrefs={{overview:'/marketing',paid:'/marketing/paid',media:'/marketing/media',acquisition:'/marketing/acquisition',social:'/marketing/social'}}/></>}
  </main></FixtureContext.Provider>;
}
const app=createRoot(document.getElementById('app'));
let fixtureRevision=0;
window.showDomainFixture=name=>{const revision=++fixtureRevision;app.render(<QueryClientProvider client={client}><Fixture key={name+':'+revision} name={name} revision={revision}/></QueryClientProvider>);return revision;};
window.showDomainFixture('entries');
`;

const synthetic = `
import React,{createContext,useContext,useMemo} from 'react';
import { createEmptyMarketingCampaignInsights, marketingCampaignInsightsSchema } from '@/lib/validation/marketing';
export const FixtureContext=createContext(null);
const noop=()=>{};
const mutation={isPending:false,mutate:noop,mutateAsync:async()=>({})};
export const dreData={period:{start:'2026-10-01',end:'2026-10-31'},lines:[],totals:{grossRevenue:0,netRevenue:0,grossProfit:0,operatingResult:0,netResult:0}};
export const useAuth=()=>({user:{id:'20000000-0000-4000-8000-000000000001'},activeOrganization:{organizationId:'10000000-0000-4000-8000-000000000001'},tenantContext:{memberRole:'admin'},isSuperAdmin:true});
export const supabase={from:()=>{throw new Error('Database access is forbidden in this fixture')},rpc:()=>{throw new Error('Database access is forbidden in this fixture')}};
export const createClient=()=>supabase;
export const useUserPermissions=()=>({hasPermission:()=>true,isLoading:false});
export const useOrganizationModules=()=>({hasModule:()=>true});
export const useFinancialEntries=()=>({data:[],isLoading:false,refetch:noop});
export const useMarkEntryAsPaid=()=>mutation; export const useDeleteFinancialEntry=()=>mutation;
export const useContracts=()=>({data:[],isLoading:false,refetch:noop});
export const useActivateContract=()=>mutation; export const useDeleteContract=()=>mutation; export const useRegenerateCommissions=()=>mutation;
export const useDRE=()=>({data:dreData,isLoading:false,refetch:noop});
export const useDREGroups=()=>({data:[],isLoading:false,refetch:noop});
export const useInitializeDREGroups=()=>({initializeGroups:async()=>{}});
export const useProperty=()=>({data:null});
export const useInfiniteProperties=()=>({data:{pages:[{properties:[],totalCount:0}]},isLoading:false,isFetching:false,isError:false,hasNextPage:false});
export const usePropertyTypes=()=>({data:['Casa','Apartamento']});
export const usePropertyCities=()=>({data:[{id:'30000000-0000-4000-8000-000000000001',name:'São Paulo',uf:'SP'}]});
export const usePropertyNeighborhoods=()=>({data:[]});
const owners=Array.from({length:51},(_,index)=>({id:'synthetic-owner-'+index,name:index===0?'Proprietário sintético com nome muito longo para verificar rótulos truncados em todas as larguras da auditoria':'Proprietário sintético '+index,email:'owner'+index+'@example.invalid',cellphone:null}));
export const PROPERTY_OWNER_PAGE_SIZE=50;
window.ownerNextPageCalls=0;window.galleryNextPageCalls=0;
export const usePropertyOwnersPage=search=>{const state=useContext(FixtureContext);window.lastOwnerSearch=search;const data=useMemo(()=>({pages:[{owners:state.ownerLoading||state.ownerError?[]:owners.slice(0,state.ownerPage===2?51:50).filter(owner=>owner.name.toLowerCase().includes(search.toLowerCase()))}]}),[search,state.ownerLoading,state.ownerError,state.ownerPage]);return {data,isLoading:!!state.ownerLoading,isFetching:!!state.ownerLoading,isError:!!state.ownerError,hasNextPage:!search&&!state.ownerLoading&&!state.ownerError&&state.ownerPage!==2,isFetchingNextPage:false,fetchNextPage:()=>{window.ownerNextPageCalls++;window.setDomainFixtureState({ownerPage:2});},refetch:()=>window.setDomainFixtureState({ownerError:false})};};
export const useAutomationMedia=(mediaType,search)=>{const state=useContext(FixtureContext);window.lastGallerySearch=search;const extension={audio:'mp3',video:'mp4',image:'png'}[mediaType];const data=useMemo(()=>state.galleryLoading||state.galleryError?[]:Array.from({length:state.galleryPage===2?51:50},(_,index)=>({name:'Arquivo sintético '+index+'.'+extension,path:'synthetic/'+index,bucket:'synthetic',publicUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',contentType:null,size:1024,metadata:{},createdAt:null,updatedAt:null})).filter(file=>file.name.toLowerCase().includes(search.toLowerCase())),[extension,search,state.galleryLoading,state.galleryError,state.galleryPage]);return {data,isLoading:!!state.galleryLoading,error:state.galleryError?Error('Synthetic gallery error'):null,hasNextPage:!search&&!state.galleryLoading&&!state.galleryError&&state.galleryPage!==2,isFetchingNextPage:false,fetchNextPage:()=>{window.galleryNextPageCalls++;window.setDomainFixtureState({galleryPage:2});},refetch:()=>window.setDomainFixtureState({galleryError:false})};};
export const automationsAPI={uploadMedia:()=>{throw Error('Transport forbidden');},deleteMedia:()=>{throw Error('Transport forbidden');}};
export class VimobAPIError extends Error {};
export const useCreateTag=()=>mutation; export const useAllMetaFormConfigs=()=>({data:[],isLoading:false});export const useLeads=()=>({data:[],isLoading:false});export const useStages=()=>({data:[]});
export const getPropertySiteInfo=async()=>null;
export const AppLayout=({children})=><>{children}</>;
export const FinancialEntryForm=()=>null; export const ContractForm=()=>null; export const FinancialDrawer=()=>null; export const FinancialConfirmationDialog=()=>null; export const DREAccountConfig=()=>null;
export const SharedFilters=()=>null;
export const useSharedFilters=()=>{const filters=useContext(FixtureContext);return {filters,datePreset:'custom',dateRange:filters.dateRange,campaignIds:[],campaigns:[],pages:[],adSets:[],ads:[],tags:[],dynamicSources:[],isFiltersHydrated:true,clearFilters:noop,setCampaignId:noop,setPageId:noop,setAdSetId:noop,setAdId:noop};};
export const useMetaIntegrations=()=>({data:[],isLoading:false});
window.campaignQueryCalls=0; window.marketingSyncCalls=0;
export const analyticsAPI={campaignInsights:async()=>{window.campaignQueryCalls++;const empty=createEmptyMarketingCampaignInsights();return marketingCampaignInsightsSchema.parse({...empty,lastSync:'2026-10-01T12:00:00Z',summary:{...empty.summary,totalLeads:42},campaigns:[{campaign_id:'fixture-campaign',campaign_name:'Campanha sintética',leads_count:42,conversations_count:0,won_count:0,revenue:0,spend:null,impressions:null,reach:null,cpl:null,ctr:null,hook_rate:null,status:null,budget:null,budget_type:null,objective:null,adsets:[]}]});}};
export const integrationsAPI={syncMetaMarketing:async()=>{window.marketingSyncCalls++;return {success:true,synced:0}}};
export const useRouter=()=>({push:noop,replace:noop}); export const usePathname=()=>'/marketing'; export const useSearchParams=()=>new URLSearchParams();
export default function Link({children,href,src,fill,unoptimized,sizes,...props}) {return src?<img src={src} {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:undefined}/>:<a href={href} {...props}>{children}</a>}
`;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'vimob-filter-domains-'));
  const entry = path.join(directory, 'fixture.tsx');
  const dataHooks = path.join(directory, 'synthetic.tsx');
  const loader = path.join(directory, 'typescript-loader.cjs');
  const cssLoader = path.join(directory, 'css-module-loader.cjs');
  await writeFile(entry, fixture);
  await writeFile(dataHooks, synthetic);
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root, 'node_modules/typescript'))});module.exports=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;`);
  // Compile local/global selectors with the same CSS Modules plugins bundled
  // by Next. Inject their real CSS and export the generated class-name map.
  await writeFile(cssLoader, `
    const postcss=require(${JSON.stringify(require.resolve('postcss'))});
    const values=require(${JSON.stringify(require.resolve('next/dist/compiled/postcss-modules-values'))});
    const local=require(${JSON.stringify(require.resolve('next/dist/compiled/postcss-modules-local-by-default'))});
    const imports=require(${JSON.stringify(require.resolve('next/dist/compiled/postcss-modules-extract-imports'))});
    const scope=require(${JSON.stringify(require.resolve('next/dist/compiled/postcss-modules-scope'))});
    const {createHash}=require('node:crypto');
    module.exports=function(source){
      const done=this.async(),prefix='filterDomain_'+createHash('sha256').update(this.resourcePath).digest('hex').slice(0,10)+'_';
      postcss([values,local({mode:'local'}),imports(),scope({generateScopedName:name=>prefix+name})]).process(source,{from:this.resourcePath,map:false}).then(result=>{
        const names={};result.root.walkRules(':export',rule=>{rule.walkDecls(decl=>{names[decl.prop]=decl.value;});rule.remove();});
        done(null,'const style=document.createElement("style");style.textContent='+JSON.stringify(result.root.toString())+';document.head.append(style);export default '+JSON.stringify(names)+';');
      },done);
    };
  `);
  const names = ['contexts/AuthContext','lib/supabase/client','integrations/supabase/client','hooks/use-user-permissions','hooks/use-organization-modules','hooks/use-financial','hooks/use-contracts','hooks/use-dre','hooks/use-properties','hooks/use-property-types','hooks/use-property-locations','hooks/use-property-owners','hooks/use-automations','hooks/use-tags','hooks/use-meta-forms','hooks/use-leads','hooks/use-stages','hooks/use-shared-filters','hooks/use-meta-integration','lib/api/property-support','lib/api/analytics','lib/api/integrations','lib/api/automations','lib/api/vimob-client','components/shared/layout/AppLayout','components/shared/SharedFilters','components/features/financial/FinancialEntryForm','components/features/financial/ContractForm','components/features/financial/FinancialDrawer','components/features/financial/FinancialConfirmationDialog','components/features/financial/DREAccountConfig'];
  const alias = Object.fromEntries(names.map(name => [`@/${name}$`,dataHooks]));
  const { webpack } = require('next/dist/compiled/webpack/webpack');
  await new Promise((resolve,reject) => {
    const compiler=webpack({mode:'development',target:'web',devtool:false,entry,output:{path:directory,filename:'fixture.js'},plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development'})})],resolve:{extensions:['.tsx','.ts','.js'],alias:{...alias,'@':root,'next/link$':dataHooks,'next/image$':dataHooks,'next/navigation$':dataHooks},modules:[path.join(root,'node_modules'),'node_modules']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader},{test:/\.module\.css$/,use:cssLoader}]},optimization:{minimize:false}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const productCss=(await readFile(path.join(root,'app/globals.css'),'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const sources=['components/ui','config/filter-ui.ts','components/features/financial','components/features/properties/PropertyPickerDialog.tsx','components/features/properties/PropertyOwnerCombobox.tsx','components/features/automations/AutomationMediaGallery.tsx','components/features/automations/NodeConfigPanel.tsx','components/shared/filters/MarketingPeriodNotice.tsx'];
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(`${productCss}\n${sources.map(source=>`@source "${path.join(root,source).replaceAll('\\','/')}";`).join('\n')}`,{from:path.join(root,'app/filter-domain-fixture.css')});
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:1024,height:768},timezoneId:'America/Sao_Paulo'});
  page.on('pageerror',error=>browserErrors.push(error.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent(`<style>${css.css}</style><div id="app"></div>`);
  await page.addScriptTag({content:await readFile(path.join(directory,'fixture.js'),'utf8')});
  try {
    await page.getByRole('textbox',{name:'Buscar lançamentos por descrição ou categoria'}).waitFor({timeout:5000});
  } catch(error) {
    throw new Error(`${error.message}\nBrowser errors: ${browserErrors.join('; ')}\nRendered text: ${await page.locator('body').innerText()}`);
  }
});

after(async () => {
  await browser?.close();
  if(directory) {
    const resolved=path.resolve(directory);
    assert.equal(path.dirname(resolved),path.resolve(tmpdir()));
    assert.match(path.basename(resolved),/^vimob-filter-domains-/);
    await rm(resolved,{recursive:true,force:true});
  }
});

async function show(name,width=1024,height=768) {
  await page.keyboard.press('Escape');
  await page.setViewportSize({width,height});
  const revision=await page.evaluate(name=>window.showDomainFixture(name),name);
  await expect(page.locator(`[data-domain-fixture="${revision}"]`)).toBeAttached();
}

test('financial type and status controls have distinct accessible names on desktop and mobile',async()=>{
  for(const width of [1024,320]) {
    for(const [name,type,status] of [['entries','Tipo de lançamento','Status do lançamento'],['contracts','Tipo de contrato','Status do contrato']]) {
      await show(name,width);
      if(width===320) await page.getByRole('button',{name:/^Filtros/}).click();
      const selector=page.getByRole('combobox',{name:type});
      await expect(selector).toBeVisible();
      await expect(page.getByRole('combobox',{name:status})).toBeVisible();
      await selector.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(selector).toBeFocused();
    }
  }
});

test('DRE labels identify their selectors and civil date headers preserve the selected days',async()=>{
  await show('dre');
  for(const label of ['Período','Mês','Regime']) await expect(page.getByLabel(label,{exact:true})).toBeVisible();
  await show('dre-report');
  await expect(page.getByText('DRE - 01/10/2026 a 31/10/2026',{exact:true})).toBeVisible();
  assert.deepEqual(browserErrors,[]);
});

test('property filters retain their count when hidden and clearing fields removes the indication',async()=>{
  await show('picker',320);
  await page.getByRole('button',{name:'Filtros de imóveis',exact:true}).click();
  await page.getByLabel('Tipo de imóvel',{exact:true}).selectOption('Casa');
  await page.getByLabel('Finalidade do imóvel',{exact:true}).selectOption('Venda');
  await page.getByRole('button',{name:'Filtros de imóveis, 2 ativos',exact:true}).click();
  const button=page.getByRole('button',{name:'Filtros de imóveis, 2 ativos',exact:true});
  await expect(button).toHaveAttribute('aria-expanded','false');
  await expect(button.getByText('2',{exact:true})).toBeVisible();
  await button.click();
  await page.getByLabel('Tipo de imóvel',{exact:true}).selectOption('');
  await page.getByLabel('Finalidade do imóvel',{exact:true}).selectOption('');
  await expect(page.getByRole('button',{name:'Filtros de imóveis',exact:true})).toBeVisible();
});

test('Marketing and Meta explain invalid periods before transport, including manual refetch and sync',async()=>{
  for(const name of ['meta','marketing']) {
    await show(name);
    await page.waitForFunction(()=>window.queryRefetch && window.campaignQueryCalls>0);
    await expect(page.getByText('Campanha sintética',{exact:true}).first()).toBeVisible();
    const before=await page.evaluate(()=>window.campaignQueryCalls);
    await page.evaluate(()=>window.setFixtureLongPeriod());
    await expect(page.getByRole('alert')).toContainText('366 dias');
    await expect(page.getByText('Campanha sintética',{exact:true})).toHaveCount(0);
    await page.evaluate(async()=>{await window.queryRefetch();window.syncFixture();});
    assert.equal(await page.evaluate(()=>window.campaignQueryCalls),before);
    assert.equal(await page.evaluate(()=>window.marketingSyncCalls),0);
    await page.evaluate(()=>window.setFixtureValidPeriod());
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('Campanha sintética',{exact:true}).first()).toBeVisible();
  }
  assert.deepEqual(browserErrors,[]);
});

async function scrollLastGalleryFile(extension,index=49) {
  const file=page.getByRole('button',{name:`Selecionar Arquivo sintético ${index}.${extension}`,exact:true});
  await expect(file).toHaveCount(1);
  const viewport=page.locator('[data-radix-scroll-area-viewport]').last();
  await viewport.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const bounds=await file.evaluate(element=>{
    const file=element.getBoundingClientRect();
    const viewport=element.closest('[data-radix-scroll-area-viewport]');
    const area=viewport.parentElement.getBoundingClientRect();
    const target=document.elementFromPoint(file.x+file.width/2,file.y+file.height/2);
    return {areaTop:area.top,areaBottom:area.bottom,fileTop:file.top,fileBottom:file.bottom,scrollTop:viewport.scrollTop,scrollHeight:viewport.scrollHeight,areaHeight:area.height,viewportHeight:viewport.getBoundingClientRect().height,insideArea:file.top>=area.top-1&&file.bottom<=area.bottom+1,hit:element.contains(target)};
  });
  assert.ok(Math.abs(bounds.areaHeight-bounds.viewportHeight)<=1,JSON.stringify(bounds));
  assert.ok(bounds.insideArea&&bounds.hit,JSON.stringify(bounds));
  return file;
}

test('owner popup stays within short viewports and its last option, pagination, clear and focus remain usable',async()=>{
  for(const width of [320,390,768]) {
    await show('owner',width,480);
    const trigger=page.getByRole('combobox',{name:'Proprietário cadastrado',exact:true});
    await trigger.click();
    const search=page.getByRole('combobox',{name:'Buscar proprietário',exact:true});
    await expect(search).toBeFocused();
    const popup=page.locator('.vimob-popover-content');
    const bounds=await popup.evaluate(element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:innerHeight,width:innerWidth};});
    assert.ok(bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.left>=0&&bounds.right<=bounds.width,JSON.stringify(bounds));
    await expect(page.getByRole('option',{name:'Todos',exact:true})).toBeVisible();
    await expect(page.locator('[data-value="synthetic-owner-0"] span.block').first()).toHaveAttribute('title',/Proprietário sintético com nome muito longo/);
    await expect(page.locator('[data-value="synthetic-owner-0"] span.block').last()).toHaveAttribute('title','owner0@example.invalid');
    await page.locator('[cmdk-list]').evaluate(element=>{element.scrollTop=element.scrollHeight;});
    const more=page.getByRole('button',{name:'Carregar mais proprietários',exact:true});
    await more.click();
    await expect(more).toHaveCount(0);
    await page.locator('[cmdk-list]').evaluate(element=>{element.scrollTop=element.scrollHeight;});
    const last=page.locator('[data-value="synthetic-owner-50"]');
    assert.ok(await last.evaluate(element=>{const r=element.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
    await last.click();
    assert.equal(await page.evaluate(()=>window.selectedOwner),'synthetic-owner-50');
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('option',{name:'Todos',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.selectedOwner),null);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.evaluate(()=>window.setDomainFixtureState({ownerLoading:true}));
    await expect(page.getByRole('status')).toContainText('Buscando proprietários');
    await expect(page.getByRole('option',{name:'Todos',exact:true})).toBeVisible();
    await expect(search).toBeFocused();
    await page.evaluate(()=>window.setDomainFixtureState({ownerLoading:false,ownerError:true}));
    await expect(page.getByRole('status')).toContainText('Não foi possível buscar proprietários');
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
    await expect(page.locator('[data-value="synthetic-owner-0"]')).toBeVisible();
    await search.fill('Nenhum proprietário sintético corresponde');
    await page.waitForFunction(()=>window.lastOwnerSearch==='Nenhum proprietário sintético corresponde');
    await expect(page.getByText('Nenhum proprietário encontrado.',{exact:true})).toBeVisible();
    await expect(page.getByRole('option',{name:'Todos',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  assert.deepEqual(browserErrors,[]);
});

test('gallery can scroll to and select its last audio, video and image on short viewports',async()=>{
  for(const width of [320,390,768]) {
    for(const [type,extension] of [['audio','mp3'],['video','mp4'],['image','png']]) {
      await show(`gallery-${type}`,width,480);
      const last=await scrollLastGalleryFile(extension);
      await last.click();
      assert.equal(await page.evaluate(()=>window.selectedFile),'synthetic/49');
      await page.getByRole('button',{name:'Carregar mais arquivos',exact:true}).click();
      await expect(page.getByRole('button',{name:'Carregar mais arquivos',exact:true})).toHaveCount(0);
      await (await scrollLastGalleryFile(extension,50)).click();
      assert.equal(await page.evaluate(()=>window.selectedFile),'synthetic/50');
    }
  }
  assert.deepEqual(browserErrors,[]);
});

test('gallery preserves debounced search, empty, loading and retry states before pagination',async()=>{
  await show('gallery-audio',320,480);
  const search=page.getByRole('textbox',{name:'Buscar arquivo na galeria',exact:true});
  await search.fill('Arquivo inexistente');
  assert.equal(await page.evaluate(()=>window.lastGallerySearch),'');
  await page.waitForFunction(()=>window.lastGallerySearch==='Arquivo inexistente');
  await expect(page.getByText('Nenhum arquivo corresponde à busca',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Carregar mais arquivos',exact:true})).toHaveCount(0);
  await search.fill('49.mp3');
  await page.waitForFunction(()=>window.lastGallerySearch==='49.mp3');
  await page.getByRole('button',{name:'Selecionar Arquivo sintético 49.mp3',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.selectedFile),'synthetic/49');
  await page.evaluate(()=>window.setDomainFixtureState({galleryLoading:true}));
  await expect(page.getByRole('status')).toContainText('Carregando galeria');
  await expect(search).toHaveValue('49.mp3');
  await expect(page.getByRole('button',{name:'Carregar mais arquivos',exact:true})).toHaveCount(0);
  await page.evaluate(()=>window.setDomainFixtureState({galleryLoading:false,galleryError:true}));
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar a galeria');
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await expect(page.getByRole('button',{name:'Selecionar Arquivo sintético 49.mp3',exact:true})).toBeVisible();
  assert.deepEqual(browserErrors,[]);
});

test('gallery retains last-file selection when composed in the actual NodeConfigPanel',async()=>{
  for(const width of [320,390,768]) {
    await show('node-gallery',width,480);
    await (await scrollLastGalleryFile('mp4')).click();
    assert.deepEqual(await page.evaluate(()=>window.nodeChanges),{id:'synthetic-node',data:{media_path:'synthetic/49',media_bucket:'synthetic',video_preview_url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}});
  }
  assert.deepEqual(browserErrors,[]);
});
