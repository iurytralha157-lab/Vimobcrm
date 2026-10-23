export const fixture = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const filterClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";
import { SearchableFilterSelect } from "@/components/shared/SearchableFilterSelect";
import { SharedUserFilter } from "@/components/shared/SharedUserFilter";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { FilterProvider, useFilters } from "@/contexts/FilterContext";
import { sharedLeadFiltersForConversations } from "@/lib/filters/whatsapp-shared-filters";
import { ConversationFilters } from "@/components/features/whatsapp/conversations/ConversationFilters";
import { MAX_SHARED_REPORT_RANGE_DAYS } from "@/lib/filters/date-range-limits";
import { AgendaDashboardFilters } from "@/components/features/schedule/dashboard/AgendaDashboardFilters";

const tags = [{ id: "a", name: "Ação" }, { id: "b", name: "Bêta" }, { id: "c", name: "Órion" }];
const users = [{ id: "first", name: "Nome repetido" }, { id: "second", name: "Nome repetido" }];
function Tags({ unavailable = false, fullCapacity = false }) {
  const catalog = fullCapacity ? Array.from({ length: 60 }, (_, i) => ({ id: 'tag-' + i, name: 'Tag sintética ' + String(i + 1).padStart(2, '0') })) : tags;
  const [ids, setIds] = useState(fullCapacity ? catalog.slice(0, 50).map(tag => tag.id) : unavailable ? ["missing"] : []);
  return <><SearchableTagPicker tags={catalog} selectedTagIds={ids} onToggleTag={id => setIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} allowCreate={false} maxSelected={fullCapacity ? 50 : 2} /><output>{ids.join(",")}</output></>;
}
function SelectFixture({ user = false }) {
  const [value, setValue] = useState(null);
  return <>{user ? <SharedUserFilter users={users} value={value} onChange={setValue} /> : <SearchableFilterSelect ariaLabel="Filtrar pipeline" allLabel="Todas pipelines" options={[{ value: "first", label: "Ação" }, { value: "second", label: "Ação" }]} value={value} onChange={setValue} />}<output>{value || "all"}</output></>;
}
function RefreshableTags() {
  const [catalog,setCatalog]=useState(Array.from({length:4},(_,index)=>({id:'tag-'+index,name:'Tag sintética '+index})));
  const [ids,setIds]=useState([]);
  window.fixtureSetTagCatalog=setCatalog;
  return <><SearchableTagPicker tags={catalog} selectedTagIds={ids} onToggleTag={id=>setIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id])} allowCreate={false} showSelectedBadges={false}/><button type="button">Outra região</button><output>{ids.join(',')}</output></>;
}
function AgendaFixture() {
  const [filters,setFilters]=useState({dateFrom:'2025-12-01',dateTo:'2026-01-15',dateBasis:'start_time'});
  return <AgendaDashboardFilters filters={filters} onChange={setFilters}/>;
}
function Dates({ maxDays, longRange = false }) {
  const [preset, setPreset] = useState("custom");
  const [range, setRange] = useState({ from: longRange ? new Date(2010, 0, 1) : new Date(2025, 11, 1), to: new Date(2026, 0, 15) });
  window.fixtureDateState = { preset, range };
  return <><DateFilterPopover datePreset={preset} onDatePresetChange={setPreset} customDateRange={range} onCustomDateRangeChange={setRange} dateRangeMaxDays={maxDays} /><output>{preset || "all"}</output></>;
}
function Shared({ generalScope = false, paused = false, hideSearch = false, advancedOnly = false }) {
  const [search, setSearch] = useState(hideSearch || advancedOnly ? "Busca preservada" : "");
  const [userId, setUserId] = useState("outside-scope");
  const [source, setSource] = useState("manual");
  const [pipelineId, setPipelineId] = useState(null);
  return <><SharedFilters datePreset={null} onDatePresetChange={() => {}} customDateRange={null} onCustomDateRangeChange={() => {}}
    teamId={null} onTeamChange={() => {}} userId={userId} onUserChange={setUserId} scopeTeams={generalScope ? undefined : []} scopeUsers={generalScope ? undefined : []} scopeOptionsReady includeUnassignedUserOption
    source={source} onSourceChange={setSource} dynamicSources={[{ value: "manual", label: "Manual" }]} pageId={null} onPageChange={() => {}}
    pipelineId={pipelineId} onPipelineChange={setPipelineId} pipelines={[{ id: "30000000-0000-4000-8000-000000000001", name: "Pipeline sintética" }]}
    campaignId={null} onCampaignChange={() => {}} adSetId={null} onAdSetChange={() => {}} adId={null} onAdChange={() => {}}
    tagIds={[]} onTagsChange={() => {}} dealStatus={null} onDealStatusChange={() => {}} searchQuery={search} onSearchChange={setSearch}
    hideSearch={hideSearch} advancedContentOnly={advancedOnly}
    leadFiltersPaused={paused} hasAdvancedContentFilters={paused} advancedFilterCount={paused ? 2 : undefined}
    onClear={() => { setSearch(""); setSource(null); setUserId(null); }} hasActiveFilters={Boolean(source || userId || search)} />
    <output>{JSON.stringify({ search, userId, source, pipelineId })}</output></>;
}
function SharedBound() {
  const filters = useFilters();
  return <><SharedFilters datePreset={filters.datePreset} onDatePresetChange={filters.setDatePreset} customDateRange={filters.customDateRange} onCustomDateRangeChange={filters.setCustomDateRange}
    teamId={filters.teamId} onTeamChange={filters.setTeamId} userId={filters.userId} onUserChange={filters.setUserId} source={filters.source} onSourceChange={filters.setSource} dynamicSources={[{ value: "manual", label: "Manual" }]}
    pageId={filters.pageId} onPageChange={filters.setPageId} campaignId={filters.campaignId} onCampaignChange={filters.setCampaignId} campaignIds={filters.campaignIds} onCampaignsChange={filters.setCampaignIds}
    adSetId={filters.adSetId} onAdSetChange={filters.setAdSetId} adId={filters.adId} onAdChange={filters.setAdId} tagIds={filters.tagIds} onTagsChange={filters.setTagIds}
    dealStatus={filters.dealStatus} onDealStatusChange={filters.setDealStatus} searchQuery={filters.searchQuery} onSearchChange={filters.setSearchQuery} onClear={filters.clearFilters} hasActiveFilters={Boolean(filters.source || filters.searchQuery)} />
    <output>{JSON.stringify(filters.getFilterSnapshot())}</output></>;
}
function ContextBridge() {
  const filters = useFilters();
  window.fixtureFilters = filters;
  window.fixtureConversationScope = withoutLead => sharedLeadFiltersForConversations(filters, withoutLead);
  return null;
}
function ContextFixture() {
  const filters = useFilters();
  return <output data-context>{JSON.stringify({ hydrated: filters.isHydrated, snapshot: filters.getFilterSnapshot(), range: filters.activeDateRange })}</output>;
}
function ConversationsFixture() {
  const filters = useFilters();
  const [withoutLead, setWithoutLead] = useState(true);
  const [onlyLeads, setOnlyLeads] = useState(false);
  const [channelValue, setChannelValue] = useState("whatsapp-all");
  return <><ConversationFilters layout={window.innerWidth < 768 ? "mobile" : "desktop"} activePlatform="whatsapp" onSelectWhatsApp={() => {}} sessions={[{ id: "session-a", display_name: "Conta sintética A" }, { id: "session-b", display_name: "Conta sintética B" }]} currentChannelValue={channelValue} onChannelChange={setChannelValue}
    options={{ pipelines: [], teams: [], users: [], sources: ["manual"], tags: [], pages: [], campaigns: [], adSets: [], ads: [], hasMore: false, nextOffset: null }}
    optionsHasMore={false} optionsLoadingMore={false} onLoadMoreOptions={() => {}}
    optionsLoading={false} optionsError={false} optionsRetrying={false} onRetryOptions={() => {}} onFiltersOpenChange={() => {}}
    activeFilterCount={withoutLead ? 1 : filters.source ? 1 : 0}
    pipelineId={filters.pipelineId} onPipelineChange={filters.setPipelineId} teamId={filters.teamId} onTeamChange={filters.setTeamId} userId={filters.userId} onUserChange={filters.setUserId}
    leadSource={filters.source} onLeadSourceChange={filters.setSource} tagIds={filters.tagIds} onTagsChange={filters.setTagIds} dealStatus={filters.dealStatus} onDealStatusChange={filters.setDealStatus}
    pageId={filters.pageId} onPageChange={filters.setPageId} campaignIds={filters.campaignIds} onCampaignsChange={filters.setCampaignIds} adSetId={filters.adSetId} onAdSetChange={filters.setAdSetId} adId={filters.adId} onAdChange={filters.setAdId}
    datePreset={filters.datePreset} onDatePresetChange={filters.setDatePreset} customDateRange={filters.customDateRange} onCustomDateRangeChange={filters.setCustomDateRange}
    showArchived={false} onShowArchivedChange={() => {}} onlyLeads={onlyLeads} onOnlyLeadsChange={setOnlyLeads} withoutLeadOnly={withoutLead} onWithoutLeadOnlyChange={setWithoutLead}
    pendingReplyOnly={false} onPendingReplyOnlyChange={() => {}} onClearFilters={filters.clearFilters} searchTerm={filters.searchQuery} onSearchTermChange={filters.setSearchQuery} />
    <output>{JSON.stringify({ withoutLead, source: filters.source, datePreset: filters.datePreset, channelValue })}</output></>;
}
const app = createRoot(document.getElementById("app"));
window.showFilterFixture = name => app.render(<QueryClientProvider client={filterClient}><FilterProvider><ContextBridge /><main className="app-shell" style={{ width: 290, margin: 12 }} key={name}>{name === "tags-refresh" ? <RefreshableTags/> : name === "agenda" ? <AgendaFixture/> : name === "date-limited" ? <Dates longRange maxDays={MAX_SHARED_REPORT_RANGE_DAYS} /> : name === "date-unlimited" ? <Dates longRange /> : name === "bound" ? <SharedBound /> : name === "conversations" ? <ConversationsFixture /> : name === "context" ? <ContextFixture /> : name === "tags" ? <Tags /> : name === "tags-full" ? <Tags fullCapacity /> : name === "unavailable" ? <Tags unavailable /> : name === "users" ? <SelectFixture user /> : name === "select" ? <SelectFixture /> : name === "date" ? <Dates /> : <Shared generalScope={name === "shared-general"} paused={name === "shared-paused"} hideSearch={name === "shared-hidden-search"} advancedOnly={name === "shared-advanced-only"} />}</main></FilterProvider></QueryClientProvider>);
window.showFilterFixture("tags");
`;
