import {
  DEFAULT_AUTHENTICATED_ROUTE,
  FEATURES,
  type SystemModuleKey,
} from "../../config/constants";

export interface NavigationAccessItem {
  path: string;
  matchSection?: boolean;
  module?: SystemModuleKey;
  permission?: string;
  anyPermissions?: string[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  feature?: keyof typeof FEATURES;
  children?: NavigationAccessItem[];
}

export type NavigationAccess = {
  isSuperAdmin: boolean;
  canAccessAdminItems: boolean;
  canAccessFinancialModule: boolean;
  isTeamLeader: boolean;
  hasModule: (moduleName: SystemModuleKey) => boolean;
  hasPermission: (permission: string) => boolean;
};

const TEAM_LEADER_MANAGEMENT_PATHS = new Set([
  "/crm/management",
  "/crm/management?tab=teams",
]);

function canAccessItem(item: NavigationAccessItem, access: NavigationAccess) {
  if (item.feature && !FEATURES[item.feature]) return false;
  if (item.superAdminOnly && !access.isSuperAdmin) return false;
  if (item.module === "financial" && !access.canAccessFinancialModule)
    return false;
  if (item.module && !access.hasModule(item.module)) return false;
  if (item.adminOnly && !access.canAccessAdminItems) return false;
  if (item.permission && !access.hasPermission(item.permission)) return false;

  if (item.anyPermissions && !item.anyPermissions.some(access.hasPermission)) {
    return access.isTeamLeader && TEAM_LEADER_MANAGEMENT_PATHS.has(item.path);
  }

  return true;
}

export function filterNavigationItems<T extends NavigationAccessItem>(
  items: readonly T[],
  access: NavigationAccess,
): T[] {
  return items.flatMap((item) => {
    if (!canAccessItem(item, access)) return [];

    const filteredChildren = item.children
      ? filterNavigationItems(item.children, access)
      : undefined;

    return [
      {
        ...item,
        children: filteredChildren?.length ? filteredChildren : undefined,
      } as T,
    ];
  });
}

const MOBILE_PRIMARY_PATHS = [
  DEFAULT_AUTHENTICATED_ROUTE,
  "/crm/pipelines",
  "/dashboard",
  "/crm/contacts",
  "/agenda",
  "/properties",
  "/financeiro",
] as const;

export function selectMobileNavigationItems<T extends NavigationAccessItem>(
  items: readonly T[],
) {
  const byPath = new Map(items.map((item) => [item.path, item]));
  const primary = MOBILE_PRIMARY_PATHS.flatMap((path) => {
    const item = byPath.get(path);
    return item ? [selectMobileNavigationTarget(item)] : [];
  }).slice(0, 2);
  const secondaryItem = byPath.get("/crm/conversas");
  const secondary = secondaryItem
    ? selectMobileNavigationTarget(secondaryItem)
    : undefined;

  return { primary, secondary };
}

function selectMobileNavigationTarget<T extends NavigationAccessItem>(
  item: T,
): T {
  if (!item.children?.length) return item;

  const directChild = item.children.find((child) => child.path === item.path);
  return (directChild || item.children[0]) as T;
}

export type MobileFabAction =
  "lead" | "property" | "schedule" | "team" | "user";

type MobileFabAccess = {
  pathname: string;
  tab?: string | null;
  isBillingBlocked: boolean;
  hasPermission: (permission: string) => boolean;
};

const MOBILE_LEAD_CREATE_PATHS = new Set([
  "/dashboard",
  "/crm/pipelines",
  "/crm/contacts",
  "/crm/conversas",
]);

export function resolveMobileFabAction({
  pathname,
  tab,
  isBillingBlocked,
  hasPermission,
}: MobileFabAccess): MobileFabAction | null {
  if (isBillingBlocked) return null;
  if (pathname === "/properties")
    return hasPermission("property_manage") ? "property" : null;
  if (pathname === "/agenda")
    return hasPermission("schedule_manage") ? "schedule" : null;

  if (pathname === "/crm/management") {
    if ((!tab || tab === "teams") && hasPermission("team_manage"))
      return "team";
    return null;
  }

  if (pathname === "/settings") {
    return (tab === "team" || tab === "users") && hasPermission("users_manage")
      ? "user"
      : null;
  }

  return MOBILE_LEAD_CREATE_PATHS.has(pathname) && hasPermission("lead_create")
    ? "lead"
    : null;
}

export function getNavigationLocationKey(
  pathname: string,
  search: string | URLSearchParams,
  currentHash = "",
) {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const tab = params.get("tab");
  const hash = currentHash
    ? currentHash.startsWith("#")
      ? currentHash
      : `#${currentHash}`
    : "";
  const routeKey = tab
    ? `${pathname}?tab=${encodeURIComponent(tab)}`
    : pathname;

  return `${routeKey}${hash}`;
}

export function isNavigationPathActive(
  targetPath: string,
  pathname: string,
  search: string | URLSearchParams,
  options: { parent?: boolean; currentHash?: string } = {},
) {
  const [withoutHash, hash] = targetPath.split("#");
  const [basePath, queryString] = withoutHash.split("?");
  const targetParams = new URLSearchParams(queryString || "");
  const currentParams =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const tab = targetParams.get("tab");
  const currentHash = options.currentHash?.replace(/^#/, "") || "";

  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`))
    return false;
  if (tab) {
    if (pathname !== basePath) return false;
    const currentTab = currentParams.get("tab");
    return (
      currentTab === tab ||
      (!currentTab && basePath === "/crm/management" && tab === "teams") ||
      (!currentTab && basePath === "/automations" && tab === "automations") ||
      (!currentTab && basePath === "/settings" && tab === "account")
    );
  }
  if (hash) return pathname === basePath && currentHash === hash;
  if (options.parent) return true;
  if (currentParams.get("tab") && pathname === basePath) return false;
  if (currentHash && pathname === basePath) return false;
  return pathname === basePath;
}
