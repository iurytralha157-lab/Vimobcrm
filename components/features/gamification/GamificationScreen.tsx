"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
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
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldOff,
  Target,
  Trash2,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { format, startOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
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

import { AppLayout } from "@/components/shared/layout/AppLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import {
  type DatePreset,
  getDateRangeFromPreset,
} from "@/hooks/use-dashboard-filters";
import {
  useGamificationAdmin,
  useGamificationEvents,
  useGamificationOverview,
  useGamificationRanking,
  useGamificationRealtime,
  type GamificationAdminSnapshot,
  type GamificationActionType,
  type GamificationEvent,
  type GamificationManualEntry,
  type GamificationMission,
  type GamificationOverview,
  type GamificationParticipant,
  type GamificationRankingEntry,
  type GamificationRule,
  type GamificationSeason,
} from "@/hooks/gamification";
import { cn } from "@/lib/utils";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { LOCATION_HASH_CHANGE_EVENT } from "@/hooks/use-location-hash";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { getFriendlyErrorMessage } from "@/lib/error-handler";

const ACTION_LABELS: Record<string, string> = {
  call_made: "Ligação realizada",
  message_sent: "Mensagem enviada",
  contact_made: "Contato efetivo",
  visit_scheduled: "Visita agendada",
  visit_confirmed: "Visita realizada",
  meeting_scheduled: "Reunião agendada",
  meeting_held: "Reunião realizada",
  proposal_sent: "Proposta enviada",
  sale_closed: "Venda concluida",
  contract_signed: "Contrato assinado",
  lost_lead_recovered: "Lead recuperado",
  lead_created: "Novo lead recebido",
  lead_created_manual: "Lead criado manualmente",
  property_created: "Imóvel captado",
  prospecting_report: "Relatorio de prospeccao",
  mission_bonus: "Bônus de missão",
  manual_entry: "Lançamento manual",
};

const SOURCE_LABELS: Record<string, string> = {
  system: "Sistema",
  manual_entry: "Manual",
  lead: "Leads",
  whatsapp: "WhatsApp",
  schedule: "Agenda",
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
  lost_lead_recovered: RotateCcw,
  lead_created: UserPlus,
  lead_created_manual: UserPlus,
  property_created: Home,
};

const ACTION_OPTIONS: GamificationActionType[] = [
  "call_made",
  "message_sent",
  "contact_made",
  "visit_scheduled",
  "visit_confirmed",
  "meeting_scheduled",
  "meeting_held",
  "proposal_sent",
  "sale_closed",
  "contract_signed",
  "lost_lead_recovered",
  "lead_created",
  "property_created",
  "lead_created_manual",
  "prospecting_report",
];

type ManualEntryDraft = {
  actionKey: GamificationActionType | "";
  quantity: number;
  notes: string;
};

type MissionDraft = {
  title: string;
  description: string;
  actionType: GamificationActionType;
  targetCount: number;
  bonusPoints: number;
  period: string;
  targetScope: "organization" | "user";
  targetUserId: string;
  isActive: boolean;
};

const ACTION_ALIASES: Record<string, string> = {
  ligacao_realizada: "call_made",
  ligacao: "call_made",
  mensagem: "message_sent",
  mensagem_enviada: "message_sent",
  contato_efetivo: "contact_made",
  visita_agendada: "visit_scheduled",
  visita_realizada: "visit_confirmed",
  visita_confirmada: "visit_confirmed",
  reuniao_agendada: "meeting_scheduled",
  reuniao_realizada: "meeting_held",
  proposta_enviada: "proposal_sent",
  venda_concluida: "sale_closed",
  lead_ganho: "sale_closed",
  ganho: "sale_closed",
  contrato_assinado: "contract_signed",
  lead_criado: "lead_created",
  lead_manual: "lead_created_manual",
  lead_criado_manual: "lead_created_manual",
  imovel_captado: "property_created",
  imovel_criado: "property_created",
  lead_recuperado: "lost_lead_recovered",
  recuperar_lead_perdido: "lost_lead_recovered",
};

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

type GamificationTab = "arena" | "dashboard" | "history" | "config";

function tabFromHash(hash: string): GamificationTab {
  const clean = hash.replace("#", "");
  if (clean === "rankings") return "arena";
  if (clean === "dashboard" || clean === "history" || clean === "config")
    return clean;
  if (clean === "admin") return "config";
  return "arena";
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function normalizeActionKey(type: string | null | undefined) {
  const key = String(type || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");
  return ACTION_ALIASES[key] || key;
}

function getEventLabel(type: string) {
  const key = normalizeActionKey(type);
  return ACTION_LABELS[key] || key.replaceAll("_", " ");
}

function formatDateTime(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  destructive?: boolean;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              destructive &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
            disabled={isPending}
            aria-busy={isPending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? "Processando..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ManualEntryStatusBadge({ entry }: { entry: GamificationManualEntry }) {
  let label = "Pendente de aprovação";
  let variant: "default" | "secondary" | "destructive" | "outline" =
    "secondary";

  if (entry.status === "rejected") {
    label = "Rejeitado";
    variant = "destructive";
  } else if (entry.status === "approved" && entry.awardStatus === "completed") {
    label = "Pontos concedidos";
    variant = "default";
  } else if (entry.status === "approved" && entry.awardStatus === "skipped") {
    label = "Aprovado sem pontuar";
    variant = "destructive";
  } else if (entry.status === "approved" && entry.awardStatus === "dead") {
    label = "Falha ao conceder pontos";
    variant = "destructive";
  } else if (
    entry.status === "approved" &&
    entry.awardStatus === "processing"
  ) {
    label = "Processando pontos";
    variant = "outline";
  } else if (entry.status === "approved") {
    label = "Aguardando pontuação";
    variant = "outline";
  }

  return <Badge variant={variant}>{label}</Badge>;
}

function getProgress(entry: GamificationRankingEntry) {
  if (entry.xpNextLevel <= 0) return 0;
  return Math.min(
    100,
    Math.round((entry.xpCurrentLevel / entry.xpNextLevel) * 100),
  );
}

export default function GamificationScreen() {
  const {
    error: modulesError,
    isLoading: modulesLoading,
    hasModule,
    refetch: refetchModules,
  } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const canManage = hasPermission("gamification_manage");
  const [activeTab, setActiveTab] = useState<GamificationTab>("arena");
  const [showCelebration, setShowCelebration] = useState(false);
  const previousRankingRef = useRef<Record<string, number>>({});
  const moduleEnabled =
    !modulesLoading && !modulesError && hasModule("gamification");
  useGamificationRealtime(moduleEnabled);
  const overviewEnabled = moduleEnabled && activeTab === "dashboard";
  const adminEnabled =
    moduleEnabled &&
    (activeTab === "dashboard" || (activeTab === "config" && canManage));
  const { overview, isLoading, error, refetch } =
    useGamificationOverview(overviewEnabled);
  const admin = useGamificationAdmin(adminEnabled);

  const data = overview ?? EMPTY_GAMIFICATION_OVERVIEW;
  const snapshot = admin.snapshot ?? EMPTY_ADMIN_SNAPSHOT;

  useEffect(() => {
    const handleHashChange = () => {
      const requestedTab = tabFromHash(window.location.hash);
      const nextTab = requestedTab === "config" && !canManage ? "arena" : requestedTab;
      setActiveTab(nextTab);
      if (nextTab !== requestedTab) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    };
    const syncTimeout = window.setTimeout(handleHashChange, 0);
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.clearTimeout(syncTimeout);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [canManage]);

  useEffect(() => {
    if (data.ranking.length === 0) {
      previousRankingRef.current = {};
      return;
    }

    const previousRanking = previousRankingRef.current;
    const hadPreviousRanking = Object.keys(previousRanking).length > 0;
    const currentRanking = data.ranking.reduce<Record<string, number>>(
      (acc, entry) => {
        acc[entry.userId] = entry.position;
        return acc;
      },
      {},
    );
    const previousLeaderId = Object.entries(previousRanking).find(
      ([, position]) => position === 1,
    )?.[0];
    const currentLeaderId = data.ranking[0]?.userId;
    const hasPositionGain = data.ranking.some((entry) => {
      const previousPosition = previousRanking[entry.userId];
      return (
        previousPosition !== undefined && entry.position < previousPosition
      );
    });
    const leaderChanged = Boolean(
      previousLeaderId &&
      currentLeaderId &&
      previousLeaderId !== currentLeaderId,
    );

    previousRankingRef.current = currentRanking;

    if (!hadPreviousRanking || (!hasPositionGain && !leaderChanged)) return;

    setShowCelebration(true);
    const timeout = window.setTimeout(() => setShowCelebration(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [data.ranking]);

  const handleTabChange = (value: string) => {
    const tab = value as GamificationTab;
    if (tab === "config" && !canManage) return;
    setActiveTab(tab);
    const hash = tab === "arena" ? "" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
    window.dispatchEvent(new Event(LOCATION_HASH_CHANGE_EVENT));
  };

  if (modulesLoading) {
    return (
      <AppLayout title="Gamificação">
        <div
          className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Verificando acesso ao módulo...
        </div>
      </AppLayout>
    );
  }

  if (modulesError) {
    return (
      <AppLayout title="Gamificação">
        <div
          className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
          <ShieldOff
            className="mb-3 h-9 w-9 text-destructive"
            aria-hidden="true"
          />
          <h1 className="text-lg font-medium">
            Não foi possível verificar o acesso à gamificação
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            O estado do módulo não pôde ser consultado. Tente novamente antes de
            continuar.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetchModules()}
          >
            Tentar novamente
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!moduleEnabled) {
    return (
      <AppLayout title="Gamificação">
        <div className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
          <ShieldOff
            className="mb-3 h-9 w-9 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-lg font-medium">
            Módulo de gamificação indisponível
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Este módulo não está habilitado para a organização selecionada.
            Solicite a ativação ao administrador da conta.
          </p>
        </div>
      </AppLayout>
    );
  }

  if (overviewEnabled && error && !overview) {
    const moduleUnavailable =
      error instanceof VimobAPIError &&
      error.status === 403 &&
      error.code === "module_unavailable";
    return (
      <AppLayout title="Gamificação">
        <div
          className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
          <ShieldOff
            className="mb-3 h-9 w-9 text-destructive"
            aria-hidden="true"
          />
          <h1 className="text-lg font-medium">
            {moduleUnavailable
              ? "Módulo de gamificação indisponível"
              : "Não foi possível carregar a gamificação"}
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {moduleUnavailable
              ? "A organização selecionada não possui acesso a este módulo."
              : getFriendlyErrorMessage(error)}
          </p>
          {!moduleUnavailable && (
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void refetch()}
            >
              Tentar novamente
            </Button>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Gamificação">
      <div className="space-y-5">
        <ArenaCelebration active={showCelebration} />
        {overviewEnabled && error && overview && (
          <div
            className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground"
            role="alert"
          >
            <span>Os dados podem estar desatualizados.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
            >
              Atualizar novamente
            </Button>
          </div>
        )}

        <Tabs
          data-tour="gamification-tabs"
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-5"
        >
          <div
            data-collapse="compact"
            className="app-responsive-tab-list min-w-0"
          >
            <TabsList
              data-responsive-tab-scroll
              aria-label="Seções de gamificação"
              className="inline-flex h-auto w-fit max-w-full justify-start gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1"
            >
              <ConfigTab value="arena" icon={Trophy} label="Arena" />
              <ConfigTab
                value="dashboard"
                icon={BarChart3}
                label="Meu painel"
              />
              <ConfigTab value="history" icon={History} label="Histórico" />
              {canManage && (
                <ConfigTab value="config" icon={Settings} label="Configuração" />
              )}
            </TabsList>
          </div>
          <TabsContent
            data-tour="gamification-arena"
            value="arena"
            className="mt-0"
          >
            <ArenaView />
          </TabsContent>

          <TabsContent
            data-tour="gamification-dashboard"
            value="dashboard"
            className="mt-0"
          >
            {isLoading && !overview ? (
              <div
                className="app-card flex min-h-[260px] items-center justify-center gap-3 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Carregando painel...
              </div>
            ) : (
              <DashboardView data={data} admin={admin} snapshot={snapshot} />
            )}
          </TabsContent>

          <TabsContent
            data-tour="gamification-history"
            value="history"
            className="mt-0"
          >
            <HistoryView />
          </TabsContent>

          {canManage && (
            <TabsContent
              data-tour="gamification-config"
              value="config"
              className="mt-0"
            >
              <AdminView
                admin={admin}
                snapshot={snapshot}
                isLoading={admin.isLoading}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}

function ConfigTab({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      data-responsive-tab
      aria-label={label}
      title={label}
      className="h-8 shrink-0 gap-1.5 rounded-[6px] border-0 px-3 text-xs font-medium text-muted-foreground shadow-none transition-colors data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="app-responsive-tab-label">{label}</span>
    </TabsTrigger>
  );
}

function ArenaCelebration({ active }: { active: boolean }) {
  if (!active) return null;

  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-14 z-[70] flex justify-center overflow-hidden"
      aria-hidden="true"
    >
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
            style={
              {
                left: `${8 + ((index * 17) % 84)}%`,
                top: `${(index * 11) % 28}px`,
                backgroundColor: colors[index % colors.length],
                animation: `arena-confetti ${1.25 + (index % 5) * 0.08}s ease-out ${index * 0.025}s forwards`,
                "--arena-x": `${(index % 2 === 0 ? 1 : -1) * (28 + (index % 6) * 10)}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

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

function ArenaView() {
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

function DashboardView({
  data,
  admin,
  snapshot,
}: {
  data: GamificationOverview;
  admin: AdminHook;
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
      <HistoryView events={data.recentEvents} compact />
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
        <EmptyPanel title="Ainda não há dados suficientes para o gráfico" compact />
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
            <EmptyPanel title="Nenhuma atividade distribuída neste período" compact />
          </div>
        ) : data.performance.distribution.map((item) => {
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
        })}
      </div>
    </section>
  );
}

function ManualEntrySubmitCard({
  admin,
  entries,
}: {
  admin: AdminHook;
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

function HistoryView({
  events = [],
  compact = false,
}: {
  events?: GamificationEvent[];
  compact?: boolean;
}) {
  const [period, setPeriod] = useState("all");
  const [historyFrom, setHistoryFrom] = useState<string | null>(null);
  const handlePeriodChange = (value: string) => {
    setPeriod(value);
    setHistoryFrom(
      value === "all"
        ? null
        : startOfDay(subDays(new Date(), Number(value) - 1)).toISOString(),
    );
  };
  const historyFilters = useMemo(() => {
    if (!historyFrom) return { limit: 50 };
    return {
      from: historyFrom,
      limit: 50,
    };
  }, [historyFrom]);
  const historyQuery = useGamificationEvents(
    historyFilters,
    !compact && (period === "all" || historyFrom !== null),
  );
  const visibleEvents = compact ? events.slice(0, 8) : historyQuery.events;
  const totalEvents = compact ? visibleEvents.length : historyQuery.total;

  return (
    <section className="app-card overflow-hidden">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <PanelTitle
          icon={History}
          eyebrow="Transparência"
          title={compact ? "Atividades recentes" : "Histórico de pontuação"}
          showIcon={false}
        />
        <div className="flex items-center gap-2">
          {!compact && (
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="all">Todo período</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Badge variant="secondary">
            {visibleEvents.length < totalEvents
              ? `${visibleEvents.length} de ${totalEvents}`
              : `${totalEvents} registros`}
          </Badge>
        </div>
      </div>

      {!compact && historyQuery.error && visibleEvents.length > 0 && (
        <div
          className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <span>O histórico pode estar desatualizado.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void historyQuery.refetch()}
          >
            Atualizar novamente
          </Button>
        </div>
      )}

      {!compact && historyQuery.isLoading ? (
        <div
          className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico...
        </div>
      ) : !compact && historyQuery.error && visibleEvents.length === 0 ? (
        <div
          className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-4 text-center"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Não foi possível carregar o histórico.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void historyQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : visibleEvents.length === 0 ? (
        <EmptyPanel title="Nenhuma atividade registrada ainda" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y border-border/60 bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Ação</th>
                  <th className="px-4 py-3 text-left font-medium">Usuário</th>
                  <th className="px-4 py-3 text-left font-medium">Origem</th>
                  <th className="px-4 py-3 text-right font-medium">Pontos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visibleEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">
                        {getEventLabel(event.eventType)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">{event.userName}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {SOURCE_LABELS[event.source || "system"] ||
                        event.source ||
                        "Sistema"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      +{formatNumber(event.points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!compact && historyQuery.hasNextPage && (
            <div className="flex justify-center border-t border-border/50 p-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void historyQuery.fetchNextPage()}
                disabled={historyQuery.isFetchingNextPage}
              >
                {historyQuery.isFetchingNextPage && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

type AdminHook = ReturnType<typeof useGamificationAdmin>;

function AdminView({
  admin,
  snapshot,
  isLoading,
}: {
  admin: AdminHook;
  snapshot: GamificationAdminSnapshot;
  isLoading: boolean;
}) {
  if (admin.error && !admin.snapshot) {
    return (
      <div
        className="app-card flex min-h-[220px] flex-col items-center justify-center px-6 text-center"
        role="alert"
      >
        <ShieldOff
          className="mb-3 h-8 w-8 text-destructive"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">
          Não foi possível verificar o acesso administrativo.
        </p>
        <p className="mt-2 max-w-md text-xs text-muted-foreground">
          {getFriendlyErrorMessage(admin.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void admin.refetch()}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app-card flex min-h-[260px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        Carregando configurações da arena...
      </div>
    );
  }

  if (!snapshot.canManage) {
    return (
      <div className="app-card flex min-h-[220px] flex-col items-center justify-center text-center text-muted-foreground">
        <ShieldOff className="mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">
          Você não possui a permissão de gerenciar gamificação.
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="rules" className="space-y-5">
      <div>
        <p className="text-[10px] font-normal text-primary">
          Configuração
        </p>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          Gestão de gamificação
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ajuste regras, missões, participantes, temporada e aprovações manuais.
        </p>
      </div>

      <div data-collapse="wide" className="app-responsive-tab-list min-w-0">
        <TabsList
          data-responsive-tab-scroll
          aria-label="Configurações de gamificação"
          className="inline-flex h-auto w-fit max-w-full justify-start gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1"
        >
          <ConfigTab value="rules" icon={Settings} label="Regras" />
          <ConfigTab value="missions" icon={Target} label="Missões" />
          <ConfigTab value="participants" icon={Users} label="Participantes" />
          <ConfigTab value="seasons" icon={Flag} label="Temporada" />
          <ConfigTab value="manual" icon={ClipboardCheck} label="Aprovações" />
        </TabsList>
      </div>

      <TabsContent value="rules" className="mt-0">
        <RulesAdmin rules={snapshot.rules} admin={admin} />
      </TabsContent>
      <TabsContent value="missions" className="mt-0">
        <MissionsAdmin
          missions={snapshot.missions}
          users={snapshot.users}
          admin={admin}
        />
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

function RulesAdmin({
  rules,
  admin,
}: {
  rules: GamificationRule[];
  admin: AdminHook;
}) {
  const [editing, setEditing] = useState<Record<string, number>>({});

  return (
    <section className="app-card p-4">
      <PanelTitle
        icon={Settings}
        eyebrow="Configuração"
        title="Regras de pontuação"
        showIcon={false}
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rules.length === 0 ? (
          <div className="md:col-span-2">
            <EmptyPanel title="Nenhuma regra de pontuação disponível" compact />
          </div>
        ) : rules.map((rule) => {
          const Icon = RULE_ICONS[rule.actionType] || Trophy;
          const points = editing[rule.actionType] ?? rule.points;
          return (
            <div
              key={rule.actionType}
              className="flex items-center justify-between gap-3 rounded-md bg-[var(--app-surface-soft)] p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {getEventLabel(rule.actionType)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rule.isActive ? "Ativa" : "Inativa"}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100000}
                  className="h-9 w-20"
                  value={points}
                  disabled={admin.upsertRule.isPending}
                  onChange={(event) =>
                    setEditing((current) => ({
                      ...current,
                      [rule.actionType]: Number(event.target.value) || 0,
                    }))
                  }
                />
                <Switch
                  checked={rule.isActive}
                  disabled={admin.upsertRule.isPending}
                  onCheckedChange={(checked) =>
                    admin.upsertRule.mutate({
                      actionType: rule.actionType,
                      points,
                      isActive: checked,
                    })
                  }
                  aria-label={`${rule.isActive ? "Desativar" : "Ativar"} regra ${getEventLabel(rule.actionType)}`}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    admin.upsertRule.mutate({
                      actionType: rule.actionType,
                      points,
                      isActive: rule.isActive,
                    })
                  }
                  disabled={admin.upsertRule.isPending}
                  aria-label={`Salvar pontos de ${getEventLabel(rule.actionType)}`}
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
  users: GamificationAdminSnapshot["users"];
  admin: AdminHook;
}) {
  const [form, setForm] = useState<MissionDraft>({
    title: "",
    description: "",
    actionType: "call_made",
    targetCount: 10,
    bonusPoints: 100,
    period: "daily",
    targetScope: "organization" as "organization" | "user",
    targetUserId: "",
    isActive: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [missionToDelete, setMissionToDelete] =
    useState<GamificationMission | null>(null);
  const editingMissionHasProgress = editingId
    ? missions.some(
        (mission) => mission.id === editingId && mission.currentProgress > 0,
      )
    : false;
  const missionFormPending =
    admin.createMission.isPending || admin.updateMission.isPending;

  const resetForm = () => {
    setEditingId(null);
    setForm({
      title: "",
      description: "",
      actionType: "call_made",
      targetCount: 10,
      bonusPoints: 100,
      period: "daily",
      targetScope: "organization",
      targetUserId: "",
      isActive: true,
    });
  };

  const startEdit = (mission: GamificationMission) => {
    setEditingId(mission.id);
    setForm({
      title: mission.title,
      description: mission.description || "",
      actionType: mission.actionType || "call_made",
      targetCount: mission.targetCount || 1,
      bonusPoints: mission.bonusPoints || 0,
      period: mission.period || "daily",
      targetScope: mission.targetScope === "user" ? "user" : "organization",
      targetUserId: mission.targetUserId || "",
      isActive: mission.isActive,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      title: form.title,
      description: form.description || null,
      actionType: form.actionType,
      targetCount: form.targetCount,
      bonusPoints: form.bonusPoints,
      period: form.period,
      targetScope: form.targetScope,
      targetUserId: form.targetScope === "user" ? form.targetUserId : null,
      isActive: form.isActive,
    };
    if (editingId) {
      admin.updateMission.mutate(
        { id: editingId, mission: payload },
        { onSuccess: resetForm },
      );
      return;
    }
    admin.createMission.mutate(payload, { onSuccess: resetForm });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle
          icon={Plus}
          eyebrow="Missões"
          title={editingId ? "Editar missão" : "Nova missão"}
          showIcon={false}
        />
        {editingMissionHasProgress && (
          <p
            className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
            role="note"
          >
            Esta missão já possui progresso. Ação, período, meta, bônus e
            público ficam bloqueados para preservar o histórico.
          </p>
        )}
        <Field label="Título">
          <Input
            value={form.title}
            disabled={missionFormPending}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            required
          />
        </Field>
        <Field label="Descrição">
          <Input
            value={form.description}
            disabled={missionFormPending}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ação">
            <Select
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.actionType}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  actionType: value as GamificationActionType,
                })
              }
            >
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
          <Field label="Período">
            <Select
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.period}
              onValueChange={(value) => setForm({ ...form, period: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Meta">
            <Input
              type="number"
              min={1}
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.targetCount}
              onChange={(event) =>
                setForm({
                  ...form,
                  targetCount: Number(event.target.value) || 1,
                })
              }
            />
          </Field>
          <Field label="Bônus">
            <Input
              type="number"
              min={0}
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.bonusPoints}
              onChange={(event) =>
                setForm({
                  ...form,
                  bonusPoints: Number(event.target.value) || 0,
                })
              }
            />
          </Field>
        </div>
        <Field label="Público">
          <Select
            disabled={editingMissionHasProgress || missionFormPending}
            value={form.targetScope}
            onValueChange={(value: "organization" | "user") =>
              setForm({ ...form, targetScope: value, targetUserId: "" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Toda a equipe</SelectItem>
              <SelectItem value="user">Pessoa específica</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {form.targetScope === "user" && (
          <Field label="Participante">
            <Select
              disabled={editingMissionHasProgress || missionFormPending}
              value={form.targetUserId}
              onValueChange={(value) =>
                setForm({ ...form, targetUserId: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {users.length === 0 ? (
                  <SelectItem value="unavailable" disabled>
                    Nenhum participante disponível
                  </SelectItem>
                ) : (
                  users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="flex gap-2">
          {editingId && (
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={resetForm}
              disabled={missionFormPending}
            >
              Cancelar
            </Button>
          )}
          <Button
            type="submit"
            className="flex-1"
            disabled={
              missionFormPending ||
              form.title.trim().length < 2 ||
              (form.targetScope === "user" && !form.targetUserId)
            }
          >
            {missionFormPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editingId ? "Salvar missão" : "Criar missão"}
          </Button>
        </div>
      </form>

      <section className="app-card p-4">
        <PanelTitle
          icon={Target}
          eyebrow="Missões"
          title="Missões configuradas"
        />
        <div className="mt-4 space-y-3">
          {missions.length === 0 ? (
            <EmptyPanel title="Nenhuma missão criada ainda" compact />
          ) : (
            missions.map((mission) => (
              <div
                key={mission.id}
                className="rounded-md bg-[var(--app-surface-soft)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {mission.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mission.description || "Sem descrição"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={mission.isActive ? "default" : "secondary"}>
                      {mission.isActive ? "Ativa" : "Inativa"}
                    </Badge>
                    <Switch
                      checked={mission.isActive}
                      disabled={admin.updateMission.isPending}
                      onCheckedChange={(checked) =>
                        admin.updateMission.mutate({
                          id: mission.id,
                          mission: {
                            title: mission.title,
                            description: mission.description || null,
                            actionType: mission.actionType || "call_made",
                            targetCount: mission.targetCount,
                            bonusPoints: mission.bonusPoints,
                            period: mission.period || "daily",
                            targetScope:
                              mission.targetScope === "user"
                                ? "user"
                                : "organization",
                            targetUserId:
                              mission.targetScope === "user"
                                ? mission.targetUserId
                                : null,
                            isActive: checked,
                          },
                        })
                      }
                      aria-label={`${mission.isActive ? "Desativar" : "Ativar"} missão ${mission.title}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => startEdit(mission)}
                      disabled={
                        admin.updateMission.isPending ||
                        admin.deleteMission.isPending
                      }
                      aria-label={`Editar missão ${mission.title}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={
                        admin.updateMission.isPending ||
                        admin.deleteMission.isPending
                      }
                      onClick={() => setMissionToDelete(mission)}
                      aria-label={`Excluir missão ${mission.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>
                    Ação:{" "}
                    {mission.actionType
                      ? getEventLabel(mission.actionType)
                      : "--"}
                  </span>
                  <span>Meta: {mission.targetCount}</span>
                  <span>Bônus: +{mission.bonusPoints}</span>
                  <span>Período: {mission.period || "--"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <ConfirmActionDialog
        open={missionToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setMissionToDelete(null);
        }}
        title="Excluir missão?"
        description={
          missionToDelete
            ? `A missão “${missionToDelete.title}” será excluída permanentemente.`
            : "Esta ação não pode ser desfeita."
        }
        confirmLabel="Excluir missão"
        destructive
        isPending={admin.deleteMission.isPending}
        onConfirm={() => {
          if (!missionToDelete) return;
          admin.deleteMission.mutate(missionToDelete.id, {
            onSuccess: () => setMissionToDelete(null),
          });
        }}
      />
    </div>
  );
}

function ParticipantsAdmin({
  participants,
  admin,
}: {
  participants: GamificationParticipant[];
  admin: AdminHook;
}) {
  return (
    <section className="app-card p-4">
      <PanelTitle
        icon={Users}
        eyebrow="Admin"
        title="Participantes da competição"
      />
      <div className="mt-4 space-y-3">
        {participants.length === 0 ? (
          <EmptyPanel title="Nenhum participante disponível" compact />
        ) : participants.map((participant) => (
          <div
            key={participant.userId}
            className="flex items-center justify-between gap-3 rounded-md bg-[var(--app-surface-soft)] p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {participant.name}
                </p>
                {participant.role === "admin" && (
                  <Badge variant="secondary">Admin</Badge>
                )}
                {!participant.isActive && (
                  <Badge variant="outline">Usuário inativo</Badge>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {participant.email}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium">
                  {participant.participates ? "Competindo" : "Fora do ranking"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatNumber(participant.points)} pts
                </p>
              </div>
              {participant.participates ? (
                <Trophy className="h-4 w-4 text-primary" />
              ) : (
                <ShieldOff className="h-4 w-4 text-muted-foreground" />
              )}
              <Switch
                checked={participant.participates}
                onCheckedChange={(checked) =>
                  admin.setParticipant.mutate({
                    userId: participant.userId,
                    participates: checked,
                  })
                }
                disabled={
                  admin.setParticipant.isPending || !participant.isActive
                }
                aria-label={`${participant.participates ? "Remover" : "Adicionar"} ${participant.name} do ranking`}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SeasonsAdmin({
  seasons,
  admin,
}: {
  seasons: GamificationSeason[];
  admin: AdminHook;
}) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const active = seasons.find((season) => season.isActive);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || reason.trim().length < 2) return;
    setConfirmResetOpen(true);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle
          icon={RotateCcw}
          eyebrow="Temporada"
          title="Iniciar nova temporada"
        />
        {active && (
          <div className="rounded-md bg-primary/10 p-3">
            <p className="text-xs text-muted-foreground">
              Em andamento
            </p>
            <p className="font-medium">{active.name}</p>
            <p className="text-xs text-muted-foreground">
              Início: {formatDateTime(active.startedAt)}
            </p>
          </div>
        )}
        <Field label="Nome">
          <Input
            value={name}
            disabled={admin.resetSeason.isPending}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <Field label="Mensagem para equipe">
          <Textarea
            value={reason}
            disabled={admin.resetSeason.isPending}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            required
            minLength={2}
          />
        </Field>
        <Button
          type="submit"
          disabled={
            admin.resetSeason.isPending ||
            name.trim().length < 2 ||
            reason.trim().length < 2
          }
        >
          {admin.resetSeason.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flag className="h-4 w-4" />
          )}
          Iniciar temporada
        </Button>
      </form>

      <section className="app-card p-4">
        <PanelTitle icon={History} eyebrow="Temporadas" title="Histórico" />
        <div className="mt-4 space-y-3">
          {seasons.length === 0 ? (
            <EmptyPanel title="Nenhuma temporada registrada" compact />
          ) : (
            seasons.map((season) => (
              <div
                key={season.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md p-3",
                  season.isActive
                    ? "bg-primary/10"
                    : "bg-[var(--app-surface-soft)]",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {season.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(season.startedAt)}{" "}
                    {season.endedAt
                      ? `- ${formatDateTime(season.endedAt)}`
                      : ""}
                  </p>
                </div>
                {season.isActive && <Badge>Ativa</Badge>}
              </div>
            ))
          )}
        </div>
      </section>
      <ConfirmActionDialog
        open={confirmResetOpen}
        onOpenChange={setConfirmResetOpen}
        title="Iniciar nova temporada?"
        description="O ranking da temporada atual será encerrado e uma nova disputa será iniciada. O histórico anterior será preservado."
        confirmLabel="Iniciar temporada"
        isPending={admin.resetSeason.isPending}
        onConfirm={() =>
          admin.resetSeason.mutate(
            { name: name.trim(), reason: reason.trim() },
            {
              onSuccess: () => {
                setConfirmResetOpen(false);
                setName("");
                setReason("");
              },
            },
          )
        }
      />
    </div>
  );
}

function ManualEntriesAdmin({
  snapshot,
  admin,
}: {
  snapshot: GamificationAdminSnapshot;
  admin: AdminHook;
}) {
  const [form, setForm] = useState<ManualEntryDraft>({
    actionKey: "",
    quantity: 1,
    notes: "",
  });
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>(
    {},
  );

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
    <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form onSubmit={submit} className="app-card space-y-4 p-4">
        <PanelTitle
          icon={ClipboardCheck}
          eyebrow="Manual"
          title="Novo lançamento"
          showIcon={false}
        />
        <p className="text-sm text-muted-foreground">
          Aprovações são atividades enviadas pela equipe para validar pontos
          feitos fora do CRM.
        </p>
        <Field label="Tipo de atividade">
          <Select
            value={form.actionKey}
            disabled={admin.createManualEntry.isPending}
            onValueChange={(value) =>
              setForm({ ...form, actionKey: value as GamificationActionType })
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
              setForm({ ...form, quantity: Number(event.target.value) || 1 })
            }
          />
        </Field>
        <Field label="Observações / evidência">
          <Textarea
            value={form.notes}
            disabled={admin.createManualEntry.isPending}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            rows={4}
          />
        </Field>
        <Button
          type="submit"
          className="w-full"
          disabled={admin.createManualEntry.isPending || !form.actionKey}
        >
          {admin.createManualEntry.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Enviar para aprovação
        </Button>
      </form>

      <section className="space-y-4">
        <ManualEntryList
          title="Fila de aprovações e concessões"
          entries={snapshot.pendingManualEntries}
          admin={admin}
          rejectReasons={rejectReasons}
          setRejectReasons={setRejectReasons}
        />
        <ManualEntryList
          title="Minhas últimas solicitações"
          entries={snapshot.myManualEntries}
          admin={admin}
        />
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
  setRejectReasons?: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const [decision, setDecision] = useState<{
    entry: GamificationManualEntry;
    status: "approved" | "rejected";
  } | null>(null);

  const approveEntry = (entry: GamificationManualEntry) => {
    setDecision({ entry, status: "approved" });
  };

  const rejectEntry = (entry: GamificationManualEntry) => {
    const reason = rejectReasons?.[entry.id]?.trim() || "";
    if (!reason || !setRejectReasons) return;
    setDecision({ entry, status: "rejected" });
  };

  return (
    <div className="app-card p-4">
      <PanelTitle icon={ClipboardCheck} eyebrow="Manual" title={title} />
      <div className="mt-4 space-y-3">
        {entries.length === 0 ? (
          <EmptyPanel title="Nenhum lançamento encontrado" compact />
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-md bg-[var(--app-surface-soft)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {entry.userName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {getEventLabel(entry.actionKey)} ({entry.quantity}x) -{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                  {entry.notes && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {entry.notes}
                    </p>
                  )}
                  {entry.rejectionReason && (
                    <p className="mt-2 text-xs text-destructive">
                      {entry.rejectionReason}
                    </p>
                  )}
                </div>
                <ManualEntryStatusBadge entry={entry} />
              </div>

              {entry.status === "pending" &&
                rejectReasons &&
                setRejectReasons && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => approveEntry(entry)}
                      disabled={admin.decideManualEntry.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Aprovar
                    </Button>
                    <Input
                      placeholder="Motivo da rejeição"
                      value={rejectReasons[entry.id] || ""}
                      disabled={admin.decideManualEntry.isPending}
                      onChange={(event) =>
                        setRejectReasons((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => rejectEntry(entry)}
                      disabled={
                        admin.decideManualEntry.isPending ||
                        !(rejectReasons[entry.id] || "").trim()
                      }
                    >
                      Rejeitar
                    </Button>
                  </div>
                )}
            </div>
          ))
        )}
      </div>
      <ConfirmActionDialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        title={
          decision?.status === "rejected"
            ? "Rejeitar lançamento?"
            : "Aprovar lançamento?"
        }
        description={
          decision
            ? decision.status === "rejected"
              ? "A solicitação será rejeitada com o motivo informado. Esta decisão não poderá ser alterada."
              : `${decision.entry.quantity} ocorrência(s) de ${getEventLabel(decision.entry.actionKey)} serão aprovadas e a pontuação será processada em seguida.`
            : "Revise a decisão antes de continuar."
        }
        confirmLabel={
          decision?.status === "rejected" ? "Rejeitar" : "Aprovar"
        }
        destructive={decision?.status === "rejected"}
        isPending={admin.decideManualEntry.isPending}
        onConfirm={() => {
          if (!decision) return;
          const reason = rejectReasons?.[decision.entry.id]?.trim();
          if (decision.status === "rejected" && !reason) return;
          admin.decideManualEntry.mutate(
            {
              id: decision.entry.id,
              status: decision.status,
              reason:
                decision.status === "rejected" ? reason : undefined,
            },
            {
              onSuccess: () => {
                if (decision.status === "rejected" && setRejectReasons) {
                  setRejectReasons((current) => ({
                    ...current,
                    [decision.entry.id]: "",
                  }));
                }
                setDecision(null);
              },
            },
          );
        }}
      />
    </div>
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
            <p className="text-xs text-muted-foreground">
              {entry.rank}
            </p>
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

function PanelTitle({
  icon: Icon,
  eyebrow,
  title,
  showIcon = true,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  showIcon?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-normal text-primary">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-lg font-medium">{title}</h2>
      </div>
      {showIcon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
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

function EmptyPanel({
  title,
  compact = false,
}: {
  title: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center text-muted-foreground",
        compact ? "min-h-[120px]" : "min-h-[220px]",
      )}
    >
      <Trophy className="mb-3 h-8 w-8 opacity-35" />
      <p className="text-sm font-medium">{title}</p>
    </div>
  );
}
