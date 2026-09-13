"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Radio, Shuffle, Users } from "lucide-react";

import { useEnhancedDashboardStats } from "@/hooks/use-dashboard-stats";
import type { MemberAvailability } from "@/hooks/use-member-availability";
import { useOrganizationPresenceList } from "@/hooks/presence";
import { useTeamDistributionStats } from "@/hooks/use-teams";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import type { Team, TeamDistributionStats } from "@/lib/api/teams";

const REFERENCE_TIME_ZONE = "America/Sao_Paulo";
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const REFERENCE_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: REFERENCE_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const COVERAGE_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: REFERENCE_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "short",
});

type TeamOperationalOverviewProps = {
  team: Team;
  availability: MemberAvailability[];
  activeUserIds?: ReadonlySet<string>;
};

function parseTimeToMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getReferenceClock(date: Date) {
  const parts = REFERENCE_CLOCK_FORMATTER.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value || 0,
  );

  return {
    dayOfWeek: WEEKDAY_INDEX[weekday] ?? date.getDay(),
    minutes: hour * 60 + minute,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function isMemberAvailableNow(
  availability: MemberAvailability[],
  clock: ReturnType<typeof getReferenceClock>,
) {
  if (availability.length === 0) return true;
  const today = availability.find(
    (entry) => entry.day_of_week === clock.dayOfWeek,
  );
  if (today?.is_active) {
    if (today.is_all_day) return true;

    const start = parseTimeToMinutes(today.start_time);
    const end = parseTimeToMinutes(today.end_time);
    if (start !== null && end !== null && start !== end) {
      if (start < end && clock.minutes >= start && clock.minutes <= end) {
        return true;
      }
      if (start > end && clock.minutes >= start) return true;
    }
  }

  const previousDay = (clock.dayOfWeek + 6) % 7;
  const previous = availability.find(
    (entry) => entry.day_of_week === previousDay,
  );
  if (!previous?.is_active || previous.is_all_day) return false;

  const previousStart = parseTimeToMinutes(previous.start_time);
  const previousEnd = parseTimeToMinutes(previous.end_time);
  return (
    previousStart !== null &&
    previousEnd !== null &&
    previousStart > previousEnd &&
    clock.minutes <= previousEnd
  );
}

function distributionMetricTitle(stats: TeamDistributionStats) {
  const eventLabel = stats.totalEvents === 1 ? "evento" : "eventos";
  const leadLabel = stats.uniqueLeads === 1 ? "lead único" : "leads únicos";
  const redistributionLabel =
    stats.redistributionEvents === 1 ? "redistribuição" : "redistribuições";
  const details = `${stats.totalEvents} ${eventLabel}, ${stats.uniqueLeads} ${leadLabel} e ${stats.redistributionEvents} ${redistributionLabel}.`;

  if (stats.coverage === "complete") {
    return `Histórico completo desta equipe. ${details}`;
  }

  const completeSince = new Date(stats.completeSince);
  const coverageBoundary = Number.isNaN(completeSince.getTime())
    ? "o marco de captura"
    : COVERAGE_DATE_FORMATTER.format(completeSince);
  return `Valor mínimo comprovado. ${details} A captura é completa desde ${coverageBoundary}; eventos anteriores podem não estar incluídos.`;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  title,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  title?: string;
}) {
  return (
    <div
      className="min-w-0 rounded-[8px] bg-[var(--app-surface-solid)] p-2.5"
      title={title}
      aria-label={`${label}: ${value}${title ? `. ${title}` : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-light uppercase tracking-[0.08em] text-[var(--app-text-tertiary)]">
            {label}
          </p>
          <p className="mt-1 text-[22px] font-normal leading-none text-[var(--app-text-primary)]">
            {value}
          </p>
        </div>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

export function TeamOperationalOverview({
  team,
  availability,
  activeUserIds,
}: TeamOperationalOverviewProps) {
  const [now, setNow] = useState<Date | null>(null);
  const members = useMemo(
    () =>
      (team.members || []).filter(
        (member) => !activeUserIds || activeUserIds.has(member.user_id),
      ),
    [activeUserIds, team.members],
  );
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canViewDashboard =
    !permissionsLoading && hasPermission("dashboard_view");
  const presenceQuery = useOrganizationPresenceList({
    enabled: members.length > 0,
  });
  const dashboardQuery = useEnhancedDashboardStats(
    { teamId: team.id },
    { enabled: canViewDashboard },
  );
  const distributionStatsQuery = useTeamDistributionStats(team.id);

  useEffect(() => {
    // Keep the server and first client render deterministic, then start the live clock.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const clock = now ? getReferenceClock(now) : null;
  const memberUserIds = useMemo(
    () => new Set(members.map((member) => member.user_id)),
    [members],
  );
  const availabilityByMemberId = useMemo(() => {
    const grouped = new Map<string, MemberAvailability[]>();
    for (const entry of availability) {
      const current = grouped.get(entry.team_member_id) || [];
      current.push(entry);
      grouped.set(entry.team_member_id, current);
    }
    return grouped;
  }, [availability]);
  const presenceByUserId = useMemo(
    () =>
      new Map(
        (presenceQuery.data?.users || [])
          .filter((user) => memberUserIds.has(user.user_id))
          .map((user) => [user.user_id, user]),
      ),
    [memberUserIds, presenceQuery.data?.users],
  );
  const availableNow = clock
    ? members.filter((member) =>
        isMemberAvailableNow(
          availabilityByMemberId.get(member.id) || [],
          clock,
        ),
      ).length
    : null;
  const onlineNow = Array.from(presenceByUserId.values()).filter(
    (user) => user.presence_status === "online",
  ).length;
  const presenceValue =
    members.length === 0
      ? 0
      : presenceQuery.canViewPresence
        ? presenceQuery.isPending
          ? "…"
          : presenceQuery.isError
            ? "—"
            : onlineNow
        : "—";
  const teamLeadsValue = canViewDashboard
    ? dashboardQuery.isPending
      ? "…"
      : dashboardQuery.isError
        ? "—"
        : dashboardQuery.data?.totalLeads || 0
    : "—";
  const distributionStats = distributionStatsQuery.data;
  const distributionValue = distributionStatsQuery.isPending
    ? "…"
    : distributionStatsQuery.isError || !distributionStats
      ? "—"
      : `${distributionStats.totalEvents}${distributionStats.coverage === "partial" ? "+" : ""}`;
  const distributionTitle = distributionStatsQuery.isError
    ? "Não foi possível carregar as distribuições desta equipe."
    : distributionStats
      ? distributionMetricTitle(distributionStats)
      : "Carregando distribuições e redistribuições.";

  return (
    <section
      className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5"
      aria-label="Indicadores da equipe"
    >
      <MetricCard icon={Users} label="Membros" value={members.length} />
      <MetricCard icon={Radio} label="Online agora" value={presenceValue} />
      <MetricCard
        icon={Clock3}
        label="Em horário"
        value={availableNow ?? "…"}
      />
      <MetricCard
        icon={Activity}
        label="Leads (30 dias)"
        value={teamLeadsValue}
      />
      <MetricCard
        icon={Shuffle}
        label="Distribuições"
        value={distributionValue}
        title={distributionTitle}
      />
    </section>
  );
}
