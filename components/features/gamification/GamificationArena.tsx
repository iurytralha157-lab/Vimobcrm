"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  ChevronDown,
  ClipboardCheck,
  Crown,
  DollarSign,
  FileText,
  Loader2,
  MessageSquare,
  Phone,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type DatePreset,
  getDateRangeFromPreset,
} from "@/hooks/use-dashboard-filters";
import {
  useGamificationRanking,
  type GamificationActionType,
  type GamificationRankingEntry,
} from "@/hooks/gamification";
import { cn } from "@/lib/utils";

import { formatNumber, getInitials } from "./gamification-domain";
import { EmptyPanel } from "./GamificationUi";

const rankLabels: Record<
  string,
  { label: string; icon: LucideIcon; iconColor?: string }
> = {
  geral: { label: "Geral", icon: Trophy },
  ligacoes: { label: "Ligações", icon: Phone },
  mensagens: { label: "Mensagens", icon: MessageSquare },
  propostas: { label: "Propostas", icon: FileText },
  vendas: { label: "Vendas", icon: DollarSign },
  reunioes: { label: "Reuniões", icon: Users },
  visitas: { label: "Visitas", icon: ClipboardCheck },
};

const eventTypesMap: Record<string, GamificationActionType[]> = {
  ligacoes: ["call_made"],
  mensagens: ["message_sent"],
  propostas: ["proposal_sent"],
  vendas: ["sale_closed", "contract_signed", "lost_lead_recovered"],
  reunioes: ["meeting_held", "meeting_scheduled"],
  visitas: ["visit_confirmed", "visit_scheduled"],
};

export function GamificationArena() {
  const [datePreset, setDatePreset] = useState<DatePreset | null>("thisMonth");
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date;
    to: Date;
  } | null>(null);
  const [rankType, setRankType] = useState<string>("geral");
  const [presetClock, setPresetClock] = useState<Date | null>(null);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const refreshAtMidnight = () => {
      const now = new Date();
      setPresetClock(now);
      const nextMidnight = new Date(now.getTime());
      nextMidnight.setHours(24, 0, 1, 0);
      timeout = setTimeout(
        refreshAtMidnight,
        nextMidnight.getTime() - now.getTime(),
      );
    };
    timeout = setTimeout(refreshAtMidnight, 0);
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, []);
  const needsPresetClock = Boolean(datePreset && datePreset !== "custom");
  const rankingFilters = useMemo(() => {
    let range: { from: Date; to: Date } | null = null;
    if (datePreset === "custom" && customDateRange) {
      range = customDateRange;
    } else if (datePreset && datePreset !== "custom" && presetClock) {
      range = getDateRangeFromPreset(datePreset);
    }

    return {
      from: range?.from.toISOString(),
      // The API uses a half-open interval; UI ranges are inclusive through the final millisecond.
      to: range ? new Date(range.to.getTime() + 1).toISOString() : undefined,
      actionTypes: rankType === "geral" ? [] : (eventTypesMap[rankType] ?? []),
    };
  }, [customDateRange, datePreset, presetClock, rankType]);
  const rankingQuery = useGamificationRanking(
    rankingFilters,
    !needsPresetClock || presetClock !== null,
  );
  const filteredRanking = rankingQuery.ranking ?? [];

  if (
    (needsPresetClock && presetClock === null) ||
    (rankingQuery.isLoading && !rankingQuery.ranking)
  ) {
    return (
      <div
        className="app-card flex min-h-[500px] items-center justify-center gap-3 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="h-5 w-5 animate-spin text-primary" /> Calculando
        classificação...
      </div>
    );
  }

  return (
    <div>
      {rankingQuery.error && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <span>Não foi possível calcular a classificação deste período.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void rankingQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      <section
        className={cn(
          "grid gap-4 overflow-visible transition-opacity xl:h-[calc(100vh-110px)] xl:min-h-0 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.75fr)] xl:overflow-hidden",
          rankingQuery.isFetching && filteredRanking.length > 0 && "opacity-70",
        )}
        aria-busy={rankingQuery.isFetching}
      >
        <PodiumStage ranking={filteredRanking} />
        <ClassificationPanel
          ranking={filteredRanking}
          datePreset={datePreset}
          setDatePreset={setDatePreset}
          customDateRange={customDateRange}
          setCustomDateRange={setCustomDateRange}
          rankType={rankType}
          setRankType={setRankType}
        />
      </section>
      {rankingQuery.isLoading && (
        <p className="sr-only" role="status">
          Calculando classificação...
        </p>
      )}
    </div>
  );
}

function PodiumStage({ ranking }: { ranking: GamificationRankingEntry[] }) {
  const first = ranking.find((entry) => entry.position === 1) ?? ranking[0];
  const second = ranking.find((entry) => entry.position === 2) ?? ranking[1];
  const third = ranking.find((entry) => entry.position === 3) ?? ranking[2];

  return (
    <section className="relative flex h-full min-h-[500px] flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-5 shadow-none sm:p-6 xl:min-h-0">
      {/* Title / Header */}
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/5 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-400">
            <Trophy className="h-5 w-5" />
          </div>
          <h2 className="text-base font-medium text-foreground sm:text-lg">
            Arena Imobiliária de Elite
          </h2>
        </div>
      </div>

      {ranking.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyPanel title="Sem pontuação registrada" />
        </div>
      ) : (
        <div className="relative mt-4 flex min-h-[320px] w-full shrink-0 flex-1 items-end justify-center gap-2 pb-8 sm:gap-6 md:gap-5">
          <PodiumSpot
            entry={second}
            place={2}
            tone="silver"
            className="w-[82px] sm:w-[170px] md:w-[200px] shrink-0"
          />
          <PodiumSpot
            entry={first}
            place={1}
            tone="gold"
            featured
            className="w-[100px] sm:w-[195px] md:w-[230px] shrink-0"
          />
          <PodiumSpot
            entry={third}
            place={3}
            tone="bronze"
            className="w-[74px] sm:w-[155px] md:w-[185px] shrink-0"
          />
        </div>
      )}
    </section>
  );
}

function PodiumSpot({
  entry,
  place,
  tone,
  featured = false,
  className,
}: {
  entry?: GamificationRankingEntry;
  place: 1 | 2 | 3;
  tone: "gold" | "silver" | "bronze";
  featured?: boolean;
  className?: string;
}) {
  const pedestalHeights = {
    gold: "h-[210px] sm:h-[250px] md:h-[270px]",
    silver: "h-[160px] sm:h-[180px] md:h-[200px]",
    bronze: "h-[120px] sm:h-[130px] md:h-[145px]",
  };

  const pedestalStyles = {
    gold: "border-t border-t-amber-400/50 border-x-0 border-b-0 bg-gradient-to-b from-amber-500/15 dark:from-amber-500/25 via-amber-500/3 dark:via-amber-500/8 to-transparent text-amber-750 dark:text-amber-300",
    silver:
      "border-t border-t-slate-300/40 border-x-0 border-b-0 bg-gradient-to-b from-slate-400/15 dark:from-slate-400/20 via-slate-400/3 dark:via-slate-400/6 to-transparent text-slate-700 dark:text-slate-100",
    bronze:
      "border-t border-t-orange-500/40 border-x-0 border-b-0 bg-gradient-to-b from-orange-600/15 dark:from-orange-600/20 via-orange-600/3 dark:via-orange-600/5 to-transparent text-orange-750 dark:text-orange-200",
  };

  const toneClasses = {
    gold: "border-amber-400",
    silver: "border-slate-300",
    bronze: "border-orange-600",
  };

  const avatarSizes = {
    gold: "h-20 w-20 sm:h-32 sm:w-32 md:h-36 md:w-36",
    silver: "h-16 w-16 sm:h-26 sm:w-26 md:h-30 md:w-30",
    bronze: "h-14 w-14 sm:h-22 sm:w-22 md:h-26 md:w-26",
  };

  if (!entry) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-end w-full",
          className,
        )}
      >
        <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-border/40 bg-[var(--app-surface-solid)] font-medium text-muted-foreground">
          {place}
        </div>
        <div
          className={cn(
            "z-0 mt-[-16px] flex w-full flex-col items-center justify-center rounded-[8px] border border-dashed border-border/20 p-4 text-center",
            pedestalHeights[tone],
          )}
        >
          <p className="text-xs font-normal text-muted-foreground/60">
            Aguardando...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-end w-full group",
        className,
      )}
    >
      {/* Avatar Container */}
      <div className="relative z-10">
        {featured && (
          <div className="absolute -top-7.5 left-1/2 -translate-x-1/2 w-full flex justify-center z-20 pointer-events-none">
            <Crown className="h-9 w-9 fill-amber-400 text-amber-400 animate-pulse" />
          </div>
        )}
        <Avatar
          className={cn(
            "border-4 bg-background",
            avatarSizes[tone],
            toneClasses[tone],
          )}
        >
          <AvatarImage src={entry.avatarUrl || undefined} />
          <AvatarFallback className="bg-[var(--app-surface-soft)] text-xl font-medium text-foreground">
            {getInitials(entry.name)}
          </AvatarFallback>
        </Avatar>

        {/* Badge Medal / Overlay */}
        {place === 1 && (
          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-2.5 py-0.5 text-[9px] font-medium text-amber-950 shadow-none">
            1º lugar
          </div>
        )}
        {place === 2 && (
          <div className="absolute -right-1 -top-1 flex h-7.5 w-7.5 items-center justify-center rounded-full border-2 border-slate-300 bg-[var(--app-surface-solid)] text-slate-700 shadow-none dark:text-slate-200">
            <Award className="h-4 w-4" />
          </div>
        )}
        {place === 3 && (
          <div className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-orange-850 shadow-none border-2 border-orange-300">
            <Award className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* Pedestal Column */}
      <div
        className={cn(
          "mt-[-28px] z-0 flex w-full flex-col items-center justify-end pb-5 pt-8 px-3 text-center rounded-t-xl rounded-b-lg transition-all duration-500 hover:brightness-110",
          pedestalHeights[tone],
          pedestalStyles[tone],
        )}
      >
        <p className="line-clamp-1 w-full px-1 text-xs font-medium text-foreground sm:text-sm">
          {entry.name}
        </p>

        <p
          className={cn(
            "mt-2 font-medium leading-none",
            featured
              ? "text-3xl sm:text-4xl text-amber-600 dark:text-amber-400"
              : place === 2
                ? "text-2xl sm:text-3xl text-slate-700 dark:text-slate-200"
                : "text-xl sm:text-2xl text-orange-600 dark:text-orange-300",
          )}
        >
          {formatNumber(entry.points)}
        </p>

        <p
          className={cn(
            "mt-1 text-[9px] font-normal",
            featured
              ? "text-amber-700 dark:text-amber-500/90"
              : place === 2
                ? "text-slate-500 dark:text-slate-400"
                : "text-orange-700 dark:text-orange-400/90",
          )}
        >
          {place === 1 ? "Campeão" : "Pontos"}
        </p>
      </div>
    </div>
  );
}

interface ClassificationPanelProps {
  ranking: GamificationRankingEntry[];
  datePreset: DatePreset | null;
  setDatePreset: (preset: DatePreset | null) => void;
  customDateRange: { from: Date; to: Date } | null;
  setCustomDateRange: (range: { from: Date; to: Date } | null) => void;
  rankType: string;
  setRankType: (rankType: string) => void;
}

function ClassificationPanel({
  ranking,
  datePreset,
  setDatePreset,
  customDateRange,
  setCustomDateRange,
  rankType,
  setRankType,
}: ClassificationPanelProps) {
  return (
    <section className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-5 shadow-none xl:min-h-0">
      {/* Header */}
      <div className="border-b border-border/5 pb-4 shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-medium text-foreground sm:text-lg">
              Classificação
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Period Filter Dropdown */}
            <DateFilterPopover
              datePreset={datePreset}
              onDatePresetChange={setDatePreset}
              customDateRange={customDateRange}
              onCustomDateRangeChange={setCustomDateRange}
              triggerClassName="h-9 gap-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors border-0 text-xs px-3"
              align="end"
            />

            {/* Rank Type Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-9 rounded-lg text-xs px-3 bg-secondary text-secondary-foreground hover:bg-secondary/80 flex items-center gap-1.5 border-0 select-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  {(() => {
                    const active = rankLabels[rankType] || rankLabels.geral;
                    const IconComponent = active.icon;
                    return (
                      <>
                        <IconComponent
                          className={cn("h-3.5 w-3.5", active.iconColor)}
                        />
                        <span>{active.label}</span>
                      </>
                    );
                  })()}
                  <ChevronDown className="h-3 w-3 ml-0.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44 rounded-[8px] border border-border/10 bg-popover"
              >
                {Object.entries(rankLabels).map(([key, item]) => {
                  const IconComponent = item.icon;
                  return (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => setRankType(key)}
                      className={cn(
                        "cursor-pointer rounded-lg text-xs flex items-center gap-2 m-0.5",
                        rankType === key &&
                          "bg-primary/10 font-medium text-primary",
                      )}
                    >
                      <IconComponent
                        className={cn("h-3.5 w-3.5", item.iconColor)}
                      />
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {ranking.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyPanel title="Nenhum participante encontrado" />
        </div>
      ) : (
        <div className="flex-1 space-y-0.5 overflow-y-auto app-scrollbar pr-1 mt-2 min-h-0">
          {ranking.map((entry) => (
            <ClassificationRow key={entry.userId} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function ClassificationRow({ entry }: { entry: GamificationRankingEntry }) {
  const rankBgColor =
    entry.position === 1
      ? "bg-amber-400 text-amber-950"
      : entry.position === 2
        ? "bg-slate-300 text-slate-900"
        : entry.position === 3
          ? "bg-orange-500 text-orange-950"
          : "bg-[var(--app-surface-soft)] text-muted-foreground";

  return (
    <div
      className={cn(
        "group flex min-h-[64px] items-center gap-3 rounded-lg border-b border-border/30 px-2 py-3 transition-colors hover:bg-[var(--app-surface-hover)]",
        entry.isCurrentUser && "bg-secondary/60",
      )}
    >
      {/* Position badge */}
      <div
        className={cn(
          "flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
          rankBgColor,
        )}
      >
        {entry.position}
      </div>

      {/* Avatar */}
      <Avatar className="h-10 w-10 shrink-0 border border-border/30">
        <AvatarImage src={entry.avatarUrl || undefined} />
        <AvatarFallback className="bg-[var(--app-surface-soft)] text-xs font-medium text-foreground">
          {getInitials(entry.name)}
        </AvatarFallback>
      </Avatar>

      {/* Broker Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {entry.name}
          </p>
          {entry.position === 1 && (
            <Crown className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
          )}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] font-normal text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {entry.rank}
        </p>
      </div>

      {/* Score / Points */}
      <div className="shrink-0 text-right pl-2">
        <p className="text-base font-medium text-foreground">
          {formatNumber(entry.points)}
        </p>
        <p className="mt-0.5 text-[9px] font-normal text-muted-foreground/80">
          pontos
        </p>
      </div>
    </div>
  );
}
