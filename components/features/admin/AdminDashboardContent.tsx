"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  CreditCard,
  Inbox,
  Users,
} from "lucide-react";

import { VimobLoader } from "@/components/shared/loading";
import { Badge } from "@/components/ui/badge";
import {
  useDashboardFeed,
  useDashboardOverview,
  useDashboardPendingBoards,
  useDashboardTimeseries,
  type DashboardPeriod,
} from "@/hooks/use-admin-dashboard";
import { cn } from "@/lib/utils";
import { AdminWarning, KpiCard } from "@/components/features/admin/AdminPrimitives";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatRecordsCount,
  getErrorMessage,
} from "@/components/features/admin/admin-display";

function formatDateOnly(value: unknown) {
  if (!value || typeof value !== "string") return "--";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatPercent(value: unknown) {
  const numericValue = Number(value || 0);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const formatted = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(safeValue);
  return `${safeValue > 0 ? "+" : ""}${formatted}%`;
}

function DashboardRow({ title, detail, badge }: { title: string; detail: string; badge: string }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-[var(--app-surface-hover)]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Badge className="shrink-0 border-0 bg-[var(--app-surface-soft)] text-muted-foreground">
        {badge}
      </Badge>
    </div>
  );
}

function DashboardRowsCard<T>({
  title,
  rows,
  empty,
  renderRow,
}: {
  title: string;
  rows: T[];
  empty: string;
  renderRow: (row: T, index: number) => ReactNode;
}) {
  return (
    <div className="app-card overflow-hidden">
      <div className="border-b border-[var(--app-border)] px-4 py-3">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{formatRecordsCount(rows.length)}</p>
      </div>
      {rows.length > 0 ? (
        <div className="divide-y divide-[var(--app-border)]">
          {rows.map((row, index) => (
            <div key={index}>{renderRow(row, index)}</div>
          ))}
        </div>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}

function StatusTile({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  tone: "success" | "warning" | "danger";
}) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  const color = tone === "success" ? "bg-emerald-500" : tone === "warning" ? "bg-amber-500" : "bg-destructive";

  return (
    <div className="app-card-soft p-2.5 sm:p-4">
      <p className="truncate text-[11px] text-muted-foreground sm:text-sm">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="truncate text-xl font-medium sm:text-2xl">{formatNumber(value)}</p>
        <p className="pb-0.5 text-xs font-medium sm:text-sm">{percentage}%</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-hover)] sm:mt-4 sm:h-2">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export function AdminDashboardContent() {
  const [period, setPeriod] = useState<DashboardPeriod>(30);
  const overview = useDashboardOverview(period);
  const timeseries = useDashboardTimeseries(period);
  const pendingBoards = useDashboardPendingBoards();
  const feed = useDashboardFeed(24);

  const data = overview.data;
  const financial = data?.financial;
  const platform = data?.platform;
  const operational = data?.operational;
  const health = timeseries.data?.health;
  const isLoading = overview.isLoading || timeseries.isLoading || pendingBoards.isLoading || feed.isLoading;
  const errorMessage = [overview.error, timeseries.error, pendingBoards.error, feed.error].find(Boolean);
  const periodLabel = `${period} dias`;

  return (
    <div className="space-y-4">
      <AdminWarning message={errorMessage ? getErrorMessage(errorMessage) : null} />

      <div className="app-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-medium">Controle executivo</h2>
          <p className="text-sm text-muted-foreground">
            Receita, carteira, uso, retenção e saúde operacional em {periodLabel}.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-[8px] bg-[var(--app-surface-soft)] p-1">
          {([7, 30, 90, 365] as DashboardPeriod[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPeriod(item)}
              className={cn(
                "h-8 rounded-[6px] px-2 text-xs font-light shadow-none transition-colors",
                period === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground",
              )}
            >
              {item}d
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <VimobLoader label="Carregando indicadores..." />
        </div>
      ) : null}

      {!isLoading ? (
        <>
      {!overview.error && overview.data ? (
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <KpiCard title="MRR" value={formatCurrency(financial?.mrr)} icon={CreditCard} helper={`${formatPercent(financial?.revenue_growth_pct)} vs. período`} />
            <KpiCard title="Receita recebida" value={formatCurrency(financial?.revenue_period)} icon={BarChart3} helper={periodLabel} />
            <KpiCard title="Previsão" value={formatCurrency(financial?.revenue_forecast)} icon={CalendarDays} helper="Trial, pendente e ativa" />
            <KpiCard title="Ticket médio" value={formatCurrency(financial?.avg_ticket)} icon={CreditCard} helper={`Atraso: ${formatCurrency(financial?.overdue_total)}`} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <KpiCard title="Organizações" value={formatNumber(platform?.total_orgs)} icon={Building2} helper={`${formatNumber(platform?.active_orgs)} ativas`} />
            <KpiCard title="Trial" value={formatNumber(platform?.trial_orgs)} icon={Inbox} helper={`${formatNumber(platform?.cancelled_orgs)} canceladas`} />
            <KpiCard title="Usuários hoje" value={formatNumber(platform?.active_users_today)} icon={Users} helper="Ativos no dia" />
            <KpiCard title="Leads hoje" value={formatNumber(operational?.leads_today)} icon={Activity} helper={`${formatNumber(operational?.activities_today)} atividades`} />
          </div>

          <div className="app-card p-4">
            <div className="mb-4">
              <h2 className="text-base font-medium">Saúde da carteira</h2>
              <p className="text-sm text-muted-foreground">Distribuição atual de clientes por status comercial.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 md:gap-3">
              <StatusTile label="Ativas" value={Number(health?.active ?? platform?.active_orgs ?? 0)} total={Number(platform?.total_orgs || 0)} tone="success" />
              <StatusTile label="Trial" value={Number(health?.trial ?? platform?.trial_orgs ?? 0)} total={Number(platform?.total_orgs || 0)} tone="warning" />
              <StatusTile label="Atrasadas/canceladas" value={Number((health?.overdue || 0) + (health?.cancelled || 0))} total={Number(platform?.total_orgs || 0)} tone="danger" />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <KpiCard title="Automações hoje" value={formatNumber(operational?.automations_today)} icon={Activity} helper="Execuções" />
            <KpiCard title="Erros recentes" value={formatNumber(operational?.errors_recent)} icon={AlertTriangle} helper="Últimas 24h" />
          </div>

          {!pendingBoards.error && pendingBoards.data ? (
            <>
          <DashboardRowsCard
            title="Trials vencendo"
            empty="Nenhum trial com data de fim próxima."
            rows={pendingBoards.data?.trials || []}
            renderRow={(trial) => (
              <DashboardRow
                title={trial.name}
                detail={`${trial.days_left} dias restantes · ${trial.email || trial.whatsapp || trial.telefone || "sem contato"}`}
                badge={formatDateOnly(trial.trial_ends_at)}
              />
            )}
          />

          <DashboardRowsCard
            title="Carteira parada"
            empty="Nenhuma organização ativa sem acesso recente."
            rows={pendingBoards.data?.idle || []}
            renderRow={(item) => (
              <DashboardRow
                title={item.name}
                detail={item.last_access_at ? `Último acesso em ${formatDate(item.last_access_at)}` : "Sem acesso registrado"}
                badge={item.days_idle === null ? "--" : `${item.days_idle}d`}
              />
            )}
          />
            </>
          ) : null}
        </div>
      </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {!timeseries.error && timeseries.data ? (
        <DashboardRowsCard
          title="Receita por dia"
          empty="A API ainda não retornou série financeira para este período."
          rows={(timeseries.data?.revenue || []).slice(-8)}
          renderRow={(item) => (
            <DashboardRow title={formatDateOnly(item.date)} detail="Receita reconhecida" badge={formatCurrency(item.value)} />
          )}
        />
        ) : null}
        {!feed.error && feed.data ? (
        <DashboardRowsCard
          title="Feed de auditoria"
          empty="Nenhum evento de auditoria recente."
          rows={feed.data || []}
          renderRow={(item) => (
            <DashboardRow
              title={item.title}
              detail={`${item.organization_name || "Plataforma"} · ${formatDate(item.created_at)}`}
              badge={item.severity}
            />
          )}
        />
        ) : null}
      </div>
        </>
      ) : null}
    </div>
  );
}
