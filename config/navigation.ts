import type { NavigationAccessItem } from "../lib/access/navigation";
import { DEFAULT_AUTHENTICATED_ROUTE } from "./constants";

export type NavigationIconKey =
  | "activity"
  | "barChart"
  | "bellRing"
  | "bot"
  | "building"
  | "calendar"
  | "creditCard"
  | "dashboard"
  | "dollarSign"
  | "fileText"
  | "globe"
  | "history"
  | "home"
  | "kanban"
  | "mapPin"
  | "megaphone"
  | "messageSquare"
  | "plug"
  | "receipt"
  | "settings"
  | "shuffle"
  | "tags"
  | "trendingUp"
  | "trophy"
  | "users"
  | "zap";

export interface AppNavigationItem extends NavigationAccessItem {
  icon: NavigationIconKey;
  labelKey: string;
  children?: AppNavigationItem[];
}

export const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  {
    icon: "home",
    labelKey: "home",
    path: DEFAULT_AUTHENTICATED_ROUTE,
  },
  {
    icon: "dashboard",
    labelKey: "dashboard",
    path: "/dashboard",
    anyPermissions: [
      "dashboard_view",
      "dashboard_site_view",
      "dashboard_campaigns_view",
    ],
    children: [
      {
        icon: "dashboard",
        labelKey: "dashboardGeneral",
        path: "/dashboard",
        permission: "dashboard_view",
      },
      {
        icon: "globe",
        labelKey: "dashboardSite",
        path: "/dashboard/site",
        permission: "dashboard_site_view",
        module: "site",
      },
      {
        icon: "megaphone",
        labelKey: "marketing",
        path: "/marketing",
        matchSection: true,
        permission: "dashboard_campaigns_view",
        module: "campaigns",
      },
    ],
  },
  {
    icon: "kanban",
    labelKey: "pipelines",
    path: "/crm/pipelines",
    module: "crm",
    anyPermissions: ["lead_view_own", "lead_view_team", "lead_view_all"],
  },
  {
    icon: "messageSquare",
    labelKey: "conversations",
    path: "/crm/conversas",
    module: "whatsapp",
    permission: "whatsapp_view",
  },
  {
    icon: "users",
    labelKey: "contacts",
    path: "/crm/contacts",
    module: "crm",
    anyPermissions: ["lead_view_own", "lead_view_team", "lead_view_all"],
  },
  {
    icon: "shuffle",
    labelKey: "crmManagement",
    path: "/crm/management",
    module: "crm",
    anyPermissions: [
      "team_manage",
      "distribution_manage",
      "pipeline_manage",
      "tag_manage",
    ],
    children: [
      {
        icon: "users",
        labelKey: "managementTeams",
        path: "/crm/management?tab=teams",
        anyPermissions: ["team_manage"],
      },
      {
        icon: "shuffle",
        labelKey: "managementDistribution",
        path: "/crm/management?tab=distribution",
        permission: "distribution_manage",
      },
      {
        icon: "kanban",
        labelKey: "managementPipelines",
        path: "/crm/management?tab=pipelines",
        permission: "pipeline_manage",
      },
      {
        icon: "tags",
        labelKey: "managementTags",
        path: "/crm/management?tab=tags",
        permission: "tag_manage",
      },
    ],
  },
  {
    icon: "building",
    labelKey: "properties",
    path: "/properties",
    module: "properties",
    anyPermissions: ["property_view", "property_manage"],
    children: [
      {
        icon: "building",
        labelKey: "propertiesAll",
        path: "/properties",
        anyPermissions: ["property_view", "property_manage"],
      },
      {
        icon: "building",
        labelKey: "propertiesDevelopments",
        path: "/properties/developments",
        anyPermissions: ["property_view", "property_manage"],
      },
      {
        icon: "home",
        labelKey: "propertiesRentals",
        path: "/properties/rentals",
        anyPermissions: ["property_view", "property_manage"],
      },
      {
        icon: "building",
        labelKey: "propertiesCondos",
        path: "/properties/condominiums",
        permission: "property_manage",
      },
      {
        icon: "mapPin",
        labelKey: "propertiesLocations",
        path: "/properties/locations",
        permission: "property_manage",
      },
      {
        icon: "users",
        labelKey: "propertiesOwners",
        path: "/properties/owners",
        permission: "property_manage",
      },
    ],
  },
  {
    icon: "calendar",
    labelKey: "schedule",
    path: "/agenda",
    module: "agenda",
    permission: "schedule_view",
  },
  {
    icon: "zap",
    labelKey: "automations",
    path: "/automations",
    module: "automations",
    anyPermissions: ["automations_view", "automations_manage"],
    children: [
      {
        icon: "zap",
        labelKey: "automationList",
        path: "/automations?tab=automations",
        anyPermissions: ["automations_view", "automations_manage"],
      },
      {
        icon: "fileText",
        labelKey: "automationTemplates",
        path: "/automations?tab=templates",
        permission: "automations_manage",
      },
      {
        icon: "activity",
        labelKey: "automationHistory",
        path: "/automations?tab=history",
        anyPermissions: ["automations_view", "automations_manage"],
      },
    ],
  },
  {
    icon: "dollarSign",
    labelKey: "financial",
    path: "/financeiro",
    module: "financial",
    anyPermissions: ["financial_view", "financial_manage"],
    children: [
      {
        icon: "trendingUp",
        labelKey: "financialDashboard",
        path: "/financeiro",
      },
      { icon: "receipt", labelKey: "entries", path: "/financeiro/contas" },
      {
        icon: "fileText",
        labelKey: "contracts",
        path: "/financeiro/contratos",
      },
      {
        icon: "dollarSign",
        labelKey: "commissions",
        path: "/financeiro/comissoes",
      },
      { icon: "barChart", labelKey: "reports", path: "/financeiro/relatorios" },
      { icon: "barChart", labelKey: "dre", path: "/financeiro/dre" },
    ],
  },
  {
    icon: "trophy",
    labelKey: "arena",
    path: "/gamificacao",
    module: "gamification",
    anyPermissions: ["gamification_view", "gamification_manage"],
    children: [
      { icon: "trophy", labelKey: "arenaOverview", path: "/gamificacao" },
      {
        icon: "barChart",
        labelKey: "dashboard",
        path: "/gamificacao#dashboard",
      },
      { icon: "zap", labelKey: "arenaRanking", path: "/gamificacao#rankings" },
      { icon: "history", labelKey: "history", path: "/gamificacao#history" },
      {
        icon: "settings",
        labelKey: "arenaSettings",
        path: "/gamificacao#config",
        permission: "gamification_manage",
      },
    ],
  },
];

export const APP_BOTTOM_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  {
    icon: "settings",
    labelKey: "settings",
    path: "/settings",
    children: [
      {
        icon: "settings",
        labelKey: "settingsAccount",
        path: "/settings?tab=account",
      },
      {
        icon: "bellRing",
        labelKey: "settingsNotifications",
        path: "/settings?tab=notifications",
      },
      {
        icon: "users",
        labelKey: "settingsUsers",
        path: "/settings?tab=team",
        anyPermissions: ["users_manage", "permissions_manage"],
      },
      {
        icon: "creditCard",
        labelKey: "settingsBilling",
        path: "/settings?tab=subscription",
        permission: "settings_billing",
      },
      {
        icon: "plug",
        labelKey: "settingsIntegrations",
        path: "/settings?tab=integrations",
      },
      {
        icon: "bot",
        labelKey: "settingsAI",
        path: "/settings?tab=ai",
        module: "ai_agent",
        permission: "settings_ai",
      },
      {
        icon: "building",
        labelKey: "settingsProperties",
        path: "/settings?tab=properties",
        module: "properties",
        permission: "property_manage",
      },
      {
        icon: "globe",
        labelKey: "site",
        path: "/settings/site",
        matchSection: true,
        module: "site",
        permission: "settings_site",
      },
    ],
  },
];

export const BILLING_NAVIGATION_ITEM: AppNavigationItem = {
  icon: "creditCard",
  labelKey: "settingsBilling",
  path: "/settings?tab=subscription",
};
