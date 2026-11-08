/** Pure display rules shared by the catalog card and the property file. */

export const normalizeText = (value?: string | null) =>
  (value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

export type PropertyStatusKind = "available" | "reserved" | "sold" | "rented" | "inactive" | "draft" | "archived";

export function propertyStatusKind(status?: string | null): PropertyStatusKind {
  const normalized = normalizeText(status);
  if (["vendido", "sold"].includes(normalized)) return "sold";
  if (["alugado", "locado", "rented"].includes(normalized)) return "rented";
  if (["reservado", "reserved"].includes(normalized)) return "reserved";
  if (["inativo", "inactive"].includes(normalized)) return "inactive";
  if (["draft", "rascunho"].includes(normalized)) return "draft";
  if (["arquivado", "archived", "privado", "private"].includes(normalized)) return "archived";
  return "available";
}

export const PROPERTY_STATUS_LABELS: Record<PropertyStatusKind, string> = {
  available: "Disponível",
  reserved: "Reservado",
  sold: "Vendido",
  rented: "Alugado",
  inactive: "Inativo",
  draft: "Rascunho",
  archived: "Arquivado",
};

export const PROPERTY_DEAL_LABELS: Record<string, string> = {
  venda: "Venda",
  aluguel: "Locação",
  locacao: "Locação",
  "venda e aluguel": "Venda e locação",
  "venda e locacao": "Venda e locação",
  temporada: "Temporada",
  lancamento: "Lançamento",
};

export function propertyDealLabel(deal?: string | null) {
  return PROPERTY_DEAL_LABELS[normalizeText(deal)] ?? deal ?? "";
}

export const PROPERTY_PORTFOLIO_LABELS: Record<string, string> = {
  ready: "Pronto",
  launch: "Lançamento",
  third_party: "De terceiro",
};

/** Whole reais in cards and summaries; cents only when the value has them. */
export function formatPropertyMoney(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function pricePerSquareMeter(price: number | null | undefined, area: number | null | undefined) {
  if (!price || !area || price <= 0 || area <= 0) return null;
  return Math.round(price / area);
}

export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

type PersonLike = { id: string; name?: string | null; avatar_url?: string | null };

/** Never falls back to the raw id: an unknown person simply shows nothing. */
export function findPropertyPerson<T extends PersonLike>(people: readonly T[], ...ids: Array<string | null | undefined>) {
  for (const id of ids) {
    if (!id) continue;
    const person = people.find((item) => item.id === id);
    if (person?.name?.trim()) return { name: person.name.trim(), avatarUrl: person.avatar_url ?? null };
  }
  return null;
}
