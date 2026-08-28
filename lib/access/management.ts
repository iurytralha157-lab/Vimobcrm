export const MANAGEMENT_TABS = [
  "teams",
  "distribution",
  "pipelines",
  "tags",
] as const;

export type ManagementTab = (typeof MANAGEMENT_TABS)[number];

type ManagementTabAccess = {
  isAdmin: boolean;
  isTeamLeader: boolean;
  hasPermission: (permission: string) => boolean;
};

export function isManagementTab(value: string | null): value is ManagementTab {
  return !!value && (MANAGEMENT_TABS as readonly string[]).includes(value);
}

export function getAllowedManagementTabs(
  access: ManagementTabAccess,
): ManagementTab[] {
  if (access.isAdmin) return [...MANAGEMENT_TABS];

  const tabs: ManagementTab[] = [];
  const canManageTeams =
    access.isTeamLeader || access.hasPermission("team_manage");

  if (canManageTeams) {
    tabs.push("teams");
  }

  if (access.hasPermission("distribution_manage")) tabs.push("distribution");
  if (
    access.hasPermission("pipeline_manage") &&
    access.hasPermission("team_manage")
  ) {
    tabs.push("pipelines");
  }
  if (access.hasPermission("tag_manage")) tabs.push("tags");

  return tabs;
}

export function getSafeManagementTab(
  requestedTab: string | null,
  allowedTabs: readonly ManagementTab[],
): ManagementTab | null {
  if (isManagementTab(requestedTab) && allowedTabs.includes(requestedTab)) {
    return requestedTab;
  }

  return allowedTabs[0] ?? null;
}
