'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  FileCheck,
  FileText,
  Flame,
  Flag,
  History,
  Home,
  Loader2,
  Medal,
  MessageSquare,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldOff,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
} from 'recharts';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import {
  useGamificationAdmin,
  useGamificationOverview,
  type GamificationAdminSnapshot,
  type GamificationEvent,
  type GamificationManualEntry,
  type GamificationMission,
  type GamificationOverview,
  type GamificationParticipant,
  type GamificationRankingEntry,
  type GamificationRule,
  type GamificationSeason,
} from '@/hooks/gamification';
import { cn } from '@/lib/utils';

const ACTION_LABELS: Record<string, string> = {
  call_made: 'Ligacao realizada',
  message_sent: 'Mensagem enviada',
  contact_made: 'Contato efetivo',
  visit_scheduled: 'Visita agendada',
  visit_confirmed: 'Visita realizada',
  meeting_scheduled: 'Reuniao agendada',
  meeting_held: 'Reuniao realizada',
  proposal_sent: 'Proposta enviada',
  sale_closed: 'Venda concluida',
  contract_signed: 'Contrato assinado',
  lead_created: 'Novo lead recebido',
  lead_created_manual: 'Lead criado manualmente',
  property_created: 'Imovel captado',
  prospecting_report: 'Relatorio de prospeccao',
  mission_bonus: 'Bonus de missao',
  manual_entry: 'Lancamento manual',
};

const SOURCE_LABELS: Record<string, string> = {
  system: 'Sistema',
  manual_entry: 'Manual',
  lead: 'Leads',
  whatsapp: 'WhatsApp',
  schedule: 'Agenda',
};

const RULE_ICONS: Record<string, LucideIcon> = {
  call_made: Phone,
  message_sent: MessageSquare,
  contact_made: UserCheck,
  visit_scheduled: Calendar,
  visit_confirmed: ClipboardCheck,
  meeting_scheduled: Calendar,
  meeting_held: Users,
  proposal_sent: FileText,
  sale_closed: Award,
  contract_signed: FileCheck,
  lead_created: UserPlus,
  lead_created_manual: UserPlus,
  property_created: Home,
};

const ACTION_OPTIONS = [
  'call_made',
  'message_sent',
  'visit_scheduled',
  'visit_confirmed',
  'meeting_scheduled',
  'meeting_held',
  'proposal_sent',
  'contract_signed',
  'property_created',
  'lead_created_manual',
];

const EMPTY_GAMIFICATION_OVERVIEW: GamificationOverview = {
  ranking: [],
  recentEvents: [],
  history: [],
  missions: [],
  performance: {
    chartData: [],
    metrics: {
      points: 0,
      growth: 0,
      avgActionsPerDay: 0,
      totalActions: 0,
      efficiency: 0,
      consistency: 0,
    },
    distribution: [],
  },
  totalPoints: 0,
  activeUsers: 0,
  totalEvents: 0,
  myPosition: null,
};

const EMPTY_ADMIN_SNAPSHOT: GamificationAdminSnapshot = {
  rules: [],
  missions: [],
  participants: [],
  seasons: [],
  myManualEntries: [],
  pendingManualEntries: [],
  users: [],
  canManage: false,
};

type GamificationTab = 'arena' | 'dashboard' | 'rankings' | 'history' | 'admin';

function tabFromHash(hash: string): GamificationTab {
  const clean = hash.replace('#', '');
  if (clean === 'dashboard' || clean === 'rankings' || clean === 'history' || clean === 'admin') return clean;
  return 'arena';
}

function formatNumber(value: number) {
  return value.toLocaleString('pt-BR');
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getEventLabel(type: string) {
  return ACTION_LABELS[type] || type.replaceAll('_', ' ');
}

function formatRelativeDate(value: string | null) {
  if (!value) return 'Sem data';
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR });
}

function formatDateTime(value: string | null) {
  if (!value) return '--';
  return format(new Date(value), 'dd/MM/yyyy HH:mm', { locale: ptBR });
}

function getProgress(entry: GamificationRankingEntry) {
  if (entry.xpNextLevel <= 0) return 0;
  return Math.min(100, Math.round((entry.xpCurrentLevel / entry.xpNextLevel) * 100));
}

export default function GamificationScreen() {
  const { profile, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<GamificationTab>('arena');
  const { overview, isLoading, error } = useGamificationOverview();
  const admin = useGamificationAdmin(activeTab === 'admin');

  const data = overview ?? EMPTY_GAMIFICATION_OVERVIEW;
  const snapshot = admin.snapshot ?? EMPTY_ADMIN_SNAPSHOT;
  const isAdmin = isSuperAdmin || profile?.role === 'admin' || profile?.role === 'super_admin';

  useEffect(() => {
    const handleHashChange = () => setActiveTab(tabFromHash(window.location.hash));
    const syncTimeout = window.setTimeout(handleHashChange, 0);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.clearTimeout(syncTimeout);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const handleTabChange = (value: string) => {
    const tab = value as GamificationTab;
    setActiveTab(tab);
    const hash = tab === 'arena' ? '' : `#${tab}`;
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  };

  return (
    <AppLayout title="Arena Imobiliaria">
      <div className="space-y-5">
        {(isLoading || error) && (
          <div className="app-card-soft flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
            <Trophy className="h-4 w-4 text-primary" />
            <span>
              {isLoading
                ? 'Carregando dados da arena...'
                : 'Arena disponivel. Quando os eventos forem conectados, os dados aparecem automaticamente.'}
            </span>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
            <ArenaTab value="arena" icon={Trophy} label="Arena" />
            <ArenaTab value="dashboard" icon={BarChart3} label="Dashboard" />
            <ArenaTab value="rankings" icon={Zap} label="Rankings" />
            <ArenaTab value="history" icon={History} label="Historico" />
            {isAdmin && <ArenaTab value="admin" icon={Settings} label="Admin" />}
          </TabsList>

          <TabsContent value="arena" className="mt-0">
            <ArenaView data={data} />
          </TabsContent>

          <TabsContent value="dashboard" className="mt-0">
            <DashboardView data={data} />
          </TabsContent>

          <TabsContent value="rankings" className="mt-0">
            <PerformanceView data={data} />
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <HistoryView events={data.history} />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin" className="mt-0">
              <AdminView admin={admin} snapshot={snapshot} isLoading={admin.isLoading} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}

function ArenaTab({ value, icon: Icon, label }: { value: string; icon: LucideIcon; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="h-10 rounded-md border border-border/60 bg-background px-3 text-muted-foreground data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
    >
      <Icon className="h-4 w-4" />
      {label}
    </TabsTrigger>
  );
}

function ArenaView({ data }: { data: GamificationOverview }) {
  const podium = data.ranking.slice(0, 3);
  const topUser = data.ranking[0];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Trophy} label="Pontos do time" value={formatNumber(data.totalPoints)} />
        <MetricCard icon={Medal} label="Participantes" value={formatNumber(data.activeUsers)} />
        <MetricCard icon={Activity} label="Eventos registrados" value={formatNumber(data.totalEvents)} />
        <MetricCard icon={Award} label="Minha posicao" value={data.myPosition ? `${data.myPosition} lugar` : '--'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.75fr)]">
        <div className="app-card overflow-hidden">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Arena</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Ranking da equipe</h2>
            </div>
            {topUser && (
              <div className="app-card-soft flex items-center gap-3 px-3 py-2">
                <Flame className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">Lider atual</span>
                <span className="text-sm font-semibold">{topUser.name}</span>
              </div>
            )}
          </div>

          {data.ranking.length === 0 ? (
            <EmptyPanel title="Nenhum participante encontrado" />
          ) : (
            <div className="divide-y divide-white/[0.025]">
              {data.ranking.map((entry) => (
                <RankingRow key={entry.userId} entry={entry} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <section className="app-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Podio</p>
                <h2 className="mt-1 text-lg font-semibold">Top corretores</h2>
              </div>
              <Sparkles className="h-5 w-5 text-primary" />
            </div>

            {podium.length === 0 ? (
              <EmptyPanel title="Sem pontuacao registrada" compact />
            ) : (
              <div className="space-y-2">
                {podium.map((entry) => (
                  <div key={entry.userId} className="app-card-soft flex items-center gap-3 p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
                      {entry.position}
                    </div>
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={entry.avatarUrl || undefined} />
                      <AvatarFallback>{getInitials(entry.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">{formatNumber(entry.points)} pts</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <RecentEventsPanel events={data.recentEvents} />
        </div>
      </section>
    </div>
  );
}

function DashboardView({ data }: { data: GamificationOverview }) {
  const currentUser = data.ranking.find((entry) => entry.isCurrentUser) ?? data.ranking[0];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
        <StatsWidget entry={currentUser} myPosition={data.myPosition} />
        <MissionsPanel missions={data.missions} />
      </div>
      <HistoryView events={data.recentEvents} compact />
    </div>
  );
}

function PerformanceView({ data }: { data: GamificationOverview }) {
  const metrics = data.performance.metrics;
  const totalActions = Math.max(metrics.totalActions, 1);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Target} label="Eficiencia" value={metrics.efficiency ? `${metrics.efficiency}%` : '--'} />
        <MetricCard icon={Zap} label="Acoes por dia" value={String(metrics.avgActionsPerDay || 0)} />
        <MetricCard icon={BarChart3} label="Pontos no mes" value={formatNumber(metrics.points)} />
        <MetricCard icon={Calendar} label="Consistencia" value={metrics.consistency ? `${metrics.consistency}%` : '--'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="app-card p-4">
          <PanelTitle icon={BarChart3} eyebrow="Semana" title="Evolucao de pontos" />
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.performance.chartData}>
                <defs>
                  <linearGradient id="arenaPoints" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="points" stroke="hsl(var(--primary))" fill="url(#arenaPoints)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="app-card p-4">
          <PanelTitle icon={Activity} eyebrow="Semana" title="Volume de acoes" />
          <div className="mt-4 h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.performance.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="actions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="app-card p-4">
        <PanelTitle icon={Users} eyebrow="Mes atual" title="Distribuicao por atividade" />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {data.performance.distribution.map((item) => {
            const percentage = Math.round((item.value / totalActions) * 100);
            return (
              <div key={item.label} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold">
                  <span>{item.label}</span>
                  <span>{percentage}%</span>
                </div>
                <Progress value={percentage} className="h-2 bg-white/10" />
                <p className="text-xs text-muted-foreground">{formatNumber(item.value)} acoes</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function HistoryView({ events, compact = false }: { events: GamificationEvent[]; compact?: boolean }) {
  return (
    <section className="app-card overflow-hidden">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <PanelTitle icon={History} eyebrow="Transparencia" title={compact ? 'Atividades recentes' : 'Historico de pontuacao'} />
        <Badge variant="secondary">{events.length} registros</Badge>
      </div>

      {events.length === 0 ? (
        <EmptyPanel title="Nenhuma atividade registrada ainda" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-y border-border/60 bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Data</th>
                <th className="px-4 py-3 text-left font-semibold">Acao</th>
                <th className="px-4 py-3 text-left font-semibold">Usuario</th>
                <th className="px-4 py-3 text-left font-semibold">Origem</th>
                <th className="px-4 py-3 text-right font-semibold">Pontos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(event.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{getEventLabel(event.eventType)}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium">{event.userName}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {SOURCE_LABELS[event.source || 'system'] || event.source || 'Sistema'}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-primary">+{formatNumber(event.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type AdminHook = ReturnType<typeof useGamificationAdmin>;

function AdminView({ admin, snapshot, isLoading }: { admin: AdminHook; snapshot: GamificationAdminSnapshot; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="app-card flex min-h-[260px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Carregando configuracoes da arena...
      </div>
    );
  }

  if (!snapshot.canManage) {
    return (
      <div className="app-card flex min-h-[220px] flex-col items-center justify-center text-center text-muted-foreground">
        <ShieldOff className="mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">Acesso administrativo indisponivel para este usuario.</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="rules" className="space-y-5">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
        <ArenaTab value="rules" icon={Settings} label="Regras" />
        <ArenaTab value="missions" icon={Target} label="Missoes" />
        <ArenaTab value="participants" icon={Users} label="Participantes" />
        <ArenaTab value="seasons" icon={Flag} label="Temporadas" />
        <ArenaTab value="manual" icon={ClipboardCheck} label="Aprovacoes" />
      </TabsList>

      <TabsContent value="rules" className="mt-0">
        <RulesAdmin rules={snapshot.rules} admin={admin} />
      </TabsContent>
      <TabsContent value="missions" className="mt-0">
        <MissionsAdmin missions={snapshot.missions} users={snapshot.users} admin={admin} />
      </TabsContent>
      <TabsContent value="participants" className="mt-0">
        <ParticipantsAdmin participants={snapshot.participants} admin={admin} />
      </TabsContent>
      <TabsContent value="seasons" className="mt-0">
        <SeasonsAdmin seasons={snapshot.seasons} admin={admin} />
      </TabsContent>
      <TabsContent value="manual" className="mt-0">
        <ManualEntriesAdmin snapshot={snapshot} admin={admin} />
      </TabsContent>
    </Tabs>
  );
}

function RulesAdmin({ rules, admin }: { rules: GamificationRule[]; admin: AdminHook }) {
  const [editing, setEditing] = useState<Record<string, number>>({});

  return (
    <section className="app-card p-4">
      <PanelTitle icon={Settings} eyebrow="Admin" title="Regras de pontuacao" />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rules.map((rule) => {
          const Icon = RULE_ICONS[rule.actionType] || Trophy;
          const points = editing[rule.actionType] ?? rule.points;
          return (
            <div key={rule.actionType} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{getEventLabel(rule.actionType)}</p>
                  <p className="text-xs text-muted-foreground">{rule.isActive ? 'Ativa' : 'Inativa'}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  className="h-9 w-20"
                  value={points}
                  onChange={(event) => setEditing((current) => ({ ...current, [rule.actionType]: Number(event.target.value) || 0 }))}
                />
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={(checked) =>
                    admin.upsertRule.mutate({ actionType: rule.actionType, points, isActive: checked })
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => admin.upsertRule.mutate({ actionType: rule.actionType, points, isActive: rule.isActive })}
                  disabled={admin.upsertRule.isPending}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MissionsAdmin({
  missions,
  users,
  admin,
}: {
  missions: GamificationMission[];
  users: GamificationAdminSnapshot['users'];
  admin: AdminHook;
}) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    actionType: 'call_made',
    targetCount: 10,
    bonusPoints: 100,
    period: 'daily',
    targetScope: 'organization' as 'organization' | 'user',
    targetUserId: '',
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    admin.createMission.mutate({
      title: form.title,
      description: form.description || null,
      actionType: form.actionType,
      targetCount: form.targetCount,
      bonusPoints: form.bonusPoints,
      period: form.period,
      targetScope: form.targetScope,
      targetUserId: form.targetScope === 'user' ? form.targetUserId : null,
      isActive: true,
    });
    setForm((current) => ({ ...current, title: '', description: '' }));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle icon={Plus} eyebrow="Missoes" title="Nova missao" />
        <Field label="Titulo">
          <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </Field>
        <Field label="Descricao">
          <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Acao">
            <Select value={form.actionType} onValueChange={(value) => setForm({ ...form, actionType: value })}>
              <SelectTrigger>
                <SelectValue />
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
          <Field label="Periodo">
            <Select value={form.period} onValueChange={(value) => setForm({ ...form, period: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diario</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Meta">
            <Input
              type="number"
              min={1}
              value={form.targetCount}
              onChange={(event) => setForm({ ...form, targetCount: Number(event.target.value) || 1 })}
            />
          </Field>
          <Field label="Bonus">
            <Input
              type="number"
              min={0}
              value={form.bonusPoints}
              onChange={(event) => setForm({ ...form, bonusPoints: Number(event.target.value) || 0 })}
            />
          </Field>
        </div>
        <Field label="Publico">
          <Select
            value={form.targetScope}
            onValueChange={(value: 'organization' | 'user') => setForm({ ...form, targetScope: value, targetUserId: '' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Toda a equipe</SelectItem>
              <SelectItem value="user">Pessoa especifica</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.targetScope === 'user' && (
          <Field label="Participante">
            <Select value={form.targetUserId} onValueChange={(value) => setForm({ ...form, targetUserId: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Button type="submit" className="w-full" disabled={admin.createMission.isPending || !form.title.trim()}>
          {admin.createMission.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Criar missao
        </Button>
      </form>

      <section className="app-card p-4">
        <PanelTitle icon={Target} eyebrow="Missoes" title="Missoes configuradas" />
        <div className="mt-4 space-y-3">
          {missions.length === 0 ? (
            <EmptyPanel title="Nenhuma missao criada ainda" compact />
          ) : (
            missions.map((mission) => (
              <div key={mission.id} className="rounded-md border border-border/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{mission.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{mission.description || 'Sem descricao'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={mission.isActive ? 'default' : 'secondary'}>{mission.isActive ? 'Ativa' : 'Inativa'}</Badge>
                    <Button type="button" size="icon" variant="ghost" onClick={() => admin.deleteMission.mutate(mission.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>Acao: {mission.actionType ? getEventLabel(mission.actionType) : '--'}</span>
                  <span>Meta: {mission.targetCount}</span>
                  <span>Bonus: +{mission.bonusPoints}</span>
                  <span>Periodo: {mission.period || '--'}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ParticipantsAdmin({ participants, admin }: { participants: GamificationParticipant[]; admin: AdminHook }) {
  return (
    <section className="app-card p-4">
      <PanelTitle icon={Users} eyebrow="Admin" title="Participantes da competicao" />
      <div className="mt-4 space-y-3">
        {participants.map((participant) => (
          <div key={participant.userId} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold">{participant.name}</p>
                {participant.role === 'admin' && <Badge variant="secondary">Admin</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{participant.email}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium">{participant.participates ? 'Competindo' : 'Fora do ranking'}</p>
                <p className="text-[11px] text-muted-foreground">{formatNumber(participant.points)} pts</p>
              </div>
              {participant.participates ? <Trophy className="h-4 w-4 text-primary" /> : <ShieldOff className="h-4 w-4 text-muted-foreground" />}
              <Switch
                checked={participant.participates}
                onCheckedChange={(checked) => admin.setParticipant.mutate({ userId: participant.userId, participates: checked })}
                disabled={admin.setParticipant.isPending}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SeasonsAdmin({ seasons, admin }: { seasons: GamificationSeason[]; admin: AdminHook }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const active = seasons.find((season) => season.isActive);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    admin.resetSeason.mutate({ name, reason });
    setName('');
    setReason('');
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle icon={RotateCcw} eyebrow="Temporada" title="Iniciar nova temporada" />
        {active && (
          <div className="rounded-md border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs uppercase text-muted-foreground">Em andamento</p>
            <p className="font-semibold">{active.name}</p>
            <p className="text-xs text-muted-foreground">Inicio: {formatDateTime(active.startedAt)}</p>
          </div>
        )}
        <Field label="Nome">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Mensagem para equipe">
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} />
        </Field>
        <Button type="submit" disabled={admin.resetSeason.isPending || !name.trim()}>
          {admin.resetSeason.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
          Iniciar temporada
        </Button>
      </form>

      <section className="app-card p-4">
        <PanelTitle icon={History} eyebrow="Temporadas" title="Historico" />
        <div className="mt-4 space-y-3">
          {seasons.length === 0 ? (
            <EmptyPanel title="Nenhuma temporada registrada" compact />
          ) : (
            seasons.map((season) => (
              <div key={season.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{season.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(season.startedAt)} {season.endedAt ? `- ${formatDateTime(season.endedAt)}` : ''}
                  </p>
                </div>
                {season.isActive && <Badge>Ativa</Badge>}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ManualEntriesAdmin({ snapshot, admin }: { snapshot: GamificationAdminSnapshot; admin: AdminHook }) {
  const [form, setForm] = useState({ actionKey: '', quantity: 1, notes: '' });
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    admin.createManualEntry.mutate(form);
    setForm({ actionKey: '', quantity: 1, notes: '' });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle icon={ClipboardCheck} eyebrow="Manual" title="Novo lancamento" />
        <Field label="Tipo de atividade">
          <Select value={form.actionKey} onValueChange={(value) => setForm({ ...form, actionKey: value })}>
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
            onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) || 1 })}
          />
        </Field>
        <Field label="Observacoes / evidencia">
          <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={4} />
        </Field>
        <Button type="submit" className="w-full" disabled={admin.createManualEntry.isPending || !form.actionKey}>
          Enviar para aprovacao
        </Button>
      </form>

      <section className="space-y-4">
        <ManualEntryList title="Aprovacoes pendentes" entries={snapshot.pendingManualEntries} admin={admin} rejectReasons={rejectReasons} setRejectReasons={setRejectReasons} />
        <ManualEntryList title="Minhas ultimas solicitacoes" entries={snapshot.myManualEntries} admin={admin} />
      </section>
    </div>
  );
}

function ManualEntryList({
  title,
  entries,
  admin,
  rejectReasons,
  setRejectReasons,
}: {
  title: string;
  entries: GamificationManualEntry[];
  admin: AdminHook;
  rejectReasons?: Record<string, string>;
  setRejectReasons?: (value: Record<string, string>) => void;
}) {
  return (
    <div className="app-card p-4">
      <PanelTitle icon={ClipboardCheck} eyebrow="Manual" title={title} />
      <div className="mt-4 space-y-3">
        {entries.length === 0 ? (
          <EmptyPanel title="Nenhum lancamento encontrado" compact />
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="rounded-md border border-border/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{entry.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {getEventLabel(entry.actionKey)} ({entry.quantity}x) - {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.notes && <p className="mt-2 text-xs text-muted-foreground">{entry.notes}</p>}
                  {entry.rejectionReason && <p className="mt-2 text-xs text-destructive">{entry.rejectionReason}</p>}
                </div>
                <Badge variant={entry.status === 'approved' ? 'default' : entry.status === 'rejected' ? 'destructive' : 'secondary'}>
                  {entry.status === 'approved' ? 'Aprovado' : entry.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                </Badge>
              </div>

              {entry.status === 'pending' && rejectReasons && setRejectReasons && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => admin.decideManualEntry.mutate({ id: entry.id, status: 'approved' })}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Aprovar
                  </Button>
                  <Input
                    placeholder="Motivo da rejeicao"
                    value={rejectReasons[entry.id] || ''}
                    onChange={(event) => setRejectReasons({ ...rejectReasons, [entry.id]: event.target.value })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => admin.decideManualEntry.mutate({ id: entry.id, status: 'rejected', reason: rejectReasons[entry.id] || '' })}
                  >
                    Rejeitar
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RecentEventsPanel({ events }: { events: GamificationEvent[] }) {
  return (
    <section className="app-card p-4">
      <PanelTitle icon={Activity} eyebrow="Atividades" title="Pontuacoes recentes" />
      <div className="mt-4 space-y-2">
        {events.length === 0 ? (
          <EmptyPanel title="Nenhum evento registrado" compact />
        ) : (
          events.map((event) => (
            <div key={event.id} className="app-card-soft p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{getEventLabel(event.eventType)}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{event.userName}</p>
                </div>
                <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">+{event.points}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{formatRelativeDate(event.createdAt)}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MissionsPanel({ missions }: { missions: GamificationMission[] }) {
  return (
    <section className="app-card p-4">
      <PanelTitle icon={Target} eyebrow="Missoes" title="Desafios ativos" />
      <div className="mt-4 space-y-4">
        {missions.length === 0 ? (
          <EmptyPanel title="Nenhuma missao ativa" compact />
        ) : (
          missions.map((mission) => {
            const progress = mission.targetCount > 0
              ? Math.min(100, Math.round((mission.currentProgress / mission.targetCount) * 100))
              : 0;

            return (
              <div key={mission.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{mission.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{mission.description || 'Sem descricao'}</p>
                  </div>
                  <Badge variant="secondary">+{mission.bonusPoints} pts</Badge>
                </div>
                <Progress value={progress} className="h-2 bg-white/10" />
                <p className="text-xs text-muted-foreground">
                  {formatNumber(mission.currentProgress)} de {formatNumber(mission.targetCount)}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function StatsWidget({ entry, myPosition }: { entry?: GamificationRankingEntry; myPosition: number | null }) {
  if (!entry) {
    return (
      <section className="app-card p-4">
        <EmptyPanel title="Sem pontuacao individual ainda" compact />
      </section>
    );
  }

  const progress = getProgress(entry);

  return (
    <section className="app-card p-4">
      <PanelTitle icon={Trophy} eyebrow="Meu desempenho" title={`Nivel ${entry.level}`} />
      <div className="mt-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-muted-foreground">{entry.rank}</p>
            <p className="mt-1 text-3xl font-bold">{formatNumber(entry.xp)} XP</p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Trophy className="h-7 w-7" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Progresso do nivel</span>
            <span className="font-semibold">
              {formatNumber(entry.xpCurrentLevel)} / {formatNumber(entry.xpNextLevel)}
            </span>
          </div>
          <Progress value={progress} className="h-2 bg-white/10" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Pontos" value={formatNumber(entry.points)} />
          <MiniStat label="Posicao" value={myPosition ? `${myPosition}` : '--'} />
        </div>
      </div>
    </section>
  );
}

function RankingRow({ entry }: { entry: GamificationRankingEntry }) {
  const progress = getProgress(entry);

  return (
    <div className={cn('grid gap-3 p-4 md:grid-cols-[64px_minmax(0,1fr)_180px_120px]', entry.isCurrentUser && 'bg-primary/[0.06]')}>
      <div className="flex items-center gap-3 md:justify-center">
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold',
            entry.position <= 3 ? 'bg-primary text-white' : 'bg-white/10 text-muted-foreground',
          )}
        >
          {entry.position}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={entry.avatarUrl || undefined} />
          <AvatarFallback>{getInitials(entry.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{entry.name}</p>
          <p className="text-xs text-muted-foreground">
            Nivel {entry.level} - {entry.rank}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">XP</span>
          <span className="font-semibold">
            {formatNumber(entry.xpCurrentLevel)} / {formatNumber(entry.xpNextLevel)}
          </span>
        </div>
        <Progress value={progress} className="h-2 bg-white/10" />
      </div>

      <div className="flex items-center justify-between gap-3 md:justify-end">
        <div className="text-left md:text-right">
          <p className="text-sm font-bold text-primary">{formatNumber(entry.points)} pts</p>
          <p className="text-xs text-muted-foreground">{entry.streakDays} dias de sequencia</p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="app-card flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-2 truncate text-2xl font-bold tracking-tight">{value}</p>
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function PanelTitle({ icon: Icon, eyebrow, title }: { icon: LucideIcon; eyebrow: string; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      </div>
      <Icon className="h-5 w-5 shrink-0 text-primary" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function EmptyPanel({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center text-muted-foreground', compact ? 'min-h-[120px]' : 'min-h-[220px]')}>
      <Trophy className="mb-3 h-8 w-8 opacity-35" />
      <p className="text-sm font-medium">{title}</p>
    </div>
  );
}
