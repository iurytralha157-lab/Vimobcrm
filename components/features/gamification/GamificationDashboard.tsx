"use client";

import { useState, type FormEvent } from "react";
import {
  Activity,
  BarChart3,
  ClipboardCheck,
  Loader2,
  Target,
  Trophy,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  GamificationActionType,
  GamificationAdminSnapshot,
  GamificationManualEntry,
  GamificationMission,
  GamificationOverview,
  GamificationRankingEntry,
} from "@/hooks/gamification";

import {
  ACTION_OPTIONS,
  type GamificationAdminController,
  type ManualEntryDraft,
  formatDateTime,
  formatNumber,
  getEventLabel,
  getProgress,
} from "./gamification-domain";
import { GamificationHistory } from "./GamificationHistory";
import {
  EmptyPanel,
  Field,
  ManualEntryStatusBadge,
  PanelTitle,
} from "./GamificationUi";

export function GamificationDashboard({
  data,
  admin,
  snapshot,
}: {
  data: GamificationOverview;
  admin: GamificationAdminController;
  snapshot: GamificationAdminSnapshot;
}) {
  const currentUser = data.ranking.find((entry) => entry.isCurrentUser);
  const metrics = data.performance.metrics;
  const totalActions = Math.max(metrics.totalActions, 1);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
        <StatsWidget entry={currentUser} myPosition={data.myPosition} />
        <MissionsPanel missions={data.missions} />
      </div>

      <PerformanceCharts data={data} />
      {admin.error && !admin.snapshot ? (
        <div
          className="app-card flex items-center justify-between gap-3 p-4 text-sm"
          role="alert"
        >
          <span>
            Não foi possível carregar os lançamentos manuais. Tente novamente.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void admin.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : admin.isLoading ? (
        <div
          className="app-card flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando lançamentos...
        </div>
      ) : (
        <ManualEntrySubmitCard
          admin={admin}
          entries={snapshot.myManualEntries}
        />
      )}
      <DistributionPanel data={data} totalActions={totalActions} />
      <GamificationHistory events={data.recentEvents} compact />
    </div>
  );
}

function PerformanceCharts({ data }: { data: GamificationOverview }) {
  if (data.performance.chartData.length === 0) {
    return (
      <section className="app-card p-4">
        <PanelTitle
          icon={BarChart3}
          eyebrow="Desempenho"
          title="Evolução de pontos e ações"
        />
        <EmptyPanel
          title="Ainda não há dados suficientes para o gráfico"
          compact
        />
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <div className="app-card p-4">
        <PanelTitle
          icon={BarChart3}
          eyebrow="Semana"
          title="Evolução de pontos"
        />
        <div className="mt-4 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.performance.chartData}>
              <defs>
                <linearGradient id="arenaPoints" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
              />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="points"
                stroke="hsl(var(--primary))"
                fill="url(#arenaPoints)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="app-card p-4">
        <PanelTitle icon={Activity} eyebrow="Semana" title="Volume de ações" />
        <div className="mt-4 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.performance.chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12 }}
              />
              <Tooltip />
              <Bar
                dataKey="actions"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function DistributionPanel({
  data,
  totalActions,
}: {
  data: GamificationOverview;
  totalActions: number;
}) {
  return (
    <section className="app-card p-4">
      <PanelTitle
        icon={Users}
        eyebrow="Mês atual"
        title="Distribuição por atividade"
      />
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {data.performance.distribution.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-5">
            <EmptyPanel
              title="Nenhuma atividade distribuída neste período"
              compact
            />
          </div>
        ) : (
          data.performance.distribution.map((item) => {
            const percentage = Math.round((item.value / totalActions) * 100);
            return (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs font-medium">
                  <span>{item.label}</span>
                  <span>{percentage}%</span>
                </div>
                <Progress
                  value={percentage}
                  className="h-2 bg-[var(--app-surface-soft)]"
                />
                <p className="text-xs text-muted-foreground">
                  {formatNumber(item.value)} ações
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function ManualEntrySubmitCard({
  admin,
  entries,
}: {
  admin: GamificationAdminController;
  entries: GamificationManualEntry[];
}) {
  const [form, setForm] = useState<ManualEntryDraft>({
    actionKey: "",
    quantity: 1,
    notes: "",
  });
  const recentEntries = entries.slice(0, 3);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.actionKey) return;
    admin.createManualEntry.mutate(
      { ...form, actionKey: form.actionKey },
      {
        onSuccess: () => setForm({ actionKey: "", quantity: 1, notes: "" }),
      },
    );
  };

  return (
    <section className="app-card p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={submit} className="space-y-4">
          <PanelTitle
            icon={ClipboardCheck}
            eyebrow="Lançamento"
            title="Registrar atividade externa"
            showIcon={false}
          />
          <p className="text-sm text-muted-foreground">
            Use quando uma atividade pontuável aconteceu fora do CRM. O
            administrador aprova antes de somar pontos.
          </p>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
            <Field label="Atividade">
              <Select
                value={form.actionKey}
                disabled={admin.createManualEntry.isPending}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    actionKey: value as GamificationActionType,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map((action) => (
                    <SelectItem key={action} value={action}>
                      {getEventLabel(action)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Quantidade">
              <Input
                type="number"
                min={1}
                max={100}
                value={form.quantity}
                disabled={admin.createManualEntry.isPending}
                onChange={(event) =>
                  setForm({
                    ...form,
                    quantity: Number(event.target.value) || 1,
                  })
                }
              />
            </Field>
          </div>
          <Field label="Observação">
            <Textarea
              value={form.notes}
              disabled={admin.createManualEntry.isPending}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              rows={3}
              placeholder="Ex.: ligações feitas no stand, planilha de prospecção, visita externa..."
            />
          </Field>
          <Button
            type="submit"
            disabled={admin.createManualEntry.isPending || !form.actionKey}
          >
            {admin.createManualEntry.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ClipboardCheck className="h-4 w-4" />
            )}
            Enviar para aprovação
          </Button>
        </form>

        <div className="rounded-md bg-[var(--app-surface-soft)] p-3">
          <p className="text-sm font-medium">Minhas solicitações</p>
          <div className="mt-3 space-y-2">
            {recentEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum lançamento manual enviado ainda.
              </p>
            ) : (
              recentEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-background/60 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {getEventLabel(entry.actionKey)}
                    </p>
                    <p className="text-muted-foreground">
                      {entry.quantity}x - {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <ManualEntryStatusBadge entry={entry} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MissionsPanel({ missions }: { missions: GamificationMission[] }) {
  return (
    <section className="app-card p-4">
      <PanelTitle icon={Target} eyebrow="Missões" title="Desafios ativos" />
      <div className="mt-4 space-y-4">
        {missions.length === 0 ? (
          <EmptyPanel title="Nenhuma missão ativa" compact />
        ) : (
          missions.map((mission) => {
            const progress =
              mission.targetCount > 0
                ? Math.min(
                    100,
                    Math.round(
                      (mission.currentProgress / mission.targetCount) * 100,
                    ),
                  )
                : 0;

            return (
              <div key={mission.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {mission.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mission.description || "Sem descrição"}
                    </p>
                  </div>
                  <Badge variant="secondary">+{mission.bonusPoints} pts</Badge>
                </div>
                <Progress
                  value={progress}
                  className="h-2 bg-[var(--app-surface-soft)]"
                />
                <p className="text-xs text-muted-foreground">
                  {formatNumber(mission.currentProgress)} de{" "}
                  {formatNumber(mission.targetCount)}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function StatsWidget({
  entry,
  myPosition,
}: {
  entry?: GamificationRankingEntry;
  myPosition: number | null;
}) {
  if (!entry) {
    return (
      <section className="app-card p-4">
        <EmptyPanel title="Sem pontuação individual ainda" compact />
      </section>
    );
  }

  const progress = getProgress(entry);

  return (
    <section className="app-card p-4">
      <PanelTitle
        icon={Trophy}
        eyebrow="Meu desempenho"
        title={`Nível ${entry.level}`}
      />
      <div className="mt-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{entry.rank}</p>
            <p className="mt-1 text-3xl font-medium">
              {formatNumber(entry.xp)} XP
            </p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Trophy className="h-7 w-7" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Progresso do nível</span>
            <span className="font-medium">
              {formatNumber(entry.xpCurrentLevel)} /{" "}
              {formatNumber(entry.xpNextLevel)}
            </span>
          </div>
          <Progress
            value={progress}
            className="h-2 bg-[var(--app-surface-soft)]"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Pontos" value={formatNumber(entry.points)} />
          <MiniStat
            label="Posição"
            value={myPosition ? `${myPosition}` : "--"}
          />
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[var(--app-surface-soft)] p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
    </div>
  );
}
