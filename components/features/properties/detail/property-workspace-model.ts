import { getSafePropertyImageSource } from "@/lib/property-media";
import type {
  PropertyWorkspaceAsset,
  PropertyWorkspaceKey,
  PropertyWorkspacePayload,
} from "@/lib/validation";

export type WorkspaceProperty = PropertyWorkspacePayload["property"];
export type WorkspaceSummary = PropertyWorkspacePayload["summary"];

/** Viewer-specific projection: a missing key means the viewer may not see that field. */
export function hasField(property: WorkspaceProperty, field: keyof WorkspaceProperty) {
  return Object.prototype.hasOwnProperty.call(property, field);
}

export function localDateISO(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function collectPropertyImages(
  property: Pick<WorkspaceProperty, "imagem_principal" | "image_urls" | "fotos">,
  assets: PropertyWorkspaceAsset[],
  hasCanonicalPhotos: boolean,
) {
  const normalizedPhotos = assets
    .filter((asset) => asset.asset_type === "photo")
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order)
    .map((asset) => getSafePropertyImageSource(asset.access_url || asset.external_url))
    .filter((value): value is string => Boolean(value));
  const legacyImages = [property.imagem_principal, ...(property.image_urls ?? [])];
  if (Array.isArray(property.fotos)) {
    legacyImages.push(...property.fotos.filter((value): value is string => typeof value === "string"));
  }
  const safeLegacyImages = legacyImages
    .map((value) => getSafePropertyImageSource(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(hasCanonicalPhotos ? normalizedPhotos : safeLegacyImages));
}

const CHECK_MESSAGES: Record<string, string> = {
  title: "Falta o título comercial",
  type: "Falta o tipo do imóvel",
  location: "Falta bairro, cidade ou UF",
  description: "Falta a descrição para publicação",
  offer: "Sem oferta ativa com valor",
  photo: "Sem foto pública",
  owner: "Sem proprietário vinculado",
  responsible: "Sem corretor responsável",
  status: "Imóvel não está disponível para divulgação",
};

export type AttentionTone = "warning" | "danger" | "success";
export type AttentionItem = { key: string; title: string; detail?: string; tone: AttentionTone };

function daysUntil(dateISO: string, today: string) {
  const day = 86_400_000;
  return Math.round((Date.parse(dateISO.slice(0, 10)) - Date.parse(today)) / day);
}

function expiryAttention(key: string, name: string, dateISO: string, today: string): AttentionItem | null {
  const days = daysUntil(dateISO, today);
  if (Number.isNaN(days) || days > 30) return null;
  return days < 0
    ? { key, title: `${name} venceu há ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}`, tone: "danger" }
    : { key, title: `${name} vence em ${days} ${days === 1 ? "dia" : "dias"}`, tone: "warning" };
}

/** Everything comes from data this viewer already received; nothing is estimated. */
export function buildAttentionItems(input: {
  property: WorkspaceProperty;
  summary: WorkspaceSummary;
  assets: PropertyWorkspaceAsset[];
  keys: PropertyWorkspaceKey[];
  today: string;
}): AttentionItem[] {
  const { property, summary, assets, keys, today } = input;
  const items: AttentionItem[] = [];
  if (property.third_party_authorized_until) {
    const item = expiryAttention("third-party", "Autorização do terceiro", property.third_party_authorized_until, today);
    if (item) items.push(item);
  }
  for (const asset of assets) {
    if (asset.asset_type !== "document" || !asset.expires_at) continue;
    const item = expiryAttention(`document-${asset.id}`, asset.document_category || "Documento", asset.expires_at, today);
    if (item) items.push(item);
  }
  for (const check of summary.checklist) {
    if (!check.resolved) items.push({ key: `check-${check.code}`, title: CHECK_MESSAGES[check.code] ?? check.label, tone: "warning" });
  }
  for (const propertyKey of keys) {
    if (propertyKey.status === "lost") {
      items.push({ key: `key-${propertyKey.id}`, title: `${propertyKey.label} marcada como perdida`, tone: "danger" });
    } else if (propertyKey.status === "checked_out" && propertyKey.expected_return_at && Date.parse(propertyKey.expected_return_at) < Date.now()) {
      items.push({
        key: `key-${propertyKey.id}`,
        title: `Devolução atrasada: ${propertyKey.label}`,
        detail: propertyKey.holder_name ? `Com ${propertyKey.holder_name}` : undefined,
        tone: "danger",
      });
    } else if (propertyKey.status === "available") {
      items.push({
        key: `key-${propertyKey.id}`,
        title: `${propertyKey.label} disponível`,
        detail: propertyKey.current_location ?? undefined,
        tone: "success",
      });
    }
  }
  return items;
}

export function countOverdueKeys(keys: PropertyWorkspaceKey[], now = Date.now()) {
  return keys.filter((key) => key.expected_return_at && Date.parse(key.expected_return_at) < now).length;
}

export type HistoryCategory = "value" | "publication" | "keys" | "commercial" | "registration";

export const HISTORY_CATEGORY_LABELS: Record<HistoryCategory, string> = {
  value: "Valor",
  publication: "Publicação",
  keys: "Chaves",
  commercial: "Comercial",
  registration: "Cadastro",
};

/** Event types are technical identifiers: the UI shows only the group they belong to. */
export function historyCategory(type: string): HistoryCategory {
  const normalized = type.toLowerCase();
  if (/price|preco|valor/.test(normalized)) return "value";
  if (/publication|publish|site|portal|grupo_olx/.test(normalized)) return "publication";
  if (/key|chave/.test(normalized)) return "keys";
  if (/offer|owner|ownership|proposal|schedule|commission|status/.test(normalized)) return "commercial";
  return "registration";
}

export const KEY_MOVEMENT_LABELS: Record<string, string> = {
  registration: "Cadastro",
  checkout: "Retirada",
  transfer: "Transferência",
  return: "Devolução",
  location_change: "Mudança de local",
  mark_lost: "Marcada como perdida",
  mark_found: "Localizada",
  deactivate: "Desativada",
  reactivate: "Reativada",
};

export const ADDRESS_VISIBILITY_LABELS: Record<string, string> = {
  completo: "Endereço completo",
  parcial: "Endereço parcial",
  minimo: "Só a região",
};
