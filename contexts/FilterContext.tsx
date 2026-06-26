import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { DatePreset, getDateRangeFromPreset } from '@/hooks/use-dashboard-filters';

interface FilterContextType {
  datePreset: DatePreset;
  customDateRange: { from: Date; to: Date } | null;
  setDatePreset: (preset: DatePreset) => void;
  setCustomDateRange: (range: { from: Date; to: Date } | null) => void;
  clearDateFilter: () => void;
  activeDateRange: { from: Date; to: Date };
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { user, organization } = useAuth();
  const storageKey = useMemo(() => {
    if (!user?.id || !organization?.id) return null;
    return `vimob_period_filter_${user.id}_${organization.id}`;
  }, [user?.id, organization?.id]);

  const [datePreset, setDatePresetInternal] = useState<DatePreset>('last30days');
  const [customDateRange, setCustomDateRangeInternal] = useState<{ from: Date; to: Date } | null>(null);

  // Load from sessionStorage on mount or when storageKey changes
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled || !storageKey) return;
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.datePreset) setDatePresetInternal(parsed.datePreset);
          if (parsed.customDateRange) {
            setCustomDateRangeInternal({
              from: new Date(parsed.customDateRange.from),
              to: new Date(parsed.customDateRange.to)
            });
          }
        } catch (e) {
          console.error('Error parsing saved filters', e);
        }
      } else {
        // Reset to default if no saved filters for this user/org
          setDatePresetInternal('last30days');
          setCustomDateRangeInternal(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Save to sessionStorage
  const setDatePreset = (preset: DatePreset) => {
    setDatePresetInternal(preset);
    if (storageKey) {
      const current = sessionStorage.getItem(storageKey);
      const data = current ? JSON.parse(current) : {};
      sessionStorage.setItem(storageKey, JSON.stringify({ ...data, datePreset: preset, customDateRange: null }));
    }
    setCustomDateRangeInternal(null);
  };

  const setCustomDateRange = (range: { from: Date; to: Date } | null) => {
    setCustomDateRangeInternal(range);
    if (storageKey) {
      const current = sessionStorage.getItem(storageKey);
      const data = current ? JSON.parse(current) : {};
      sessionStorage.setItem(storageKey, JSON.stringify({
        ...data,
        datePreset: range ? 'custom' : data.datePreset,
        customDateRange: range
      }));
    }
  };

  const clearDateFilter = () => {
    setDatePreset('last30days');
    setCustomDateRange(null);
  };

  const activeDateRange = useMemo(() => {
    if (datePreset === 'custom' && customDateRange) {
      return customDateRange;
    }
    return getDateRangeFromPreset(datePreset);
  }, [datePreset, customDateRange]);

  return (
    <FilterContext.Provider value={{
      datePreset,
      customDateRange,
      setDatePreset,
      setCustomDateRange,
      clearDateFilter,
      activeDateRange
    }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (context === undefined) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return context;
}
