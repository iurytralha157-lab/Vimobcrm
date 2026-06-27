'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  toggleCollapsed: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const TABLET_MAX = 1024;

const STORAGE_KEY = 'sidebar-collapsed';

function getInitialCollapsed() {
  if (typeof window === 'undefined') return false;

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === 'true';
  } catch (error) {
    console.warn('[SidebarContext] Nao foi possivel ler o estado salvo:', error);
  }

  return window.innerWidth < TABLET_MAX;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(getInitialCollapsed);

  const setCollapsed = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, String(next));
        } catch (error) {
          console.warn('[SidebarContext] Nao foi possivel salvar o estado:', error);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const isTabletOrSmaller = window.innerWidth < TABLET_MAX;
      setCollapsed(prev => {
        // Only auto-collapse when entering tablet; don't force expand on desktop
        if (isTabletOrSmaller && !prev) return true;
        return prev;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [setCollapsed]);

  const toggleCollapsed = useCallback(() => setCollapsed(prev => !prev), [setCollapsed]);

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggleCollapsed }),
    [collapsed, setCollapsed, toggleCollapsed]
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
