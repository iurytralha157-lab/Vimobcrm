export const SITE_TABS = [
  { key: "overview", label: "Visão geral", description: "Resumo de visitas, contatos e imóveis em destaque." },
  { key: "pages", label: "Páginas", description: "Desempenho de cada página e o que buscam no site." },
  { key: "properties", label: "Imóveis", description: "Imóveis mais vistos e seus contatos." },
  { key: "origins", label: "Origens", description: "Canais, campanhas, cidades e dispositivos das visitas." },
  { key: "journeys", label: "Jornadas", description: "O que os visitantes fazem até o primeiro contato." },
] as const;

export type SiteTab = (typeof SITE_TABS)[number]["key"];
export type SiteTabHrefs = Record<SiteTab, string>;
export type SiteSearchParams = Record<string, string | string[] | undefined>;

const SITE_TAB_KEYS = new Set<string>(SITE_TABS.map((tab) => tab.key));

export function normalizeSiteTab(value: string | string[] | undefined): SiteTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && SITE_TAB_KEYS.has(candidate) ? (candidate as SiteTab) : "overview";
}

export function buildSiteTabHrefs(searchParams: SiteSearchParams): SiteTabHrefs {
  const preserved = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === "tab" || value === undefined) return;
    (Array.isArray(value) ? value : [value]).forEach((item) => preserved.append(key, item));
  });
  return SITE_TABS.reduce<SiteTabHrefs>((hrefs, tab) => {
    const params = new URLSearchParams(preserved);
    params.set("tab", tab.key);
    params.sort();
    hrefs[tab.key] = `/dashboard/site?${params.toString()}`;
    return hrefs;
  }, {} as SiteTabHrefs);
}
