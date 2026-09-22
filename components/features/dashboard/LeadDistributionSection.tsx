import { Building2, RefreshCw, UserRoundX, UsersRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardLeadDistribution } from "@/hooks/use-dashboard-stats";

type LeadDistributionSectionProps = {
  data?: DashboardLeadDistribution;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  scopeLabel: string;
};

type DistributionRow = {
  id: string | null;
  kind: "entity" | "unassigned" | "other";
  name: string;
  leadCount: number;
  avatarUrl?: string | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts.length > 1 ? parts.at(-1)?.[0] || "" : "");
}

function DistributionSkeleton() {
  return (
    <div className="space-y-3" aria-label="Carregando distribuição de leads">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DistributionCard({
  title,
  description,
  rows,
  variant,
  isLoading,
}: {
  title: string;
  description: string;
  rows: DistributionRow[];
  variant: "user" | "team";
  isLoading: boolean;
}) {
  const maxCount = Math.max(1, ...rows.map((row) => row.leadCount));
  const Icon = variant === "user" ? UsersRound : Building2;
  const teamEntityRanks = new Map(
    rows
      .filter((row) => row.kind === "entity")
      .map((row, index) => [row.id, index + 1]),
  );

  return (
    <Card className="flex min-h-[360px] flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="shrink-0 px-4 pb-2 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              {title}
            </CardTitle>
            <p className="ml-10 mt-1 text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
              {description}
            </p>
          </div>
          {!isLoading && rows.length > 0 ? (
            <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]">
              {rows.length} {rows.length === 1 ? "grupo" : "grupos"}
            </span>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 px-4 pb-4 pt-2">
        {isLoading ? (
          <DistributionSkeleton />
        ) : rows.length === 0 ? (
          <div className="flex min-h-[250px] flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <UserRoundX className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
              Nenhum lead disponível para os filtros selecionados
            </p>
          </div>
        ) : (
          <div className="app-scrollbar max-h-[360px] space-y-2.5 overflow-y-auto pr-1">
            {rows.map((row) => {
              const percentage = Math.max(3, (row.leadCount / maxCount) * 100);
              const key = row.id || `${variant}-${row.kind}`;

              return (
                <div
                  key={key}
                  className="rounded-[7px] bg-[var(--app-surface-soft)] px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    {variant === "user" ? (
                      <Avatar className="h-9 w-9 border border-[var(--app-border)]">
                        <AvatarImage src={row.avatarUrl || undefined} alt={row.name} />
                        <AvatarFallback className="bg-primary/15 text-[10px] font-medium uppercase text-primary">
                          {initials(row.name)}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-medium text-violet-500">
                        {row.kind === "entity" ? teamEntityRanks.get(row.id) : "—"}
                      </span>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">
                          {row.name}
                        </span>
                        <span className="shrink-0 text-[12px] font-medium tabular-nums text-[var(--app-text-primary)]">
                          {row.leadCount.toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div
                        className="h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-hover)]"
                        role="progressbar"
                        aria-label={`${row.name}: ${row.leadCount} leads`}
                        aria-valuemin={0}
                        aria-valuemax={maxCount}
                        aria-valuenow={row.leadCount}
                      >
                        <div
                          className={
                            variant === "user"
                              ? "h-full rounded-full bg-primary transition-[width] duration-300"
                              : "h-full rounded-full bg-violet-500 transition-[width] duration-300"
                          }
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LeadDistributionSection({
  data,
  isLoading,
  isError,
  onRetry,
  scopeLabel,
}: LeadDistributionSectionProps) {
  if (isError) {
    return (
      <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardContent className="flex min-h-[112px] flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
              Não foi possível carregar a distribuição de leads.
            </p>
            <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">
              Os demais indicadores continuam disponíveis.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="h-8 gap-1.5 rounded-[6px] bg-primary/10 px-3 text-[11px] font-light text-primary hover:bg-primary/15 hover:text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const users = data?.users ?? [];
  const teams = data?.teams ?? [];
  const totalLeads = data?.totalLeads ?? 0;

  return (
    <section data-tour="dashboard-lead-distribution" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-[15px] font-normal text-[var(--app-text-primary)]">
            Distribuição de leads
          </h2>
          <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
            Responsáveis atuais e equipe registrada na atribuição
          </p>
        </div>
        {!isLoading ? (
          <span className="text-[11px] font-light text-[var(--app-text-secondary)]">
            {totalLeads.toLocaleString("pt-BR")} {totalLeads === 1 ? "lead" : "leads"} {scopeLabel}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DistributionCard
          title="Leads por corretor"
          description="Quantidade por responsável atual"
          rows={users}
          variant="user"
          isLoading={isLoading}
        />
        <DistributionCard
          title="Leads por equipe"
          description="Equipe da atribuição; entradas diretas ficam em Sem equipe"
          rows={teams}
          variant="team"
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}
