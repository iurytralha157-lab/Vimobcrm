import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
export { getInitials } from "@/lib/user-display";
import { formatPtBRNumber } from "@/lib/utils/formatting";

import type {
  GamificationActionType,
  GamificationAdminSnapshot,
  GamificationOverview,
  GamificationRankingEntry,
  useGamificationAdmin,
} from "@/hooks/gamification";

export const ACTION_LABELS: Record<string, string> = {
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

export const SOURCE_LABELS: Record<string, string> = {
  system: "Sistema",
  manual_entry: "Manual",
  lead: "Leads",
  whatsapp: "WhatsApp",
  schedule: "Agenda",
};

export const ACTION_OPTIONS: GamificationActionType[] = [
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

export type ManualEntryDraft = {
  actionKey: GamificationActionType | "";
  quantity: number;
  notes: string;
};

export type MissionDraft = {
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

export const EMPTY_GAMIFICATION_OVERVIEW: GamificationOverview = {
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

export const EMPTY_ADMIN_SNAPSHOT: GamificationAdminSnapshot = {
  rules: [],
  missions: [],
  participants: [],
  seasons: [],
  myManualEntries: [],
  pendingManualEntries: [],
  users: [],
  canManage: false,
};

export type GamificationTab = "arena" | "dashboard" | "history" | "config";

export type GamificationAdminController = ReturnType<
  typeof useGamificationAdmin
>;

export function tabFromHash(hash: string): GamificationTab {
  const clean = hash.replace("#", "");
  if (clean === "rankings") return "arena";
  if (clean === "dashboard" || clean === "history" || clean === "config") {
    return clean;
  }
  if (clean === "admin") return "config";
  return "arena";
}

export function formatNumber(value: number) {
  return formatPtBRNumber(value);
}

export function normalizeActionKey(type: string | null | undefined) {
  const key = String(type || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");
  return ACTION_ALIASES[key] || key;
}

export function getEventLabel(type: string) {
  const key = normalizeActionKey(type);
  return ACTION_LABELS[key] || key.replaceAll("_", " ");
}

export function formatDateTime(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

export function getProgress(entry: GamificationRankingEntry) {
  if (entry.xpNextLevel <= 0) return 0;
  return Math.min(
    100,
    Math.round((entry.xpCurrentLevel / entry.xpNextLevel) * 100),
  );
}
