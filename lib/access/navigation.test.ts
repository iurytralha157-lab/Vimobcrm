import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  APP_BOTTOM_NAVIGATION_ITEMS,
  APP_NAVIGATION_ITEMS,
} from "../../config/navigation";
import { DEFAULT_AUTHENTICATED_ROUTE } from "../../config/constants";

import {
  filterNavigationItems,
  getNavigationLocationKey,
  isNavigationPathActive,
  resolveMobileFabAction,
  selectMobileNavigationItems,
  type NavigationAccess,
  type NavigationAccessItem,
} from "./navigation";

const baseAccess: NavigationAccess = {
  isSuperAdmin: false,
  canAccessAdminItems: false,
  canAccessFinancialModule: false,
  isTeamLeader: false,
  hasModule: () => true,
  hasPermission: () => false,
};

function filterDashboardNavigation(
  enabledModules: readonly string[],
  permissions: readonly string[],
) {
  const dashboard = APP_NAVIGATION_ITEMS.find(
    (item) => item.path === "/dashboard",
  );
  const moduleSet = new Set(enabledModules);
  const permissionSet = new Set(permissions);

  return filterNavigationItems(dashboard ? [dashboard] : [], {
    ...baseAccess,
    hasModule: (module) => moduleSet.has(module),
    hasPermission: (permission) => permissionSet.has(permission),
  });
}

test("mantem a Central de Atencao fora do menu principal", () => {
  const attentionItems = APP_NAVIGATION_ITEMS.filter(
    (item) => item.path === "/attention",
  );

  assert.deepEqual(attentionItems, []);
});

test("mantem Marketing dentro do menu Dashboard somente com modulo e permissao", () => {
  const directMarketingItems = APP_NAVIGATION_ITEMS.filter(
    (item) => item.path === "/marketing",
  );
  const marketerNavigation = filterDashboardNavigation(
    ["campaigns"],
    ["dashboard_campaigns_view"],
  );

  const marketing = marketerNavigation[0]?.children?.[0];

  assert.deepEqual(directMarketingItems, []);
  assert.equal(marketing?.path, "/marketing");
  assert.equal(marketing?.module, "campaigns");
  assert.equal(marketing?.permission, "dashboard_campaigns_view");
  assert.equal(marketing?.matchSection, true);
  assert.deepEqual(
    filterDashboardNavigation([], ["dashboard_campaigns_view"]),
    [],
  );
  assert.deepEqual(filterDashboardNavigation(["campaigns"], []), []);
});

test("exibe Dashboard do Site somente para organizacao elegivel", () => {
  const eligibleNavigation = filterDashboardNavigation(
    ["site"],
    ["dashboard_site_view"],
  );
  const siteDashboard = eligibleNavigation[0]?.children?.[0];

  assert.equal(siteDashboard?.path, "/dashboard/site");
  assert.equal(siteDashboard?.module, "site");
  assert.equal(siteDashboard?.permission, "dashboard_site_view");
  assert.deepEqual(
    filterDashboardNavigation([], ["dashboard_site_view"]),
    [],
  );
  assert.deepEqual(filterDashboardNavigation(["site"], []), []);
});

test("preserva Dashboard geral sem liberar dashboards especializados", () => {
  const navigation = filterDashboardNavigation([], ["dashboard_view"]);

  assert.deepEqual(
    navigation[0]?.children?.map((item) => item.path),
    ["/dashboard"],
  );
});

test("rotas das dashboards repetem modulo e permissao do menu", () => {
  const siteRoute = readFileSync(
    resolve(process.cwd(), "app/(protected)/dashboard/site/page.tsx"),
    "utf8",
  );
  const marketingRoute = readFileSync(
    resolve(process.cwd(), "app/(protected)/marketing/page.tsx"),
    "utf8",
  );
  const legacyCampaignsRoute = readFileSync(
    resolve(process.cwd(), "app/(protected)/dashboard/campaigns/page.tsx"),
    "utf8",
  );

  assert.match(siteRoute, /module="site"/);
  assert.match(siteRoute, /permission="dashboard_site_view"/);
  assert.match(marketingRoute, /module="campaigns"/);
  assert.match(marketingRoute, /permission="dashboard_campaigns_view"/);
  assert.match(legacyCampaignsRoute, /redirect\("\/marketing"\)/);
});

test("pagina inicial abre o catalogo principal sem exigir modulo ou permissao", () => {
  const home = APP_NAVIGATION_ITEMS[0];

  assert.equal(home.path, DEFAULT_AUTHENTICATED_ROUTE);
  assert.equal(home.module, undefined);
  assert.equal(home.permission, undefined);
  assert.equal(home.anyPermissions, undefined);
});

test("mantem itens genericos quando a feature operacional esta ativa", () => {
  const items: NavigationAccessItem[] = [
    { path: "/dashboard" },
    { path: "/attention", feature: "ENABLE_ATTENTION_CENTER" },
  ];

  assert.deepEqual(
    filterNavigationItems(items, baseAccess).map((item) => item.path),
    ["/dashboard", "/attention"],
  );
});

test("libera somente as areas de gestao permitidas ao lider de equipe", () => {
  const items: NavigationAccessItem[] = [
    {
      path: "/crm/management",
      anyPermissions: ["team_manage", "pipeline_manage"],
      children: [
        { path: "/crm/management?tab=teams", anyPermissions: ["team_manage"] },
        {
          path: "/crm/management?tab=distribution",
          permission: "distribution_manage",
        },
        {
          path: "/crm/management?tab=pipelines",
          permission: "pipeline_manage",
        },
      ],
    },
  ];

  const result = filterNavigationItems(items, {
    ...baseAccess,
    isTeamLeader: true,
    hasPermission: (permission) => permission === "team_manage",
  });
  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0].children?.map((item) => item.path),
    ["/crm/management?tab=teams"],
  );
});

test("mantem modulos e itens administrativos sob suas regras atuais", () => {
  const items: NavigationAccessItem[] = [
    { path: "/properties", module: "properties" },
    { path: "/financeiro", module: "financial", adminOnly: true },
  ];

  const result = filterNavigationItems(items, {
    ...baseAccess,
    canAccessAdminItems: true,
    canAccessFinancialModule: true,
    hasModule: () => true,
  });

  assert.deepEqual(
    result.map((item) => item.path),
    ["/properties", "/financeiro"],
  );
});

test("menu de imoveis respeita as mesmas permissoes das paginas", () => {
  const properties = APP_NAVIGATION_ITEMS.filter(
    (item) => item.path === "/properties",
  );

  assert.deepEqual(filterNavigationItems(properties, baseAccess), []);

  const viewer = filterNavigationItems(properties, {
    ...baseAccess,
    hasPermission: (permission) => permission === "property_view",
  });
  assert.deepEqual(
    viewer[0]?.children?.map((item) => item.path),
    ["/properties", "/properties/launches", "/properties/rentals"],
  );

  const propertyManager = filterNavigationItems(properties, {
    ...baseAccess,
    hasPermission: (permission) => permission === "property_manage",
  });
  assert.deepEqual(
    propertyManager[0]?.children?.map((item) => item.path),
    [
      "/properties",
      "/properties/launches",
      "/properties/rentals",
      "/properties/condominiums",
      "/properties/locations",
      "/properties/owners",
    ],
  );

  const organizationSettingsManager = filterNavigationItems(properties, {
    ...baseAccess,
    hasPermission: (permission) => permission === "settings_organization",
  });
  assert.deepEqual(
    organizationSettingsManager[0]?.children?.map((item) => item.path),
    ["/properties/settings"],
  );

  const fullManagerPermissions = new Set([
    "property_manage",
    "settings_organization",
  ]);
  const fullManager = filterNavigationItems(properties, {
    ...baseAccess,
    hasPermission: (permission) => fullManagerPermissions.has(permission),
  });
  assert.deepEqual(
    fullManager[0]?.children?.map((item) => item.path),
    [
      "/properties",
      "/properties/launches",
      "/properties/rentals",
      "/properties/condominiums",
      "/properties/locations",
      "/properties/owners",
      "/properties/settings",
    ],
  );
});

test("catalogo principal repete as permissoes declaradas nas rotas", () => {
  const restrictedPaths = [
    "/crm/pipelines",
    "/crm/conversas",
    "/crm/contacts",
    "/agenda",
    "/automations",
    "/financeiro",
    "/gamificacao",
  ];
  const withoutPermissions = filterNavigationItems(APP_NAVIGATION_ITEMS, {
    ...baseAccess,
    canAccessFinancialModule: true,
  });
  assert.equal(
    withoutPermissions.some((item) => restrictedPaths.includes(item.path)),
    false,
  );

  const granted = new Set([
    "lead_view_own",
    "attention_view",
    "whatsapp_view",
    "schedule_view",
    "automations_manage",
    "financial_manage",
    "gamification_view",
  ]);
  const withPermissions = filterNavigationItems(APP_NAVIGATION_ITEMS, {
    ...baseAccess,
    canAccessFinancialModule: true,
    hasPermission: (permission) => granted.has(permission),
  });
  assert.deepEqual(
    withPermissions
      .filter((item) => restrictedPaths.includes(item.path))
      .map((item) => item.path),
    restrictedPaths,
  );
});

test("agenda expõe calendário e dashboard no mesmo grupo", () => {
  const agenda = APP_NAVIGATION_ITEMS.find((item) => item.path === "/agenda");

  assert.deepEqual(
    agenda?.children?.map((item) => item.path),
    ["/agenda", "/agenda?tab=dashboard"],
  );
  assert.equal(isNavigationPathActive("/agenda", "/agenda", ""), true);
  assert.equal(
    isNavigationPathActive(
      "/agenda?tab=dashboard",
      "/agenda",
      "tab=dashboard",
    ),
    true,
  );
  assert.equal(
    isNavigationPathActive("/agenda", "/agenda", "tab=dashboard"),
    false,
  );
  assert.equal(
    resolveMobileFabAction({
      pathname: "/agenda",
      tab: "dashboard",
      isBillingBlocked: false,
      hasPermission: () => true,
    }),
    null,
  );
});

test("permissoes individuais liberam configuracoes sem depender do cargo", () => {
  const items: NavigationAccessItem[] = [
    { path: "/settings?tab=subscription", permission: "settings_billing" },
    { path: "/settings/site", permission: "settings_site", module: "site" },
    {
      path: "/settings?tab=integrations",
      anyPermissions: [
        "settings_integrations",
        "whatsapp_manage",
        "settings_ai",
      ],
    },
  ];
  const granted = new Set(["settings_site", "whatsapp_manage"]);

  const result = filterNavigationItems(items, {
    ...baseAccess,
    hasModule: () => true,
    hasPermission: (permission) => granted.has(permission),
  });

  assert.deepEqual(
    result.map((item) => item.path),
    ["/settings/site", "/settings?tab=integrations"],
  );
});

test("configuracoes expoe no menu lateral somente as abas autorizadas", () => {
  const result = filterNavigationItems(APP_BOTTOM_NAVIGATION_ITEMS, baseAccess);
  const settings = result.find((item) => item.path === "/settings");

  assert.equal(settings?.path, "/settings");
  assert.deepEqual(
    settings?.children?.map((item) => item.path),
    [
      "/settings?tab=account",
      "/settings?tab=notifications",
      "/settings?tab=integrations",
    ],
  );
});

test("configuracoes mantem todas as abas reais para quem tem acesso", () => {
  const result = filterNavigationItems(APP_BOTTOM_NAVIGATION_ITEMS, {
    ...baseAccess,
    hasModule: () => true,
    hasPermission: () => true,
  });
  const settings = result.find((item) => item.path === "/settings");

  assert.deepEqual(
    settings?.children?.map((item) => item.path),
    [
      "/settings?tab=account",
      "/settings?tab=notifications",
      "/settings?tab=team",
      "/settings?tab=subscription",
      "/settings?tab=integrations",
      "/settings?tab=ai",
      "/settings/site",
    ],
  );
});
test("navegacao mobile usa somente itens ja autorizados", () => {
  const result = selectMobileNavigationItems([
    { path: "/crm/pipelines" },
    { path: "/crm/contacts" },
    { path: "/crm/conversas" },
  ]);

  assert.deepEqual(
    result.primary.map((item) => item.path),
    ["/crm/pipelines", "/crm/contacts"],
  );
  assert.equal(result.secondary?.path, "/crm/conversas");
  assert.equal(
    result.primary.some((item) => item.path === "/dashboard"),
    false,
  );
});

test("navegacao mobile prioriza pagina inicial e pipeline quando autorizadas", () => {
  const result = selectMobileNavigationItems([
    { path: "/crm/contacts" },
    { path: "/dashboard" },
    { path: "/crm/pipelines" },
    { path: DEFAULT_AUTHENTICATED_ROUTE },
  ]);

  assert.deepEqual(
    result.primary.map((item) => item.path),
    [DEFAULT_AUTHENTICATED_ROUTE, "/crm/pipelines"],
  );
});

test("navegacao mobile usa rota filha quando o pai nao e acessivel diretamente", () => {
  const result = selectMobileNavigationItems([
    { path: DEFAULT_AUTHENTICATED_ROUTE },
    {
      path: "/dashboard",
      children: [{ path: "/dashboard/site" }, { path: "/marketing" }],
    },
  ]);

  assert.deepEqual(
    result.primary.map((item) => item.path),
    [DEFAULT_AUTHENTICATED_ROUTE, "/dashboard/site"],
  );
});

test("acao central mobile existe apenas quando a pagina e a permissao combinam", () => {
  const permissions = new Set<string>();
  const resolve = (pathname: string, tab?: string | null) =>
    resolveMobileFabAction({
      pathname,
      tab,
      isBillingBlocked: false,
      hasPermission: (permission) => permissions.has(permission),
    });

  assert.equal(resolve("/crm/pipelines"), null);
  permissions.add("lead_create");
  assert.equal(resolve("/crm/pipelines"), "lead");
  assert.equal(resolve("/settings", "account"), null);

  permissions.add("property_manage");
  assert.equal(resolve("/properties"), "property");
  assert.equal(resolve("/properties/new"), null);

  permissions.add("team_manage");
  assert.equal(resolve("/crm/management"), "team");
  assert.equal(resolve("/crm/management", "tags"), null);

  permissions.add("distribution_manage");
  assert.equal(resolve("/crm/management", "distribution"), null);

  assert.equal(
    resolveMobileFabAction({
      pathname: "/crm/pipelines",
      isBillingBlocked: true,
      hasPermission: () => true,
    }),
    null,
  );
});

test("rota ativa reconhece caminhos filhos e abas padrao", () => {
  assert.equal(
    isNavigationPathActive("/dashboard", "/marketing", "", { parent: true }),
    false,
  );
  assert.equal(
    isNavigationPathActive("/marketing", "/marketing", "tab=paid", {
      parent: true,
    }),
    true,
  );
  assert.equal(
    isNavigationPathActive("/properties", "/properties/owners", "", {
      parent: true,
    }),
    true,
  );
  assert.equal(
    isNavigationPathActive("/settings?tab=account", "/settings", ""),
    true,
  );
  assert.equal(
    isNavigationPathActive("/settings?tab=team", "/settings", "tab=team"),
    true,
  );
  assert.equal(
    isNavigationPathActive("/settings", "/settings", "tab=team"),
    false,
  );
  assert.equal(
    isNavigationPathActive("/settings?tab=account", "/settings/users/123", ""),
    false,
  );
  assert.equal(
    isNavigationPathActive(
      "/settings?tab=account",
      "/settings/users/123",
      "tab=account",
    ),
    false,
  );
  assert.equal(
    isNavigationPathActive("/gamificacao#history", "/gamificacao", "", {
      currentHash: "#history",
    }),
    true,
  );
  assert.equal(
    isNavigationPathActive("/gamificacao#config", "/gamificacao", "", {
      currentHash: "#history",
    }),
    false,
  );
  assert.equal(
    isNavigationPathActive("/gamificacao", "/gamificacao", "", {
      currentHash: "#history",
    }),
    false,
  );
  assert.equal(
    isNavigationPathActive("/gamificacao", "/gamificacao", "", {
      parent: true,
      currentHash: "#history",
    }),
    true,
  );
});

test("chave de localizacao muda em navegacao por rota e por aba", () => {
  assert.equal(getNavigationLocationKey("/settings", ""), "/settings");
  assert.equal(
    getNavigationLocationKey("/settings", "tab=team"),
    "/settings?tab=team",
  );
  assert.equal(
    getNavigationLocationKey("/gamificacao", "", "#history"),
    "/gamificacao#history",
  );
  assert.notEqual(
    getNavigationLocationKey("/settings", "tab=account"),
    getNavigationLocationKey("/settings", "tab=team"),
  );
});

test("chave de localizacao ignora filtros que nao representam outra pagina", () => {
  assert.equal(
    getNavigationLocationKey("/crm/contacts", "search=maria&page=2"),
    "/crm/contacts",
  );
  assert.equal(
    getNavigationLocationKey("/settings", "tab=team&search=maria&page=2"),
    "/settings?tab=team",
  );
});
