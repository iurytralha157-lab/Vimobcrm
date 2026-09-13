import type { RoundRobinMetaFormOption } from "@/lib/api/round-robins";
import {
  hydrateQueueMembers,
  type QueueMemberDraft,
  type QueueMemberSource,
  type QueueTeamSource,
} from "@/lib/round-robin/member-context";

export interface DistributionQueueSettings {
  ignore_availability?: boolean;
  auto_tag_ids?: string[];
  enable_redistribution?: boolean;
  redistribution_timeout_minutes?: number;
  redistribution_warning_minutes?: number;
  redistribution_max_attempts?: number;
  preserve_position?: boolean;
  require_checkin?: boolean;
  reentry_behavior?: "redistribute" | "keep_assignee";
  whatsapp_distribution_auto_reply_enabled?: boolean;
  whatsapp_distribution_auto_reply_message?: string;
  whatsapp_distribution_auto_reply_delay_seconds?: number;
}

export interface DistributionQueueCondition {
  id: string;
  type:
    | "source"
    | "webhook"
    | "whatsapp_session"
    | "meta_form"
    | "website_category"
    | "campaign_contains"
    | "whatsapp_message_contains"
    | "tag"
    | "city"
    | "interest_property";
  values: string[];
  sessionId?: string;
}

export type DistributionQueueConditionType = DistributionQueueCondition["type"];
export type DistributionQueueStrategy = DistributionQueueFormData["strategy"];

export interface DistributionQueueFormData {
  name: string;
  strategy: "simple" | "weighted";
  target_pipeline_id: string;
  target_stage_id: string;
  is_active: boolean;
  settings: DistributionQueueSettings;
  conditions: DistributionQueueCondition[];
  members: QueueMemberDraft[];
}

export interface ExistingDistributionQueueRule {
  id: string;
  match_type?: string | null;
  match_value?: string | null;
  match?: unknown;
}

export type ExistingDistributionQueueMember = QueueMemberSource;

export interface ExistingDistributionQueue {
  id?: string;
  name?: string | null;
  strategy?: string | null;
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  is_active?: boolean | null;
  settings?: Partial<DistributionQueueSettings> | null;
  reentry_behavior?: "redistribute" | "keep_assignee" | null;
  rules?: ExistingDistributionQueueRule[] | null;
  members?: ExistingDistributionQueueMember[] | null;
}

export const MAX_DISTRIBUTION_QUEUE_AUTO_TAGS = 50;
export const DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY =
  "Olá! Recebemos seu interesse em um de nossos imóveis. Um de nossos corretores já foi acionado e falará com você por aqui em breve.";
export const DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 30;
export const MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH = 4000;
export const MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS = 3600;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeDistributionQueueAutoTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of value) {
    if (typeof rawValue !== "string") continue;
    const tagId = rawValue.trim().toLowerCase();
    if (!UUID_PATTERN.test(tagId) || seen.has(tagId)) continue;
    seen.add(tagId);
    normalized.push(tagId);
    if (normalized.length === MAX_DISTRIBUTION_QUEUE_AUTO_TAGS) break;
  }
  return normalized;
}

export function isValidWhatsAppDistributionAutoReplyDelay(
  value: unknown,
): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS
  );
}

export const DISTRIBUTION_QUEUE_CONDITION_TYPES = [
  { value: "source", label: "Canal de entrada" },
  { value: "webhook", label: "Webhook especifico" },
  { value: "whatsapp_session", label: "Conexao WhatsApp" },
  { value: "meta_form", label: "Formulario Meta" },
  { value: "website_category", label: "Categoria do site" },
  { value: "campaign_contains", label: "Nome da campanha contem" },
  { value: "whatsapp_message_contains", label: "Campanha de WhatsApp" },
  { value: "tag", label: "Tag" },
  { value: "city", label: "Cidade" },
  { value: "interest_property", label: "Interesse em imóvel" },
] as const;

export const DISTRIBUTION_QUEUE_SOURCE_OPTIONS = [
  { value: "meta_ads", label: "Meta Ads" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "webhook", label: "Webhook" },
  { value: "website", label: "Website" },
] as const;

export const DISTRIBUTION_QUEUE_WEBSITE_CATEGORY_OPTIONS = [
  { value: "venda", label: "Venda" },
  { value: "locacao", label: "Locacao" },
  { value: "lancamento", label: "Lancamento" },
] as const;

export function isDistributionQueueStrategy(
  value: unknown,
): value is DistributionQueueStrategy {
  return value === "simple" || value === "weighted";
}

export function isDistributionQueueConditionType(
  value: unknown,
): value is DistributionQueueConditionType {
  return (
    typeof value === "string" &&
    DISTRIBUTION_QUEUE_CONDITION_TYPES.some(
      (condition) => condition.value === value,
    )
  );
}

export function normalizeDistributionQueueConditionType(
  value: unknown,
): DistributionQueueConditionType {
  if (value === "form") return "meta_form";
  return isDistributionQueueConditionType(value) ? value : "source";
}

export function whatsappSessionIdFromQueueMatch(match: unknown): string {
  if (!match || typeof match !== "object" || Array.isArray(match)) return "";
  const sessionId = (match as Record<string, unknown>).whatsapp_session_id;
  return typeof sessionId === "string" ? sessionId.trim() : "";
}

export function createEmptyDistributionQueueFormData(): DistributionQueueFormData {
  return {
    name: "",
    strategy: "simple",
    target_pipeline_id: "",
    target_stage_id: "",
    is_active: true,
    settings: {
      auto_tag_ids: [],
      enable_redistribution: false,
      redistribution_timeout_minutes: 20,
      redistribution_warning_minutes: 5,
      redistribution_max_attempts: 10,
      preserve_position: true,
      require_checkin: false,
      reentry_behavior: "redistribute",
      whatsapp_distribution_auto_reply_enabled: false,
      whatsapp_distribution_auto_reply_message:
        DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
      whatsapp_distribution_auto_reply_delay_seconds:
        DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
    },
    conditions: [],
    members: [],
  };
}

export function hydrateDistributionQueueFormData(
  queue: ExistingDistributionQueue,
  teams: QueueTeamSource[],
): DistributionQueueFormData {
  const conditions: DistributionQueueCondition[] = (queue.rules || []).map(
    (rule) => {
      const type = normalizeDistributionQueueConditionType(rule.match_type);
      const matchValue = rule.match_value || "";
      const sessionId =
        type === "whatsapp_message_contains"
          ? whatsappSessionIdFromQueueMatch(rule.match)
          : undefined;
      const values = matchValue
        ? type === "whatsapp_message_contains"
          ? [matchValue.trim()].filter(Boolean)
          : matchValue
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
        : [];

      return { id: rule.id, type, values, sessionId };
    },
  );

  return {
    name: queue.name || "",
    strategy: isDistributionQueueStrategy(queue.strategy)
      ? queue.strategy
      : "simple",
    target_pipeline_id: queue.target_pipeline_id || "",
    target_stage_id: queue.target_stage_id || "",
    is_active: queue.is_active ?? true,
    settings: {
      ...createEmptyDistributionQueueFormData().settings,
      ...(queue.settings || {}),
      auto_tag_ids: normalizeDistributionQueueAutoTagIds(
        queue.settings?.auto_tag_ids,
      ),
      reentry_behavior:
        queue.reentry_behavior ??
        queue.settings?.reentry_behavior ??
        "redistribute",
      whatsapp_distribution_auto_reply_enabled:
        conditions.some(
          (condition) => condition.type === "whatsapp_message_contains",
        ) &&
        queue.settings?.whatsapp_distribution_auto_reply_enabled === true,
    },
    conditions,
    members: hydrateQueueMembers(queue.members || [], teams),
  };
}

export function hasValidDistributionQueueCriteria(
  conditions: DistributionQueueCondition[],
): boolean {
  return conditions.some(
    (condition) =>
      condition.values.some((value) => value.trim()) &&
      (condition.type !== "whatsapp_message_contains" ||
        Boolean(condition.sessionId?.trim())),
  );
}

export function sanitizeDistributionQueueConditions(
  conditions: DistributionQueueCondition[],
  metaForms: RoundRobinMetaFormOption[],
): DistributionQueueCondition[] {
  return conditions
    .map((condition) => {
      const trimmedValues = condition.values
        .map((value) => value.trim())
        .filter(Boolean);
      const values =
        condition.type === "meta_form"
          ? Array.from(
              new Set(
                trimmedValues.map(
                  (value) =>
                    metaForms.find((form) => form.config_id === value)
                      ?.form_id || value,
                ),
              ),
            )
          : trimmedValues;

      return {
        ...condition,
        values,
        sessionId:
          condition.type === "whatsapp_message_contains"
            ? condition.sessionId?.trim()
            : undefined,
      };
    })
    .filter((condition) => condition.values.length > 0);
}

export function findConflictingDistributionQueueMetaForm(
  conditions: DistributionQueueCondition[],
  metaForms: RoundRobinMetaFormOption[],
  queueId?: string,
): RoundRobinMetaFormOption | undefined {
  const selectedFormIds = new Set(
    conditions
      .filter((condition) => condition.type === "meta_form")
      .flatMap((condition) => condition.values),
  );

  return metaForms.find(
    (form) =>
      (selectedFormIds.has(form.form_id) ||
        selectedFormIds.has(form.config_id)) &&
      Boolean(form.round_robin_id) &&
      form.round_robin_id !== queueId,
  );
}
