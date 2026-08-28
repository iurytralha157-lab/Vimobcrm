export const MARKETING_TABS = [
  {
    key: "overview",
    label: "Visão geral",
    description: "Resumo de mídia, aquisição e resultado comercial.",
  },
  {
    key: "acquisition",
    label: "Aquisição",
    description: "Jornada dos anúncios até os resultados no CRM.",
  },
  {
    key: "paid",
    label: "Tráfego pago",
    description: "Campanhas, investimento e eficiência da Meta.",
  },
  {
    key: "media",
    label: "Mídia",
    description: "Criativos sincronizados e seus resultados.",
  },
  {
    key: "social",
    label: "Social",
    description: "Presença orgânica do Facebook e Instagram.",
  },
  {
    key: "relationship",
    label: "Relacionamento",
    description: "Conversas atribuídas e acompanhamento da base.",
  },
  {
    key: "reputation",
    label: "Reputação",
    description: "Menções, sentimento e percepção da marca.",
  },
  {
    key: "intelligence",
    label: "Inteligência",
    description: "Eficiência comercial e retorno dos investimentos.",
  },
] as const;

export type MarketingTab = (typeof MARKETING_TABS)[number]["key"];
export type MarketingTabHrefs = Record<MarketingTab, string>;

export type MarketingSearchParams = Record<
  string,
  string | string[] | undefined
>;

const MARKETING_TAB_KEYS = new Set<string>(MARKETING_TABS.map((tab) => tab.key));

export function normalizeMarketingTab(value: string | string[] | undefined): MarketingTab {
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
