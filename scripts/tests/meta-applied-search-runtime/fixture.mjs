export const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {FilterProvider,useFilters} from '@/contexts/FilterContext';
import {FilterPanelLayoutProvider} from '@/contexts/FilterPanelLayoutContext';
import {MetaCampaignsDashboardScreen} from '@/components/features/meta/MetaCampaignsDashboardScreen';
import {MetaCampaignsDashboardScreen as BaselineMetaScreen} from 'meta-screen-baseline';
import {MarketingScreen} from '@/components/features/marketing/MarketingScreen';
import {SharedFilters} from '@/components/shared/SharedFilters';
import {useSharedFilters} from '@/hooks/use-shared-filters';
import {useCampaignInsights} from '@/hooks/use-campaign-insights';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
function GeneralFilters(){const f=useSharedFilters();return <SharedFilters {...f}
  onDatePresetChange={f.setDatePreset} onCustomDateRangeChange={f.setCustomDateRange}
  onPipelineChange={f.setPipelineId} onTeamChange={f.setTeamId} onUserChange={f.setUserId}
  onSourceChange={f.setSource} onPageChange={f.setPageId} onCampaignChange={f.setCampaignId}
  onAdSetChange={f.setAdSetId} onAdChange={f.setAdId} onTagsChange={f.setTagIds}
  onDealStatusChange={f.setDealStatus} onSearchChange={f.setSearchQuery} onClear={f.clearFilters}/>;}
function Content(){const f=useFilters(),[view,setView]=useState('meta');window.searchFixtureFilters=f;window.searchFixtureSetView=setView;
  return <main data-search-fixture-view={view}>
    {view==='meta'?<MetaCampaignsDashboardScreen/>:view==='baseline'?<BaselineMetaScreen/>:view==='general'?<GeneralFilters/>:
      <MarketingScreen activeTab={view} tabHrefs={{overview:'/marketing',paid:'/marketing/paid',media:'/marketing/media',acquisition:'/marketing/acquisition',social:'/marketing/social'}}/>}
  </main>;
}
createRoot(document.getElementById('app')).render(<QueryClientProvider client={client}><FilterPanelLayoutProvider scopeKey='synthetic-meta'><FilterProvider><Content/></FilterProvider></FilterPanelLayoutProvider></QueryClientProvider>);
`;

export const synthetic = `
import React from 'react';
import {useCampaignInsights} from '@/hooks/use-campaign-insights';
import {createEmptyMarketingCampaignInsights} from '@/lib/validation/marketing';
const noop=()=>{}, org='10000000-0000-4000-8000-000000000001', uid='20000000-0000-4000-8000-000000000001';
const empty={data:[],isLoading:false,isFetching:false,isError:false,isSuccess:true,dataUpdatedAt:1,refetch:async()=>({data:[]})};
const auth={user:{id:uid},profile:{id:uid},activeOrganization:{organizationId:org},tenantContext:{organizationId:org,memberRole:'admin',permissions:['lead_view_all'],enabledModules:['crm']},isSuperAdmin:true};
export const useAuth=()=>auth;
export const useUserPermissions=()=>({hasPermission:()=>true,isLoading:false});
export const useTeams=()=>empty, useOrganizationUsers=()=>empty, usePipelines=()=>empty, useMetaIntegrations=()=>empty;
export const useTags=()=>empty, useCreateTag=()=>({isPending:false,mutateAsync:async()=>{throw Error('Mutation forbidden');}});
export const getLeadMetaFilters=async()=>({sources:['manual'],pages:[],campaigns:[],adsets:[],ads:[]});
export const useAllTeamPipelines=()=>empty;
export const AppLayout=({children})=><>{children}</>;
export const usePathname=()=>'/marketing', useRouter=()=>({replace:noop,push:noop}), useSearchParams=()=>new URLSearchParams();
export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>;}
window.searchFixtureRequests=[];
export async function vimobAPIRequest(path,options){
  if(path!=='/v1/analytics/campaign-insights')throw Error('Unexpected transport '+path);
  window.searchFixtureRequests.push({path,query:options.query,organizationId:options.organizationId});
  const data=createEmptyMarketingCampaignInsights();data.summary.totalLeads=42;data.lastSync='2026-10-01T12:00:00Z';return {data};
}
export const integrationsAPI={syncMetaMarketing:async()=>{throw Error('Sync forbidden');}};
// Real consumer, shared state, query hook, API adapter and validation run above.
// These report leaves expose their real query/model without unrelated charts.
export function MetaCampaignDashboard({filters,filtersReady}){window.searchFixtureReportFilters=filters;const q=useCampaignInsights(filters,{enabled:filtersReady});return <output data-report-leads>{q.data?.summary.totalLeads??'loading'}</output>;}
export function MarketingTabViews({activeTab,model}){return <output data-marketing-tab={activeTab}>{model.insightsQuery.data.summary.totalLeads}</output>;}
`;
