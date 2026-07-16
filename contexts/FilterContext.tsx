import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { DatePreset, getDateRangeFromPreset } from '@/hooks/use-dashboard-filters';

type NullableFilter = string | null;

interface PersistedFilterState {
  datePreset: DatePreset;
  customDateRange: { from: string; to: string } | null;
  teamId: NullableFilter;
  userId: NullableFilter;
  source: NullableFilter;
  campaignId: NullableFilter;
  adSetId: NullableFilter;
  adId: NullableFilter;
  tagId: NullableFilter;
  dealStatus: NullableFilter;
  searchQuery: string;
}

interface FilterContextType {
  datePreset: DatePreset;
  customDateRange: { from: Date; to: Date } | null;
  setDatePreset: (preset: DatePreset) => void;
  setCustomDateRange: (range: { from: Date; to: Date } | null) => void;
  clearDateFilter: () => void;
  activeDateRange: { from: Date; to: Date };
  teamId: NullableFilter;
  setTeamId: (teamId: NullableFilter) => void;
  userId: NullableFilter;
  setUserId: (userId: NullableFilter) => void;
  source: NullableFilter;
  setSource: (source: NullableFilter) => void;
  campaignId: NullableFilter;
  setCampaignId: (campaignId: NullableFilter) => void;
  adSetId: NullableFilter;
  setAdSetId: (adSetId: NullableFilter) => void;
  adId: NullableFilter;
  setAdId: (adId: NullableFilter) => void;
  tagId: NullableFilter;
  setTagId: (tagId: NullableFilter) => void;
  dealStatus: NullableFilter;
  setDealStatus: (dealStatus: NullableFilter) => void;
  searchQuery: string;
  setSearchQuery: (searchQuery: string) => void;
  clearFilters: () => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

const DEFAULT_FILTER_STATE: PersistedFilterState = {
  datePreset: 'last30days',
  customDateRange: null,
  teamId: null,
  userId: null,
  source: null,
  campaignId: null,
  adSetId: null,
  adId: null,
  tagId: null,
  dealStatus: null,
  searchQuery: '',
};

function normalizeNullable(value: unknown): NullableFilter {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function normalizeSearch(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function serializeRange(range: { from: Date; to: Date } | null) {
  return range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null;
}

function parsePersistedState(raw: string | null): PersistedFilterState {
  if (!raw) return DEFAULT_FILTER_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedFilterState>;
    return {
      ...DEFAULT_FILTER_STATE,
      datePreset: parsed.datePreset || DEFAULT_FILTER_STATE.datePreset,
      customDateRange: parsed.customDateRange || null,
      teamId: normalizeNullable(parsed.teamId),
      userId: normalizeNullable(parsed.userId),
      source: normalizeNullable(parsed.source),
      campaignId: normalizeNullable(parsed.campaignId),
      adSetId: normalizeNullable(parsed.adSetId),
      adId: normalizeNullable(parsed.adId),
      tagId: normalizeNullable(parsed.tagId),
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
  return {
    from: new Date(range.from),
    to: new Date(range.to),
  };
}

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { user, organization } = useAuth();
  const storageKey = useMemo(() => {
    if (!user?.id || !organization?.id) return null;
    return `vimob_period_filter_${user.id}_${organization.id}`;
  }, [user?.id, organization?.id]);

  const [datePreset, setDatePresetInternal] = useState<DatePreset>(DEFAULT_FILTER_STATE.datePreset);
  const [customDateRange, setCustomDateRangeInternal] = useState<{ from: Date; to: Date } | null>(null);
  const [teamId, setTeamIdInternal] = useState<NullableFilter>(null);
  const [userId, setUserIdInternal] = useState<NullableFilter>(null);
  const [source, setSourceInternal] = useState<NullableFilter>(null);
  const [campaignId, setCampaignIdInternal] = useState<NullableFilter>(null);
  const [adSetId, setAdSetIdInternal] = useState<NullableFilter>(null);
  const [adId, setAdIdInternal] = useState<NullableFilter>(null);
  const [tagId, setTagIdInternal] = useState<NullableFilter>(null);
  const [dealStatus, setDealStatusInternal] = useState<NullableFilter>(null);
  const [searchQuery, setSearchQueryInternal] = useState('');

  const persist = useCallback(
    (patch: Partial<PersistedFilterState>) => {
      if (!storageKey) return;

      const current = parsePersistedState(sessionStorage.getItem(storageKey));
      sessionStorage.setItem(storageKey, JSON.stringify({ ...current, ...patch }));
    },
    [storageKey],
  );

  const applyState = useCallback((nextState: PersistedFilterState) => {
    setDatePresetInternal(nextState.datePreset);
    setCustomDateRangeInternal(parseCustomDateRange(nextState.customDateRange));
    setTeamIdInternal(nextState.teamId);
    setUserIdInternal(nextState.userId);
    setSourceInternal(nextState.source);
    setCampaignIdInternal(nextState.campaignId);
    setAdSetIdInternal(nextState.adSetId);
    setAdIdInternal(nextState.adId);
    setTagIdInternal(nextState.tagId);
    setDealStatusInternal(nextState.dealStatus);
    setSearchQueryInternal(nextState.searchQuery);
  }, []);

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      if (!storageKey) {
        applyState(DEFAULT_FILTER_STATE);
        return;
      }

      applyState(parsePersistedState(sessionStorage.getItem(storageKey)));
    });

    return () => {
      cancelled = true;
    };
  }, [applyState, storageKey]);

  const setDatePreset = useCallback(
    (preset: DatePreset) => {
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

  const setTagId = useCallback(
    (value: NullableFilter) => {
      setTagIdInternal(value);
      persist({ tagId: value });
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
      sessionStorage.setItem(storageKey, JSON.stringify(DEFAULT_FILTER_STATE));
    }
  }, [applyState, storageKey]);

  const clearDateFilter = useCallback(() => {
    setDatePreset('last30days');
    setCustomDateRange(null);
  }, [setCustomDateRange, setDatePreset]);

  const activeDateRange = useMemo(() => {
    if (datePreset === 'custom' && customDateRange) {
      return customDateRange;
    }
    return getDateRangeFromPreset(datePreset);
  }, [datePreset, customDateRange]);

  const value = useMemo(
    () => ({
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
      campaignId,
      setCampaignId,
      adSetId,
      setAdSetId,
      adId,
      setAdId,
      tagId,
      setTagId,
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
      searchQuery,
      setAdId,
      setAdSetId,
      setCampaignId,
      setCustomDateRange,
      setDatePreset,
      setDealStatus,
      setSearchQuery,
      setSource,
      setTagId,
      setTeamId,
      setUserId,
      source,
      tagId,
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
