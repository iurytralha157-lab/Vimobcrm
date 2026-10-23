export const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const filterClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
import { SharedFilters } from '@/components/shared/SharedFilters';
import { ConversationFilters } from '@/components/features/whatsapp/conversations/ConversationFilters';
import { MarketingScopeFilters } from '@/components/features/marketing/MarketingScopeFilters';
import { FilterProvider, useFilters } from '@/contexts/FilterContext';
import { FloatingChatProvider, useFloatingChat } from '@/contexts/FloatingChatContext';
import { ScopedFilterPanelLayoutProvider } from '@/components/providers/filter-panel-layout-provider';
import { useFilterPanelLayout } from '@/contexts/FilterPanelLayoutContext';
import { FloatingChatButton } from '@/components/features/chat/FloatingChatButton';
import { useIsMobile } from '@/hooks/use-mobile';

const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sources=[{value:'manual',label:'Manual'},{value:'site',label:'Site sintético'}];
const pages=[{id:'page-a',name:'Página sintética'}], campaigns=[{id:'campaign-a',name:'Campanha sintética'}];
function Content({config}) {
  const f=useFilters(), panel=useFilterPanelLayout(), chat=useFloatingChat(), mobile=useIsMobile();
  const [withoutLead,setWithoutLead]=useState(config.withoutLead??false),[channel,setChannel]=useState('whatsapp-all');
  const [optionsPage,setOptionsPage]=useState(1),[archived,setArchived]=useState(false),[onlyLeads,setOnlyLeads]=useState(false),[pending,setPending]=useState(false);
  const [account,setAccount]=useState(null),[objective,setObjective]=useState(null);
  window.rolloutFilters=f;window.rolloutPanel=panel;window.rolloutChat=chat;
  window.rolloutState=()=>({snapshot:f.getFilterSnapshot(),withoutLead,channel,optionsPage,archived,onlyLeads,pending,account,objective});
  const onOpen=open=>window.rolloutEvents.push(open);
  const clear=()=>{window.rolloutClearCount++;f.clearFilters();setWithoutLead(false);setChannel('whatsapp-all');setArchived(false);setOnlyLeads(false);setPending(false);setAccount(null);setObjective(null);};
  const base={
    datePreset:f.datePreset,onDatePresetChange:f.setDatePreset,customDateRange:f.customDateRange,onCustomDateRangeChange:f.setCustomDateRange,defaultDatePreset:null,
    teamId:f.teamId,onTeamChange:f.setTeamId,userId:f.userId,onUserChange:f.setUserId,scopeTeams:[],scopeUsers:[],scopeOptionsReady:true,
    pipelineId:f.pipelineId,onPipelineChange:f.setPipelineId,pipelines:[{id:id(1),name:'Pipeline sintética'}],
    source:f.source,onSourceChange:f.setSource,dynamicSources:sources,pageId:f.pageId,onPageChange:f.setPageId,pages,
    campaignId:f.campaignId,onCampaignChange:f.setCampaignId,campaignIds:f.campaignIds,onCampaignsChange:f.setCampaignIds,campaigns,
    adSetId:f.adSetId,onAdSetChange:f.setAdSetId,adSets:[{id:'set-a',name:'Conjunto sintético'}],adId:f.adId,onAdChange:f.setAdId,ads:[],
    tagIds:f.tagIds,onTagsChange:f.setTagIds,tags:[{id:id(31),name:'Ação',color:'#525252'}],
    dealStatus:f.dealStatus,onDealStatusChange:f.setDealStatus,searchQuery:f.searchQuery,onSearchChange:f.setSearchQuery,
    onClear:clear,hasActiveFilters:Boolean(f.source||f.searchQuery||f.tagIds.length),onFiltersOpenChange:onOpen,loadDynamicOptions:false,tourPrefix:'rollout',
  };
  // No presentation property exists in this object unless explicitly requested.
  if(config.presentation!==undefined)base.presentation=config.presentation;
  let controls;
  if(config.consumer==='whatsapp') controls=<ConversationFilters layout={mobile?'mobile':'desktop'} activePlatform='whatsapp' onSelectWhatsApp={()=>{}}
    sessions={[{id:'session-a',display_name:'Conta sintética A'},{id:'session-b',display_name:'Conta sintética B'}]} currentChannelValue={channel} onChannelChange={setChannel}
    options={{pipelines:base.pipelines,teams:[],users:[],sources:sources.map(s=>s.value),tags:base.tags,pages,campaigns,adSets:base.adSets,ads:[],hasMore:false,nextOffset:null}}
    optionsHasMore={Boolean(config.optionsHasMore)&&optionsPage===1} optionsLoadingMore={Boolean(config.optionsLoadingMore)} onLoadMoreOptions={()=>setOptionsPage(current=>current+1)}
    optionsLoading={false} optionsError={false} optionsRetrying={false} onRetryOptions={()=>{}} onFiltersOpenChange={onOpen}
    activeFilterCount={Number(withoutLead)+Number(Boolean(f.source))+Number(Boolean(f.searchQuery))}
    pipelineId={f.pipelineId} onPipelineChange={f.setPipelineId} teamId={f.teamId} onTeamChange={f.setTeamId} userId={f.userId} onUserChange={f.setUserId}
    leadSource={f.source} onLeadSourceChange={f.setSource} tagIds={f.tagIds} onTagsChange={f.setTagIds} dealStatus={f.dealStatus} onDealStatusChange={f.setDealStatus}
    pageId={f.pageId} onPageChange={f.setPageId} campaignIds={f.campaignIds} onCampaignsChange={f.setCampaignIds} adSetId={f.adSetId} onAdSetChange={f.setAdSetId} adId={f.adId} onAdChange={f.setAdId}
    datePreset={f.datePreset} onDatePresetChange={f.setDatePreset} customDateRange={f.customDateRange} onCustomDateRangeChange={f.setCustomDateRange}
    showArchived={archived} onShowArchivedChange={setArchived} onlyLeads={onlyLeads} onOnlyLeadsChange={setOnlyLeads} withoutLeadOnly={withoutLead} onWithoutLeadOnlyChange={setWithoutLead}
    pendingReplyOnly={pending} onPendingReplyOnlyChange={setPending} onClearFilters={clear} searchTerm={f.searchQuery} onSearchTermChange={f.setSearchQuery}/>;
  else if(config.consumer==='marketing') controls=<SharedFilters {...base} advancedContentOnly hasAdvancedContentFilters={Boolean(account||objective||f.pageId||f.campaignIds.length)}
    advancedContent={layerScope=><MarketingScopeFilters layerScope={layerScope} accountId={account} onAccountChange={setAccount} accounts={[{value:'account-a',label:'Conta de anúncio A'}]}
      pageId={f.pageId} onPageChange={f.setPageId} pages={pages.map(p=>({value:p.id,label:p.name}))}
      campaignId={f.campaignId} onCampaignChange={f.setCampaignId} campaignIds={f.campaignIds} onCampaignsChange={f.setCampaignIds} campaigns={campaigns.map(c=>({value:c.id,label:c.name}))}
      adSetId={f.adSetId} onAdSetChange={f.setAdSetId} adSets={[{value:'set-a',label:'Conjunto sintético'}]} objective={objective} onObjectiveChange={setObjective} objectives={[{value:'LEADS',label:'Cadastros'}]} onClear={clear} variant='panel'/>}/>;
  else controls=<SharedFilters {...base}/>;
  return <><main className='app-shell' data-rollout-mobile={mobile} style={{width:config.consumer==='whatsapp'?280:Math.min(700,window.innerWidth-24),margin:12}}>
    <button data-rollout-before>Antes dos filtros</button>{controls}<button data-rollout-after>Depois dos filtros</button>
  </main><FloatingChatButton/></>;
}
const root=createRoot(document.getElementById('app'));let generation=0;
window.showRollout=config=>{
  window.rolloutEvents=[];window.rolloutClearCount=0;document.documentElement.className=config.theme||'light';
  root.render(<QueryClientProvider client={filterClient}><FloatingChatProvider key={++generation}><ScopedFilterPanelLayoutProvider><FilterProvider><Content config={config}/></FilterProvider></ScopedFilterPanelLayoutProvider></FloatingChatProvider></QueryClientProvider>);
};
window.showRollout({});
`;
