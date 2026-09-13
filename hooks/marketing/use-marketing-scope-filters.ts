"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const ACCOUNT_QUERY_KEY = "accountId";
const OBJECTIVE_QUERY_KEY = "objective";
const MAX_SCOPE_VALUE_LENGTH = 255;

export interface MarketingScopeSelection {
  accountId: string | null;
  objective: string | null;
}

export function normalizeMarketingScopeValue(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (
    !normalized ||
    normalized.toLowerCase() === "all" ||
    normalized.length > MAX_SCOPE_VALUE_LENGTH
  ) {
    return null;
  }
  return normalized;
}

export function useMarketingScopeFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const serializedSearchParams = searchParams.toString();

  const accountId = normalizeMarketingScopeValue(
    searchParams.get(ACCOUNT_QUERY_KEY),
  );
  const objective = normalizeMarketingScopeValue(
    searchParams.get(OBJECTIVE_QUERY_KEY),
  );

  const replaceScopeParams = useCallback(
    (patch: Partial<MarketingScopeSelection>) => {
      const next = new URLSearchParams(serializedSearchParams);

      if (Object.hasOwn(patch, "accountId")) {
        const nextAccountId = normalizeMarketingScopeValue(patch.accountId);
        if (nextAccountId) next.set(ACCOUNT_QUERY_KEY, nextAccountId);
        else next.delete(ACCOUNT_QUERY_KEY);
      }

      if (Object.hasOwn(patch, "objective")) {
        const nextObjective = normalizeMarketingScopeValue(patch.objective);
        if (nextObjective) next.set(OBJECTIVE_QUERY_KEY, nextObjective);
        else next.delete(OBJECTIVE_QUERY_KEY);
      }

      next.sort();
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, serializedSearchParams],
  );

  const clearScope = useCallback(() => {
    const next = new URLSearchParams(serializedSearchParams);
    next.delete(ACCOUNT_QUERY_KEY);
    next.delete(OBJECTIVE_QUERY_KEY);
    next.sort();
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, serializedSearchParams]);

  const filters = useMemo<MarketingScopeSelection>(
    () => ({ accountId, objective }),
    [accountId, objective],
  );

  return {
    filters,
    accountId,
    objective,
    setAccountId: (value: string | null) =>
      replaceScopeParams({ accountId: value }),
    setObjective: (value: string | null) =>
      replaceScopeParams({ objective: value }),
    clearScope,
  };
}
