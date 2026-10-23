'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  EMPTY_FILTER_PANEL_LAYOUT, FilterPanelLayoutCoordinator,
  type FilterPanelLayoutSnapshot, type FilterPanelRegistration,
} from '@/lib/filters/filter-panel-layout';

export type { FilterPanelCloseReason, FilterPanelRegistrationState } from '@/lib/filters/filter-panel-layout';
type FilterPanelLayoutValue = FilterPanelLayoutSnapshot & {
  registerPanel: (id: string) => FilterPanelRegistration;
  requestOpenChat: (callback: () => void) => boolean;
};

const noPanel = {
  ...EMPTY_FILTER_PANEL_LAYOUT,
  registerPanel: () => ({ update: () => {}, unregister: () => {} }),
  requestOpenChat: (callback: () => void) => { callback(); return true; },
};
const FilterPanelLayoutContext = createContext<FilterPanelLayoutValue>(noPanel);

function afterContentExit(callback: () => void) {
  let secondFrame = 0;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(callback);
  });
  return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
}

export function FilterPanelLayoutProvider({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  const coordinator = useMemo(() => {
    void scopeKey;
    return new FilterPanelLayoutCoordinator(afterContentExit);
  }, [scopeKey]);
  const layout = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, () => EMPTY_FILTER_PANEL_LAYOUT);
  useLayoutEffect(() => () => coordinator.reset(), [coordinator]);
  useEffect(() => {
    if (!layout.panelElement) return;
    const observer = new ResizeObserver(coordinator.refreshGeometry);
    observer.observe(layout.panelElement);
    window.addEventListener('resize', coordinator.refreshGeometry);
    return () => { observer.disconnect(); window.removeEventListener('resize', coordinator.refreshGeometry); };
  }, [coordinator, layout.panelElement]);
  const value = useMemo(() => ({
    ...layout, registerPanel: coordinator.registerPanel, requestOpenChat: coordinator.requestOpenChat,
  }), [coordinator, layout]);
  return <FilterPanelLayoutContext.Provider value={value}>{children}</FilterPanelLayoutContext.Provider>;
}

export function useFilterPanelLayout() { return useContext(FilterPanelLayoutContext); }
