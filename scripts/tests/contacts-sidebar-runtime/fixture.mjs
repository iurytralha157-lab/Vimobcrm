export const fixture = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const filterClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
import { FilterProvider, useFilters } from '@/contexts/FilterContext';
import { FloatingChatProvider, useFloatingChat } from '@/contexts/FloatingChatContext';
import { useFilterPanelLayout } from '@/contexts/FilterPanelLayoutContext';
import { ScopedFilterPanelLayoutProvider } from '@/components/providers/filter-panel-layout-provider';
import { ContactsToolbar } from '@/components/features/contacts/contacts-screen/ContactsToolbar';
import { FloatingChatButton } from '@/components/features/chat/FloatingChatButton';
import { FilterAwareMobileChatSurface } from '@/components/features/chat/FilterAwareMobileChatSurface';
import { useIsMobile } from '@/hooks/use-mobile';

const id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const users = [{id:id(11),name:'Ágata Sintética'},{id:id(12),name:'Bruno Sintético'}];
const teams = [{id:id(21),name:'Equipe A',members:users.map(user=>({user_id:user.id}))}];
function Content({ config }) {
  const filters = useFilters(), chat = useFloatingChat(), panel = useFilterPanelLayout();
  const [mounted,setMounted] = useState(true), [counter,setCounter] = useState(0);
  const isMobile = useIsMobile();
  window.sidebarFilters = filters;
  window.sidebarChat = chat;
  window.sidebarPanel = panel;
  window.sidebarSetMounted = setMounted;
  window.sidebarRerender = () => setCounter(value=>value+1);
  const props = {
    presentation:config.presentation==='default'?undefined:config.presentation,
    datePreset:filters.datePreset,onDatePresetChange:filters.setDatePreset,onClearDatePreset:filters.clearDateFilter,
    customDateRange:filters.customDateRange,onCustomDateRangeChange:filters.setCustomDateRange,defaultDatePreset:null,
    pipelineId:filters.pipelineId,onPipelineChange:filters.setPipelineId,pipelines:[{id:id(1),name:'Pipeline A'},{id:id(2),name:'Pipeline B'}],
    teamId:filters.teamId,onTeamChange:filters.setTeamId,userId:filters.userId,onUserChange:filters.setUserId,
    scopeTeams:teams,scopeUsers:users,scopeOptionsReady:true,includeUnassignedUserOption:true,
    source:filters.source,onSourceChange:filters.setSource,dynamicSources:[{value:'manual',label:'Manual'},{value:'site',label:'Site sintético'}],
    pageId:filters.pageId,onPageChange:filters.setPageId,pages:[{id:'page-a',name:'Página sintética'}],
    campaignId:filters.campaignId,onCampaignChange:filters.setCampaignId,campaignIds:filters.campaignIds,onCampaignsChange:filters.setCampaignIds,
    campaigns:[{id:'campaign-a',name:'Campanha A'},{id:'campaign-b',name:'Campanha B'}],
    adSetId:filters.adSetId,onAdSetChange:filters.setAdSetId,adSets:[{id:'set-a',name:'Conjunto A'}],
    adId:filters.adId,onAdChange:filters.setAdId,ads:[{id:'ad-a',name:'Anúncio A'}],
    tagIds:filters.tagIds,onTagsChange:filters.setTagIds,tags:[{id:id(31),name:'Ação',color:'#525252'},{id:id(32),name:'Órion',color:'#525252'}],
    dealStatus:filters.dealStatus,onDealStatusChange:filters.setDealStatus,
    searchQuery:filters.searchQuery,onSearchChange:filters.setSearchQuery,
    onClear:()=>{window.sidebarClearCount++;filters.clearFilters();},hasActiveFilters:Boolean(filters.source||filters.userId||filters.searchQuery||filters.tagIds.length),
    onFiltersOpenChange:open=>window.sidebarOpenEvents.push(open),tourPrefix:'contacts',
    triggerClassName:'bg-[var(--app-surface-soft)] text-[10px] font-light hover:bg-[var(--app-surface-hover)]',
  };
  return <>
    <main className='app-shell' style={{minHeight:'100dvh',padding:12}} data-fixture-counter={counter} data-fixture-mobile={isMobile}>
      <button type='button' data-background-before>Região anterior</button>
      {mounted&&<ContactsToolbar isMobile={isMobile} totalCount={123} isCountLoading={false}
        canCreateLeads={config.canCreate!==false} canImportLeads={false} canExportLeads={false} isExporting={false}
        filters={props} onCreate={()=>window.sidebarCreateCount++} onImport={()=>{throw Error('No import in fixture');}} onExport={()=>{throw Error('No export in fixture');}}/>}
      <button type='button' data-background-after>Região posterior</button>
    </main>
    <FloatingChatButton/>
    <output hidden data-fixture-state>{JSON.stringify({snapshot:filters.getFilterSnapshot(),chat:chat.state.isOpen,panel:panel.active})}</output>
  </>;
}
const root = createRoot(document.getElementById('app'));
let generation=0;
function StableDraft(){
  const[text,setText]=useState(''),[count,setCount]=useState(0);
  useEffect(()=>{window.wrapperMounts++;return()=>window.wrapperUnmounts++;},[]);
  return <section role='dialog' aria-label='Chat do WhatsApp'><textarea data-wrapper-draft aria-label='Rascunho mobile' value={text} onChange={event=>setText(event.target.value)}/><input type='file' data-wrapper-file aria-label='Arquivo mobile'/><button data-wrapper-counter onClick={()=>setCount(value=>value+1)}>Contagem {count}</button></section>;
}
function MobileWrapper(){
  const[minimized,setMinimized]=useState(false);window.setWrapperMinimized=setMinimized;
  return <><button data-wrapper-outside>Fundo do wrapper</button><FilterAwareMobileChatSurface minimized={minimized} onOpenAutoFocus={event=>{event.preventDefault();document.querySelector('[data-wrapper-draft]')?.focus();}} onEscapeKeyDown={event=>event.preventDefault()}><StableDraft/></FilterAwareMobileChatSurface></>;
}
window.showMobileWrapperFixture=()=>{window.wrapperMounts=0;window.wrapperUnmounts=0;root.render(<MobileWrapper key={++generation}/>);};
window.showSidebarFixture = config => {
  window.sidebarClearCount=0;window.sidebarCreateCount=0;window.sidebarOpenEvents=[];
  document.documentElement.className=config.theme||'light';
  root.render(<QueryClientProvider client={filterClient}><FloatingChatProvider key={++generation}><ScopedFilterPanelLayoutProvider><FilterProvider><Content config={config}/></FilterProvider></ScopedFilterPanelLayoutProvider></FloatingChatProvider></QueryClientProvider>);
};
window.showSidebarFixture({presentation:'sidebar'});
`;
