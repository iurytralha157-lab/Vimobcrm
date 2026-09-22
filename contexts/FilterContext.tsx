import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { DatePreset, getDateRangeFromPreset } from '@/hooks/use-dashboard-filters';

type NullableFilter = string | null;

const MAX_FILTER_TAGS = 50;
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

interface PersistedFilterState {
  version: 2;
  datePreset: DatePreset | null;
  customDateRange: { from: string; to: string } | null;
  teamId: NullableFilter;
  userId: NullableFilter;
  source: NullableFilter;
  pageId: NullableFilter;
  campaignId: NullableFilter;
  adSetId: NullableFilter;
  adId: NullableFilter;
  tagIds: string[];
  /** Legacy persisted key kept only for session-state migration. */
  tagId?: NullableFilter;
  dealStatus: NullableFilter;
  searchQuery: string;
}

interface FilterContextType {
  isHydrated: boolean;
  datePreset: DatePreset | null;
  customDateRange: { from: Date; to: Date } | null;
  setDatePreset: (preset: DatePreset | null) => void;
  setCustomDateRange: (range: { from: Date; to: Date } | null) => void;
  clearDateFilter: () => void;
  activeDateRange: { from: Date; to: Date } | null;
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
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

const DEFAULT_FILTER_STATE: PersistedFilterState = {
  version: 2,
  datePreset: null,
  customDateRange: null,
  teamId: null,
  userId: null,
  source: null,
  pageId: null,
  campaignId: null,
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
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized !== 'all' && normalized.length <= 255
    ? normalized
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

function serializeRange(range: { from: Date; to: Date } | null) {
  return range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null;
}

function parsePersistedState(raw: string | null): PersistedFilterState {
  if (!raw) return DEFAULT_FILTER_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedFilterState>;
    const parsedDatePreset =
      parsed.version === DEFAULT_FILTER_STATE.version
        ? normalizeDatePreset(parsed.datePreset)
        : null;
    const hasValidCustomRange = Boolean(parseCustomDateRange(parsed.customDateRange ?? null));
    const datePreset =
      parsedDatePreset === 'custom' && !hasValidCustomRange
        ? DEFAULT_FILTER_STATE.datePreset
        : parsedDatePreset;
    return {
      ...DEFAULT_FILTER_STATE,
      datePreset,
      customDateRange:
        datePreset === 'custom' ? parsed.customDateRange ?? null : null,
      teamId: normalizeNullable(parsed.teamId),
      userId: normalizeNullable(parsed.userId),
      source: normalizeNullable(parsed.source),
      pageId: normalizePageId(parsed.pageId),
      campaignId: normalizeNullable(parsed.campaignId),
      adSetId: normalizeNullable(parsed.adSetId),
      adId: normalizeNullable(parsed.adId),
      tagIds: normalizeTagIds(parsed.tagIds, parsed.tagId),
      dealStatus: normalizeNullable(parsed.dealStatus),
      searchQuery: normalizeSearch(parsed.searchQuery),
    };
  } catch (error) {
    console.error('Error parsing saved filters', error);
    return DEFAULT_FILTER_STATE;
  }
}

function parseCustomDateRange(range: PersistedFilterState['customDateRange']) {
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
  const storageKey = useMemo(() => {
    if (!user?.id || !activeOrganization.organizationId) return null;
    return `vimob_period_filter_${user.id}_${activeOrganization.organizationId}`;
  }, [user?.id, activeOrganization.organizationId]);

  const [datePreset, setDatePresetInternal] = useState<DatePreset | null>(DEFAULT_FILTER_STATE.datePreset);
  const [customDateRange, setCustomDateRangeInternal] = useState<{ from: Date; to: Date } | null>(null);
  const [teamId, setTeamIdInternal] = useState<NullableFilter>(null);
  const [userId, setUserIdInternal] = useState<NullableFilter>(null);
  const [source, setSourceInternal] = useState<NullableFilter>(null);
  const [pageId, setPageIdInternal] = useState<NullableFilter>(null);
  const [campaignId, setCampaignIdInternal] = useState<NullableFilter>(null);
  const [adSetId, setAdSetIdInternal] = useState<NullableFilter>(null);
  const [adId, setAdIdInternal] = useState<NullableFilter>(null);
  const [tagIds, setTagIdsInternal] = useState<string[]>([]);
  const [dealStatus, setDealStatusInternal] = useState<NullableFilter>(null);
  const [searchQuery, setSearchQueryInternal] = useState('');
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null | undefined>(undefined);

  const persist = useCallback(
    (patch: Partial<PersistedFilterState>) => {
      if (!storageKey) return;

      try {
        const current = parsePersistedState(sessionStorage.getItem(storageKey));
        sessionStorage.setItem(storageKey, JSON.stringify({ ...current, ...patch }));
      } catch {
        // Restricted browser contexts can make sessionStorage unavailable.
      }
    },
    [storageKey],
  );

  const applyState = useCallback((nextState: PersistedFilterState) => {
    setDatePresetInternal(nextState.datePreset);
    setCustomDateRangeInternal(parseCustomDateRange(nextState.customDateRange));
    setTeamIdInternal(nextState.teamId);
    setUserIdInternal(nextState.userId);
    setSourceInternal(nextState.source);
    setPageIdInternal(nextState.pageId);
    setCampaignIdInternal(nextState.campaignId);
    setAdSetIdInternal(nextState.adSetId);
    setAdIdInternal(nextState.adId);
    setTagIdsInternal(nextState.tagIds);
    setDealStatusInternal(nextState.dealStatus);
    setSearchQueryInternal(nextState.searchQuery);
  }, []);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      if (!storageKey) {
        applyState(DEFAULT_FILTER_STATE);
        setHydratedStorageKey(null);
        return;
      }

      try {
        applyState(parsePersistedState(sessionStorage.getItem(storageKey)));
      } catch {
        applyState(DEFAULT_FILTER_STATE);
      }
      setHydratedStorageKey(storageKey);
    });

    return () => {
      cancelled = true;
    };
  }, [applyState, storageKey]);

  const setDatePreset = useCallback(
    (preset: DatePreset | null) => {
      setDatePresetInternal(preset);
      setCustomDateRangeInternal(null);
      persist({ datePreset: preset, customDateRange: null });
    },
    [persist],
  );

  const setCustomDateRange = useCallback(
    (range: { from: Date; to: Date } | null) => {
      setCustomDateRangeInternal(range);
      if (range) {
        setDatePresetInternal('custom');
        persist({ datePreset: 'custom', customDateRange: serializeRange(range) });
        return;
      }
      persist({ customDateRange: null });
    },
    [persist],
  );

  const setTeamId = useCallback(
    (value: NullableFilter) => {
      setTeamIdInternal(value);
      persist({ teamId: value });
    },
    [persist],
  );

  const setUserId = useCallback(
    (value: NullableFilter) => {
      setUserIdInternal(value);
      persist({ userId: value });
    },
    [persist],
  );

  const setSource = useCallback(
    (value: NullableFilter) => {
      setSourceInternal(value);
      persist({ source: value });
    },
    [persist],
  );

  const setPageId = useCallback(
    (value: NullableFilter) => {
      const normalized = normalizePageId(value);
      setPageIdInternal(normalized);
      persist({ pageId: normalized });
    },
    [persist],
  );

  const setCampaignId = useCallback(
    (value: NullableFilter) => {
      setCampaignIdInternal(value);
      persist({ campaignId: value });
    },
    [persist],
  );

  const setAdSetId = useCallback(
    (value: NullableFilter) => {
      setAdSetIdInternal(value);
      persist({ adSetId: value });
    },
    [persist],
  );

  const setAdId = useCallback(
    (value: NullableFilter) => {
      setAdIdInternal(value);
      persist({ adId: value });
    },
    [persist],
  );

  const setTagIds = useCallback(
    (value: string[]) => {
      const normalized = normalizeTagIds(value);
      setTagIdsInternal(normalized);
      persist({ tagIds: normalized, tagId: null });
    },
    [persist],
  );

  const setDealStatus = useCallback(
    (value: NullableFilter) => {
      setDealStatusInternal(value);
      persist({ dealStatus: value });
    },
    [persist],
  );

  const setSearchQuery = useCallback(
    (value: string) => {
      setSearchQueryInternal(value);
      persist({ searchQuery: value });
    },
    [persist],
  );

  const clearFilters = useCallback(() => {
    applyState(DEFAULT_FILTER_STATE);
    if (storageKey) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(DEFAULT_FILTER_STATE));
      } catch {
        // State is still cleared in memory when persistence is unavailable.
      }
    }
  }, [applyState, storageKey]);

  const clearDateFilter = useCallback(() => {
    setDatePreset(null);
  }, [setDatePreset]);

  const activeDateRange = useMemo(() => {
    if (!datePreset) return null;
    if (datePreset === 'custom' && customDateRange) {
      return customDateRange;
    }
    if (datePreset === 'custom') return null;
    return getDateRangeFromPreset(datePreset);
  }, [datePreset, customDateRange]);

  const value = useMemo(
    () => ({
      isHydrated: hydratedStorageKey === storageKey,
      datePreset,
      customDateRange,
      setDatePreset,
      setCustomDateRange,
      clearDateFilter,
      activeDateRange,
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
    }),
    [
      activeDateRange,
      adId,
      adSetId,
      campaignId,
      clearDateFilter,
      clearFilters,
      customDateRange,
      datePreset,
      dealStatus,
      hydratedStorageKey,
      pageId,
      searchQuery,
      setAdId,
      setAdSetId,
      setCampaignId,
      setCustomDateRange,
      setDatePreset,
      setDealStatus,
      setSearchQuery,
      setPageId,
      setSource,
      setTagIds,
      setTeamId,
      setUserId,
      source,
      tagIds,
      teamId,
      userId,
      storageKey,
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
