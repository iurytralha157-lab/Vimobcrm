import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { DatePreset, getDateRangeFromPreset } from '@/hooks/use-dashboard-filters';
import { useRelativeDateClock } from '@/hooks/shared/use-relative-date-clock';
import { sharedFilterSnapshotSchema, type SharedFilterSnapshot } from '@/lib/validation/shared-filter-presets';
import { filterTextSchema } from '@/lib/validation/filter-text';

type NullableFilter = string | null;

const MAX_FILTER_TAGS = 50;
const MAX_FILTER_CAMPAIGNS = 50;
const attributionTextSchema = filterTextSchema(255, 1);
const DATE_PRESET_VALUES = new Set<DatePreset>([
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
  'custom',
]);

interface FilterStateSnapshot {
  version: 2;
  datePreset: DatePreset | null;
  customDateRange: { from: string; to: string } | null;
  pipelineId: NullableFilter;
  teamId: NullableFilter;
  userId: NullableFilter;
  source: NullableFilter;
  pageId: NullableFilter;
  campaignId: NullableFilter;
  campaignIds: string[];
  adSetId: NullableFilter;
  adId: NullableFilter;
  tagIds: string[];
  dealStatus: NullableFilter;
  searchQuery: string;
}

interface FilterContextType {
  isHydrated: boolean;
  /** Full filter applications reset drafts even when their applied value is unchanged. */
  filterApplicationRevision: number;
  datePreset: DatePreset | null;
  customDateRange: { from: Date; to: Date } | null;
  setDatePreset: (preset: DatePreset | null) => void;
  setCustomDateRange: (range: { from: Date; to: Date } | null) => void;
  clearDateFilter: () => void;
  activeDateRange: { from: Date; to: Date } | null;
  pipelineId: NullableFilter;
  setPipelineId: (pipelineId: NullableFilter) => void;
  teamId: NullableFilter;
  setTeamId: (teamId: NullableFilter) => void;
  userId: NullableFilter;
  setUserId: (userId: NullableFilter) => void;
  source: NullableFilter;
  setSource: (source: NullableFilter) => void;
  pageId: NullableFilter;
  setPageId: (pageId: NullableFilter) => void;
  campaignId: NullableFilter;
  setCampaignId: (campaignId: NullableFilter) => void;
  campaignIds: string[];
  setCampaignIds: (campaignIds: string[]) => void;
  adSetId: NullableFilter;
  setAdSetId: (adSetId: NullableFilter) => void;
  adId: NullableFilter;
  setAdId: (adId: NullableFilter) => void;
  tagIds: string[];
  setTagIds: (tagIds: string[]) => void;
  dealStatus: NullableFilter;
  setDealStatus: (dealStatus: NullableFilter) => void;
  searchQuery: string;
  setSearchQuery: (searchQuery: string) => void;
  clearFilters: () => void;
  getFilterSnapshot: () => SharedFilterSnapshot;
  restoreFilterSnapshot: (snapshot: unknown) => boolean;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

const DEFAULT_FILTER_STATE: FilterStateSnapshot = {
  version: 2,
  datePreset: null,
  customDateRange: null,
  pipelineId: null,
  teamId: null,
  userId: null,
  source: null,
  pageId: null,
  campaignId: null,
  campaignIds: [],
  adSetId: null,
  adId: null,
  tagIds: [],
  dealStatus: null,
  searchQuery: '',
};

function normalizeNullable(value: unknown): NullableFilter {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function normalizePageId(value: unknown): NullableFilter {
  const parsed = attributionTextSchema.safeParse(value);
  return parsed.success && parsed.data !== 'all'
    ? parsed.data
    : null;
}

function normalizeSearch(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeDatePreset(value: unknown): DatePreset | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && DATE_PRESET_VALUES.has(value as DatePreset)
    ? (value as DatePreset)
    : DEFAULT_FILTER_STATE.datePreset;
}

function normalizeTagIds(value: unknown, legacyValue?: unknown) {
  const candidates = Array.isArray(value)
    ? value
    : typeof legacyValue === 'string'
      ? [legacyValue]
      : [];

  return Array.from(
    new Set(
      candidates
        .filter((candidate): candidate is string => typeof candidate === 'string')
        .map((candidate) => candidate.trim().toLowerCase())
        .filter((candidate) => candidate !== '' && candidate !== 'all'),
    ),
  ).slice(0, MAX_FILTER_TAGS);
}

function normalizeCampaignIds(value: unknown, legacyValue?: unknown) {
  const candidates = Array.isArray(value)
    ? value
    : typeof legacyValue === 'string'
      ? [legacyValue]
      : [];

  return Array.from(new Set(
    candidates
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.toLowerCase() !== 'all' && attributionTextSchema.safeParse(candidate).success),
  )).slice(0, MAX_FILTER_CAMPAIGNS);
}

function serializeRange(range: { from: Date; to: Date } | null) {
  return range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null;
}

function normalizeFilterSnapshot(parsed: SharedFilterSnapshot): FilterStateSnapshot {
  const campaignIds = normalizeCampaignIds(parsed.campaignIds, parsed.campaignId);
  const adSetId = campaignIds.length === 1 ? normalizeNullable(parsed.adSetId) : null;
  return {
    ...DEFAULT_FILTER_STATE,
    datePreset: normalizeDatePreset(parsed.datePreset),
    customDateRange: parsed.datePreset === 'custom' ? parsed.customDateRange : null,
    pipelineId: normalizeNullable(parsed.pipelineId),
    teamId: normalizeNullable(parsed.teamId),
    userId: normalizeNullable(parsed.userId),
    source: normalizeNullable(parsed.source),
    pageId: normalizePageId(parsed.pageId),
    campaignId: campaignIds.length === 1 ? campaignIds[0] : null,
    campaignIds,
    adSetId,
    adId: adSetId ? normalizeNullable(parsed.adId) : null,
    tagIds: normalizeTagIds(parsed.tagIds),
    dealStatus: normalizeNullable(parsed.dealStatus),
    searchQuery: normalizeSearch(parsed.searchQuery),
  };
}

function parseCustomDateRange(range: FilterStateSnapshot['customDateRange']) {
  if (!range) return null;
  const from = new Date(range.from);
  const to = new Date(range.to);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.getTime() > to.getTime()
  ) {
    return null;
  }
  return { from, to };
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { activeOrganization, user } = useAuth();
  const scopeKey = user?.id && activeOrganization.organizationId
    ? JSON.stringify([user.id, activeOrganization.organizationId])
    : null;

  // A new identity gets empty state before any child can observe the old filters.
  // Navigation within the same provider keeps only the current in-memory state.
  return (
    <InMemoryFilterProvider key={scopeKey ?? 'unavailable'} isReady={scopeKey !== null}>
      {children}
    </InMemoryFilterProvider>
  );
}

function InMemoryFilterProvider({ children, isReady }: { children: React.ReactNode; isReady: boolean }) {
  const [datePreset, setDatePresetInternal] = useState<DatePreset | null>(DEFAULT_FILTER_STATE.datePreset);
  const [customDateRange, setCustomDateRangeInternal] = useState<{ from: Date; to: Date } | null>(null);
  const [pipelineId, setPipelineIdInternal] = useState<NullableFilter>(null);
  const [teamId, setTeamIdInternal] = useState<NullableFilter>(null);
  const [userId, setUserIdInternal] = useState<NullableFilter>(null);
  const [source, setSourceInternal] = useState<NullableFilter>(null);
  const [pageId, setPageIdInternal] = useState<NullableFilter>(null);
  const [campaignId, setCampaignIdInternal] = useState<NullableFilter>(null);
  const [campaignIds, setCampaignIdsInternal] = useState<string[]>([]);
  const [adSetId, setAdSetIdInternal] = useState<NullableFilter>(null);
  const [adId, setAdIdInternal] = useState<NullableFilter>(null);
  const [tagIds, setTagIdsInternal] = useState<string[]>([]);
  const [dealStatus, setDealStatusInternal] = useState<NullableFilter>(null);
  const [searchQuery, setSearchQueryInternal] = useState('');
  const [filterApplicationRevision, setFilterApplicationRevision] = useState(0);
  const applyState = useCallback((nextState: FilterStateSnapshot) => {
    setDatePresetInternal(nextState.datePreset);
    setCustomDateRangeInternal(parseCustomDateRange(nextState.customDateRange));
    setPipelineIdInternal(nextState.pipelineId);
    setTeamIdInternal(nextState.teamId);
    setUserIdInternal(nextState.userId);
    setSourceInternal(nextState.source);
    setPageIdInternal(nextState.pageId);
    setCampaignIdInternal(nextState.campaignId);
    setCampaignIdsInternal(nextState.campaignIds);
    setAdSetIdInternal(nextState.adSetId);
    setAdIdInternal(nextState.adId);
    setTagIdsInternal(nextState.tagIds);
    setDealStatusInternal(nextState.dealStatus);
    setSearchQueryInternal(nextState.searchQuery);
    setFilterApplicationRevision((revision) => revision + 1);
  }, []);

  const setDatePreset = useCallback(
    (preset: DatePreset | null) => {
      setDatePresetInternal(preset);
      setCustomDateRangeInternal(null);
    },
    [],
  );

  const setCustomDateRange = useCallback(
    (range: { from: Date; to: Date } | null) => {
      setCustomDateRangeInternal(range);
      if (range) {
        setDatePresetInternal('custom');
        return;
      }
    },
    [],
  );

  const setTeamId = useCallback(
    (value: NullableFilter) => {
      setTeamIdInternal(value);
      setUserIdInternal(null);
    },
    [],
  );

  const setPipelineId = useCallback(
    (value: NullableFilter) => {
      const normalized = normalizeNullable(value);
      setPipelineIdInternal(normalized === 'all' ? null : normalized);
    },
    [],
  );

  const setUserId = useCallback(
    (value: NullableFilter) => {
      setUserIdInternal(value);
    },
    [],
  );

  const setSource = useCallback(
    (value: NullableFilter) => {
      setSourceInternal(value);
    },
    [],
  );

  const setPageId = useCallback(
    (value: NullableFilter) => {
      const normalized = normalizePageId(value);
      setPageIdInternal(normalized);
      setCampaignIdInternal(null);
      setCampaignIdsInternal([]);
      setAdSetIdInternal(null);
      setAdIdInternal(null);
    },
    [],
  );

  const setCampaignId = useCallback(
    (value: NullableFilter) => {
      const normalized = normalizeCampaignIds(undefined, value);
      setCampaignIdInternal(normalized[0] ?? null);
      setCampaignIdsInternal(normalized);
      setAdSetIdInternal(null);
      setAdIdInternal(null);
    },
    [],
  );

  const setCampaignIds = useCallback(
    (value: string[]) => {
      const normalized = normalizeCampaignIds(value);
      const legacyCampaignId = normalized.length === 1 ? normalized[0] : null;
      setCampaignIdInternal(legacyCampaignId);
      setCampaignIdsInternal(normalized);
      setAdSetIdInternal(null);
      setAdIdInternal(null);
    },
    [],
  );

  const setAdSetId = useCallback(
    (value: NullableFilter) => {
      setAdSetIdInternal(value);
      setAdIdInternal(null);
    },
    [],
  );

  const setAdId = useCallback(
    (value: NullableFilter) => {
      setAdIdInternal(value);
    },
    [],
  );

  const setTagIds = useCallback(
    (value: string[]) => {
      const normalized = normalizeTagIds(value);
      setTagIdsInternal(normalized);
    },
    [],
  );

  const setDealStatus = useCallback(
    (value: NullableFilter) => {
      setDealStatusInternal(value);
    },
    [],
  );

  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchQueryInternal(value);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    applyState(DEFAULT_FILTER_STATE);
  }, [applyState]);

  const clearDateFilter = useCallback(() => {
    setDatePreset(null);
  }, [setDatePreset]);

  const getFilterSnapshot = useCallback(() => sharedFilterSnapshotSchema.parse({
    version: 2, datePreset, customDateRange: serializeRange(customDateRange), pipelineId,
    teamId, userId, source, pageId, campaignId, campaignIds, adSetId, adId, tagIds, dealStatus, searchQuery,
  }), [datePreset, customDateRange, pipelineId, teamId, userId, source, pageId, campaignId, campaignIds, adSetId, adId, tagIds, dealStatus, searchQuery]);

  // Atomic application within this mounted scope; never saved or restored from browser storage.
  const restoreFilterSnapshot = useCallback((snapshot: unknown) => {
    if (!isReady) return false;
    const result = sharedFilterSnapshotSchema.safeParse(snapshot);
    if (!result.success) return false;
    const nextState = normalizeFilterSnapshot(result.data);
    applyState(nextState);
    return true;
  }, [applyState, isReady]);

  const relativeDateClock = useRelativeDateClock(Boolean(datePreset && datePreset !== 'custom'));
  const activeDateRange = useMemo(() => {
    // The clock invalidates this memo after midnight or a suspended tab resumes.
    void relativeDateClock;
    if (!datePreset) return null;
    if (datePreset === 'custom' && customDateRange) {
      return customDateRange;
    }
    if (datePreset === 'custom') return null;
    return getDateRangeFromPreset(datePreset);
  }, [datePreset, customDateRange, relativeDateClock]);

  const value = useMemo(
    () => ({
      isHydrated: isReady,
      filterApplicationRevision,
      datePreset,
      customDateRange,
      setDatePreset,
      setCustomDateRange,
      clearDateFilter,
      activeDateRange,
      pipelineId,
      setPipelineId,
      teamId,
      setTeamId,
      userId,
      setUserId,
      source,
      setSource,
      pageId,
      setPageId,
      campaignId,
      setCampaignId,
      campaignIds,
      setCampaignIds,
      adSetId,
      setAdSetId,
      adId,
      setAdId,
      tagIds,
      setTagIds,
      dealStatus,
      setDealStatus,
      searchQuery,
      setSearchQuery,
      clearFilters,
      getFilterSnapshot,
      restoreFilterSnapshot,
    }),
    [
      activeDateRange,
      adId,
      adSetId,
      campaignId,
      campaignIds,
      clearDateFilter,
      clearFilters,
      getFilterSnapshot,
      restoreFilterSnapshot,
      customDateRange,
      datePreset,
      dealStatus,
      filterApplicationRevision,
      isReady,
      pageId,
      pipelineId,
      searchQuery,
      setAdId,
      setAdSetId,
      setCampaignId,
      setCampaignIds,
      setCustomDateRange,
      setDatePreset,
      setDealStatus,
      setSearchQuery,
      setPageId,
      setPipelineId,
      setSource,
      setTagIds,
      setTeamId,
      setUserId,
      source,
      tagIds,
      teamId,
      userId,
    ],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return context;
}
