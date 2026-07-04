'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Crown,
  DollarSign,
  FileCheck,
  FileText,
  Flag,
  History,
  Home,
  Loader2,
  MessageSquare,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldOff,
  Target,
  TrendingUp,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  Volume2,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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

type GamificationTab = 'arena' | 'dashboard' | 'rankings' | 'history' | 'config';

function tabFromHash(hash: string): GamificationTab {
  const clean = hash.replace('#', '');
  if (clean === 'dashboard' || clean === 'rankings' || clean === 'history' || clean === 'config') return clean;
  if (clean === 'admin') return 'config';
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
  const [showCelebration, setShowCelebration] = useState(false);
  const previousRankingRef = useRef<Record<string, number>>({});
  const { overview, isLoading, error } = useGamificationOverview();
  const isAdmin = isSuperAdmin || profile?.role === 'admin' || profile?.role === 'super_admin';
  const admin = useGamificationAdmin(activeTab === 'config' && isAdmin);

  const data = overview ?? EMPTY_GAMIFICATION_OVERVIEW;
  const snapshot = admin.snapshot ?? EMPTY_ADMIN_SNAPSHOT;

  useEffect(() => {
    const handleHashChange = () => setActiveTab(tabFromHash(window.location.hash));
    const syncTimeout = window.setTimeout(handleHashChange, 0);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.clearTimeout(syncTimeout);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (data.ranking.length === 0) {
      previousRankingRef.current = {};
      return;
    }

    const previousRanking = previousRankingRef.current;
    const hadPreviousRanking = Object.keys(previousRanking).length > 0;
    const currentRanking = data.ranking.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.userId] = entry.position;
      return acc;
    }, {});
    const previousLeaderId = Object.entries(previousRanking).find(([, position]) => position === 1)?.[0];
    const currentLeaderId = data.ranking[0]?.userId;
    const hasPositionGain = data.ranking.some((entry) => {
      const previousPosition = previousRanking[entry.userId];
      return previousPosition !== undefined && entry.position < previousPosition;
    });
    const leaderChanged = Boolean(previousLeaderId && currentLeaderId && previousLeaderId !== currentLeaderId);

    previousRankingRef.current = currentRanking;

    if (!hadPreviousRanking || (!hasPositionGain && !leaderChanged)) return;

    setShowCelebration(true);
    const timeout = window.setTimeout(() => setShowCelebration(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [data.ranking]);

  const handleTabChange = (value: string) => {
    const tab = value as GamificationTab;
    setActiveTab(tab);
    const hash = tab === 'arena' ? '' : `#${tab}`;
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  };

  return (
    <AppLayout title="Arena Imobiliaria">
      <div className="space-y-5">
        <ArenaCelebration active={showCelebration} />
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

        <Tabs data-tour="gamification-tabs" value={activeTab} onValueChange={handleTabChange} className="space-y-5">
          <TabsContent data-tour="gamification-arena" value="arena" className="mt-0">
            <ArenaView data={data} />
          </TabsContent>

          <TabsContent data-tour="gamification-dashboard" value="dashboard" className="mt-0">
            <DashboardView data={data} />
          </TabsContent>

          <TabsContent data-tour="gamification-rankings" value="rankings" className="mt-0">
            <PerformanceView data={data} />
          </TabsContent>

          <TabsContent data-tour="gamification-history" value="history" className="mt-0">
            <HistoryView events={data.history} />
          </TabsContent>

          <TabsContent data-tour="gamification-config" value="config" className="mt-0">
            <AdminView admin={admin} snapshot={snapshot} isLoading={admin.isLoading} canAccess={isAdmin} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function ConfigTab({ value, icon: Icon, label }: { value: string; icon: LucideIcon; label: string }) {
  return (
    <TabsTrigger
      value={value}
      className="h-10 rounded-md border-0 px-3 text-muted-foreground shadow-none transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
    >
      <Icon className="h-4 w-4" />
      {label}
    </TabsTrigger>
  );
}

function ArenaCelebration({ active }: { active: boolean }) {
  if (!active) return null;

  const colors = ['#ff4529', '#fbbf24', '#22c55e', '#60a5fa', '#f97316'];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[70] flex justify-center overflow-hidden" aria-hidden="true">
      <style>
        {`
          @keyframes arena-confetti {
            0% { opacity: 0; transform: translate3d(0, -12px, 0) rotate(0deg) scale(0.7); }
            12% { opacity: 1; }
            100% { opacity: 0; transform: translate3d(var(--arena-x), 150px, 0) rotate(520deg) scale(1); }
          }
        `}
      </style>
      <div className="relative h-44 w-[min(720px,92vw)]">
        {Array.from({ length: 24 }).map((_, index) => (
          <span
            key={index}
            className="absolute h-2.5 w-1.5 rounded-full"
            style={{
              left: `${8 + ((index * 17) % 84)}%`,
              top: `${(index * 11) % 28}px`,
              backgroundColor: colors[index % colors.length],
              animation: `arena-confetti ${1.25 + (index % 5) * 0.08}s ease-out ${index * 0.025}s forwards`,
              '--arena-x': `${(index % 2 === 0 ? 1 : -1) * (28 + (index % 6) * 10)}px`,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

const rankLabels: Record<string, { label: string; icon: LucideIcon; iconColor?: string }> = {
  geral: { label: 'Geral', icon: Trophy },
  ligacoes: { label: 'Ligações', icon: Phone },
  mensagens: { label: 'Mensagens', icon: MessageSquare },
  propostas: { label: 'Propostas', icon: FileText },
  vendas: { label: 'Vendas', icon: DollarSign },
  reunioes: { label: 'Reuniões', icon: Users },
  visitas: { label: 'Visitas', icon: ClipboardCheck },
  vgv: { label: 'Ranking de VGV', icon: DollarSign, iconColor: 'text-emerald-400' },
};

const eventTypesMap: Record<string, string[]> = {
  ligacoes: ['call_made'],
  mensagens: ['message_sent'],
  propostas: ['proposal_sent'],
  vendas: ['sale_closed', 'contract_signed'],
  reunioes: ['meeting_held', 'meeting_scheduled'],
  visitas: ['visit_confirmed', 'visit_scheduled'],
  vgv: ['sale_closed'],
};

const getFilteredRanking = (
  baseRanking: GamificationRankingEntry[],
  history: GamificationEvent[],
  rankType: string,
  period: 'month' | 'general'
): GamificationRankingEntry[] => {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const periodEvents = history.filter(event => {
    if (!event.createdAt) return false;
    const date = new Date(event.createdAt);
    if (period === 'month') {
      return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }
    return true;
  });

  if (rankType === 'geral') {
    if (period === 'month') {
      return baseRanking;
    }
    const pointsByUser: Record<string, number> = {};
    periodEvents.forEach(event => {
      if (!event.userId) return;
      pointsByUser[event.userId] = (pointsByUser[event.userId] || 0) + event.points;
    });

    return baseRanking
      .map(entry => ({
        ...entry,
        points: pointsByUser[entry.userId] !== undefined ? pointsByUser[entry.userId] : entry.points,
      }))
      .sort((a, b) => b.points - a.points)
      .map((entry, idx) => ({ ...entry, position: idx + 1 }));
  }

  const targetTypes = eventTypesMap[rankType] || [];
  const pointsByUser: Record<string, number> = {};
  periodEvents.forEach(event => {
    if (!event.userId || !targetTypes.includes(event.eventType)) return;
    pointsByUser[event.userId] = (pointsByUser[event.userId] || 0) + event.points;
  });

  return baseRanking
    .map(entry => ({
      ...entry,
      points: pointsByUser[entry.userId] || 0,
    }))
    .sort((a, b) => b.points - a.points)
    .map((entry, idx) => ({ ...entry, position: idx + 1 }));
};

function ArenaView({ data }: { data: GamificationOverview }) {
  const [period, setPeriod] = useState<'month' | 'general'>('month');
  const [rankType, setRankType] = useState<string>('geral');

  const filteredRanking = getFilteredRanking(data.ranking, data.history, rankType, period);

  return (
    <div>
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.75fr)] lg:h-[calc(100vh-110px)] lg:min-h-0 overflow-hidden">
        <PodiumStage ranking={filteredRanking} />
        <ClassificationPanel
          ranking={filteredRanking}
          period={period}
          setPeriod={setPeriod}
          rankType={rankType}
          setRankType={setRankType}
        />
      </section>
    </div>
  );
}

function DashboardView({ data }: { data: GamificationOverview }) {
  const currentUser = data.ranking.find((entry) => entry.isCurrentUser) ?? data.ranking[0];
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

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)]">
        <StatsWidget entry={currentUser} myPosition={data.myPosition} />
        <MissionsPanel missions={data.missions} />
      </div>

      <PerformanceCharts data={data} />
      <DistributionPanel data={data} totalActions={totalActions} />
      <HistoryView events={data.recentEvents} compact />
    </div>
  );
}

function PerformanceView({ data }: { data: GamificationOverview }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Ranking</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Classificacao da equipe</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pontuacao, nivel e sequencia dos participantes ativos.</p>
        </div>
        <Badge variant="secondary">{data.ranking.length} participantes</Badge>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Trophy} label="Total em disputa" value={formatNumber(data.totalPoints)} />
        <MetricCard icon={Users} label="Participantes" value={formatNumber(data.activeUsers)} />
        <MetricCard icon={Activity} label="Eventos" value={formatNumber(data.totalEvents)} />
        <MetricCard icon={Award} label="Minha posicao" value={data.myPosition ? `${data.myPosition} lugar` : '--'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="app-card overflow-hidden">
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <PanelTitle icon={TrendingUp} eyebrow="Equipe" title="Tabela de classificacao" />
            {data.ranking[0] && (
              <div className="app-card-soft flex items-center gap-2 px-3 py-2 text-sm">
                <Crown className="h-4 w-4 text-amber-400" />
                <span className="text-muted-foreground">Lider:</span>
                <span className="max-w-[220px] truncate font-semibold">{data.ranking[0].name}</span>
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

        <RecentEventsPanel events={data.recentEvents} />
      </section>
    </div>
  );
}

function PerformanceCharts({ data }: { data: GamificationOverview }) {
  return (
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
  );
}

function DistributionPanel({ data, totalActions }: { data: GamificationOverview; totalActions: number }) {
  return (
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
  );
}

function PodiumStage({ ranking }: { ranking: GamificationRankingEntry[] }) {
  const first = ranking.find((entry) => entry.position === 1) ?? ranking[0];
  const second = ranking.find((entry) => entry.position === 2) ?? ranking[1];
  const third = ranking.find((entry) => entry.position === 3) ?? ranking[2];

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-xl bg-[var(--app-surface-solid)] p-5 sm:p-6 shadow-xl min-h-[580px] lg:min-h-0">
      <div className="absolute inset-x-8 bottom-10 h-16 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

      {/* Title / Header */}
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/5 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-400">
            <Trophy className="h-5 w-5" />
          </div>
          <h2 className="text-base sm:text-lg font-black italic tracking-wider uppercase text-white">
            Arena Imobiliária de Elite
          </h2>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <Volume2 className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-white transition-colors" />
          <span className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {ranking.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyPanel title="Sem pontuação registrada" />
        </div>
      ) : (
        <div className="relative mt-8 flex flex-1 items-end justify-center gap-4 sm:gap-6 md:gap-10 pb-4 w-full shrink-0 min-h-[380px]">
          <PodiumSpot entry={second} place={2} tone="silver" className="w-[140px] sm:w-[170px] md:w-[200px] shrink-0" />
          <PodiumSpot entry={first} place={1} tone="gold" featured className="w-[160px] sm:w-[195px] md:w-[230px] shrink-0" />
          <PodiumSpot entry={third} place={3} tone="bronze" className="w-[125px] sm:w-[155px] md:w-[185px] shrink-0" />
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
  tone: 'gold' | 'silver' | 'bronze';
  featured?: boolean;
  className?: string;
}) {
  const pedestalHeights = {
    gold: 'h-[250px] md:h-[270px]',
    silver: 'h-[180px] md:h-[200px]',
    bronze: 'h-[130px] md:h-[145px]',
  };

  const pedestalStyles = {
    gold: 'border-t border-t-amber-400/50 border-x-0 border-b-0 bg-gradient-to-b from-amber-500/25 via-amber-500/8 to-amber-500/0 text-amber-300',
    silver: 'border-t border-t-slate-300/40 border-x-0 border-b-0 bg-gradient-to-b from-slate-400/20 via-slate-400/6 to-slate-400/0 text-slate-100',
    bronze: 'border-t border-t-orange-500/40 border-x-0 border-b-0 bg-gradient-to-b from-orange-600/20 via-orange-600/5 to-orange-600/0 text-orange-200',
  };

  const toneClasses = {
    gold: 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.25)]',
    silver: 'border-slate-300 shadow-[0_0_12px_rgba(203,213,225,0.15)]',
    bronze: 'border-orange-600 shadow-[0_0_10px_rgba(234,88,12,0.15)]',
  };

  const avatarSizes = {
    gold: 'h-32 w-32 md:h-36 md:w-36',
    silver: 'h-26 w-26 md:h-30 md:w-30',
    bronze: 'h-22 w-22 md:h-26 md:w-26',
  };

  if (!entry) {
    return (
      <div className={cn('flex flex-col items-center justify-end w-full', className)}>
        <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-border/40 text-muted-foreground bg-[var(--app-surface-solid)] font-bold">
          {place}
        </div>
        <div
          className={cn(
            'mt-[-16px] z-0 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-border/20 p-4 text-center',
            pedestalHeights[tone]
          )}
        >
          <p className="text-xs font-semibold text-muted-foreground/60">Aguardando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col items-center justify-end w-full group', className)}>
      {/* Avatar Container */}
      <div className="relative z-10">
        {featured && (
          <div className="absolute -top-7.5 left-1/2 -translate-x-1/2 w-full flex justify-center z-20 pointer-events-none">
            <Crown className="h-9 w-9 fill-amber-400 text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.5)] animate-pulse" />
          </div>
        )}
        <Avatar className={cn('border-4 bg-background', avatarSizes[tone], toneClasses[tone])}>
          <AvatarImage src={entry.avatarUrl || undefined} />
          <AvatarFallback className="text-xl font-bold bg-[var(--app-surface-soft)] text-white">
            {getInitials(entry.name)}
          </AvatarFallback>
        </Avatar>

        {/* Badge Medal / Overlay */}
        {place === 1 && (
          <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-md">
            TOP 1
          </div>
        )}
        {place === 2 && (
          <div className="absolute -top-1 -right-1 flex h-7.5 w-7.5 items-center justify-center rounded-full bg-white text-slate-700 shadow-md border-2 border-slate-300">
            <Award className="h-4 w-4" />
          </div>
        )}
        {place === 3 && (
          <div className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-orange-100 text-orange-850 shadow-md border-2 border-orange-300">
            <Award className="h-3.5 w-3.5" />
          </div>
        )}
      </div>

      {/* Pedestal Column */}
      <div
        className={cn(
          'mt-[-28px] z-0 flex w-full flex-col items-center justify-end pb-5 pt-8 px-3 text-center rounded-t-xl rounded-b-lg transition-all duration-500 hover:brightness-110',
          pedestalHeights[tone],
          pedestalStyles[tone]
        )}
      >
        <p className="text-xs sm:text-sm font-bold text-white line-clamp-1 w-full px-1">{entry.name}</p>

        <p className={cn(
          'font-black leading-none mt-2',
          featured ? 'text-3xl sm:text-4xl text-amber-400' : place === 2 ? 'text-2xl sm:text-3xl text-slate-200' : 'text-xl sm:text-2xl text-orange-300'
        )}>
          {formatNumber(entry.points)}
        </p>

        <p className={cn(
          'text-[9px] font-bold uppercase tracking-widest mt-1',
          featured ? 'text-amber-500/90' : place === 2 ? 'text-slate-400' : 'text-orange-400/90'
        )}>
          {place === 1 ? 'Campeão' : 'Pontos'}
        </p>
      </div>
    </div>
  );
}

interface ClassificationPanelProps {
  ranking: GamificationRankingEntry[];
  period: 'month' | 'general';
  setPeriod: (period: 'month' | 'general') => void;
  rankType: string;
  setRankType: (rankType: string) => void;
}

function ClassificationPanel({
  ranking,
  period,
  setPeriod,
  rankType,
  setRankType,
}: ClassificationPanelProps) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl bg-[var(--app-surface-solid)] p-5 shadow-xl min-h-[580px] lg:min-h-0">
      {/* Header */}
      <div className="border-b border-border/5 pb-4 shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-bold tracking-wide text-white">Classificação</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Period Filter Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-lg text-xs px-3 border border-primary text-primary hover:text-primary/90 flex items-center gap-1.5 bg-transparent"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {period === 'month' ? 'Este mês' : 'Geral'}
                  <ChevronDown className="h-3 w-3 ml-0.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover rounded-xl border border-border/10">
                <DropdownMenuItem onClick={() => setPeriod('month')} className="cursor-pointer rounded-lg text-xs">
                  Este mês
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPeriod('general')} className="cursor-pointer rounded-lg text-xs">
                  Geral
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Rank Type Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-lg text-xs px-3 border border-border/20 text-white hover:bg-white/5 flex items-center gap-1.5 bg-transparent"
                >
                  {(() => {
                    const active = rankLabels[rankType] || rankLabels.geral;
                    const IconComponent = active.icon;
                    return (
                      <>
                        <IconComponent className={cn("h-3.5 w-3.5", active.iconColor)} />
                        <span>{active.label}</span>
                      </>
                    );
                  })()}
                  <ChevronDown className="h-3 w-3 ml-0.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover rounded-xl border border-border/10 w-44">
                {Object.entries(rankLabels).map(([key, item]) => {
                  const IconComponent = item.icon;
                  return (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => setRankType(key)}
                      className={cn(
                        "cursor-pointer rounded-lg text-xs flex items-center gap-2 m-0.5",
                        rankType === key && "bg-primary/10 text-primary font-semibold"
                      )}
                    >
                      <IconComponent className={cn("h-3.5 w-3.5", item.iconColor)} />
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
      ? 'bg-amber-400 text-amber-950'
      : entry.position === 2
        ? 'bg-slate-300 text-slate-900'
        : entry.position === 3
          ? 'bg-orange-500 text-orange-950'
          : 'bg-white/5 text-slate-400';

  return (
    <div
      className={cn(
        'group flex min-h-[64px] items-center gap-3 border-b border-border/5 py-3 px-2 transition-all duration-300 hover:bg-white/[0.02] hover:-translate-y-0.5 hover:shadow-sm rounded-lg',
        entry.isCurrentUser && 'bg-primary/5 border-l-2 border-l-primary pl-3',
      )}
    >
      {/* Position badge */}
      <div
        className={cn(
          'flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-full text-[11px] font-black transition-all group-hover:scale-105',
          rankBgColor,
        )}
      >
        {entry.position}
      </div>

      {/* Avatar */}
      <Avatar className="h-10 w-10 shrink-0 border border-border/30">
        <AvatarImage src={entry.avatarUrl || undefined} />
        <AvatarFallback className="text-xs bg-[var(--app-surface-soft)] font-bold text-white">
          {getInitials(entry.name)}
        </AvatarFallback>
      </Avatar>

      {/* Broker Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-white group-hover:text-primary transition-colors">
            {entry.name}
          </p>
          {entry.position === 1 && (
            <Crown className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.35)]" />
          )}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {entry.rank}
        </p>
      </div>

      {/* Score / Points */}
      <div className="shrink-0 text-right pl-2">
        <p className="text-base font-black text-white">{formatNumber(entry.points)}</p>
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 mt-0.5">
          pontos
        </p>
      </div>
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

function AdminView({
  admin,
  snapshot,
  isLoading,
  canAccess,
}: {
  admin: AdminHook;
  snapshot: GamificationAdminSnapshot;
  isLoading: boolean;
  canAccess: boolean;
}) {
  if (!canAccess) {
    return (
      <div className="app-card flex min-h-[220px] flex-col items-center justify-center text-center text-muted-foreground">
        <ShieldOff className="mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">Configuração disponivel apenas para administradores.</p>
      </div>
    );
  }

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
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Configuração</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Gestão de gamificação</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ajuste regras, missões, participantes, temporada e aprovações manuais.</p>
      </div>

      <TabsList className="inline-flex h-auto max-w-full flex-wrap justify-start gap-1 rounded-md bg-muted/45 p-1">
        <ConfigTab value="rules" icon={Settings} label="Regras" />
        <ConfigTab value="missions" icon={Target} label="Missoes" />
        <ConfigTab value="participants" icon={Users} label="Participantes" />
        <ConfigTab value="seasons" icon={Flag} label="Temporada" />
        <ConfigTab value="manual" icon={ClipboardCheck} label="Aprovacoes" />
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
