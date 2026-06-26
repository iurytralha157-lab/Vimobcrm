"use client";

import { FilterProvider } from '@/contexts/FilterContext';

export function FilterProviderWrapper({ children }: { children: React.ReactNode }) {
  return <FilterProvider>{children}</FilterProvider>;
}