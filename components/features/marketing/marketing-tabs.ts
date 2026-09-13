export const MARKETING_TABS = [
  {
    key: "overview",
    label: "Visão geral",
    description: "Resumo de mídia, aquisição e resultado comercial.",
  },
  {
    key: "paid",
    label: "Campanhas",
    description: "Desempenho detalhado das campanhas da Meta.",
  },
  {
    key: "media",
    label: "Mídia",
    description: "Criativos sincronizados e seus resultados.",
  },
  {
    key: "acquisition",
    label: "Aquisição",
    description: "Jornada dos anúncios até os resultados no CRM.",
  },
  {
    key: "social",
    label: "Social",
    description: "Conteúdo e audiência do Instagram profissional.",
  },
] as const;

export type MarketingTab = (typeof MARKETING_TABS)[number]["key"];
export type MarketingTabHrefs = Record<MarketingTab, string>;

export type MarketingSearchParams = Record<
  string,
  string | string[] | undefined
>;

const MARKETING_TAB_KEYS = new Set<string>(
  MARKETING_TABS.map((tab) => tab.key),
);

export function normalizeMarketingTab(
  value: string | string[] | undefined,
): MarketingTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && MARKETING_TAB_KEYS.has(candidate)
    ? (candidate as MarketingTab)
    : "overview";
}

export function buildMarketingTabHrefs(
  searchParams: MarketingSearchParams,
): MarketingTabHrefs {
  const preserved = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === "tab" || value === undefined) return;
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => preserved.append(key, item));
  });

  return MARKETING_TABS.reduce<MarketingTabHrefs>((hrefs, tab) => {
    const params = new URLSearchParams(preserved);
    params.set("tab", tab.key);
    params.sort();
    hrefs[tab.key] = `/marketing?${params.toString()}`;
    return hrefs;
  }, {} as MarketingTabHrefs);
}
