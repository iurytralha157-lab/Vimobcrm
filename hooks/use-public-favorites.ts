import { useState, useEffect, useCallback } from 'react';
import { trackFavorite } from '@/hooks/use-site-analytics';

const STORAGE_KEY = 'public_site_favorites';
const SYNC_EVENT = 'public_favorites_changed';

function getFavorites(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id: unknown) => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

export function usePublicFavorites(organizationId?: string) {
  const [favorites, setFavorites] = useState<string[]>(getFavorites);

  useEffect(() => {
    const syncFromStorage = () => {
      setFavorites(getFavorites());
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) syncFromStorage();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(SYNC_EVENT, syncFromStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(SYNC_EVENT, syncFromStorage);
    };
  }, []);

  const toggleFavorite = useCallback((propertyId: string) => {
    const current = getFavorites();
    const isAdding = !current.includes(propertyId);
    const next = isAdding
      ? [...current, propertyId]
      : current.filter(id => id !== propertyId);
    saveFavorites(next);
    setFavorites(next);

    // Track favorite event for analytics (only when adding)
    if (isAdding && organizationId) {
      trackFavorite(organizationId, propertyId);
    }
  }, [organizationId]);

  const isFavorite = useCallback((propertyId: string) => {
    return favorites.includes(propertyId);
  }, [favorites]);

  return { favorites, toggleFavorite, isFavorite, count: favorites.length };
}
