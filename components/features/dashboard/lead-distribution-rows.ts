import type { DashboardLeadDistribution } from "@/hooks/use-dashboard-stats";

type DistributionUser = DashboardLeadDistribution["users"][number];

export type VisibleBrokerDistributionRow = {
  id: string;
  kind: "entity" | "unassigned";
  name: string;
  leadCount: number;
  avatarUrl: string | null;
};

export function visibleBrokerDistributionRows(
  users: DistributionUser[] | undefined,
  selectedUserId?: string | null,
): VisibleBrokerDistributionRow[] {
  const showUnassigned = selectedUserId === "unassigned";
  const selectedBrokerId = selectedUserId && selectedUserId !== "all" && !showUnassigned
    ? selectedUserId
    : null;

  return (users ?? [])
    .filter((row) => row.leadCount > 0 && (
      showUnassigned
        ? row.kind === "unassigned" && row.id === null
        : row.kind === "entity" && row.id !== null && (!selectedBrokerId || row.id === selectedBrokerId)
    ))
    .map((row) => ({
      id: showUnassigned ? "unassigned" : row.id!,
      kind: showUnassigned ? "unassigned" as const : "entity" as const,
      name: row.name,
      leadCount: row.leadCount,
      avatarUrl: row.avatarUrl,
    }))
    .sort((a, b) => b.leadCount - a.leadCount || a.name.localeCompare(b.name, "pt-BR"));
}
