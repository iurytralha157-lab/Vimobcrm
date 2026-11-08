import type { PortfolioSettings } from "@/lib/validation";

export type PortfolioGroupKey = keyof PortfolioSettings;

type BooleanRow = { type: "boolean" };
type NumberRow = { type: "number"; min: number; max: number; step?: number; unit: string };
type SelectRow = { type: "select"; options: Array<{ value: string; label: string }> };
type ListRow = { type: "list"; placeholder: string };

export type PortfolioSettingRow = {
  key: string;
  label: string;
  hint: string;
} & (BooleanRow | NumberRow | SelectRow | ListRow);

export type PropertySettingsGroupId =
  | "general" | "ready" | "launches" | "rentals" | "third_party"
  | "condominiums" | "locations" | "owners" | "keys" | "publication";

export type PropertySettingsGroup = {
  id: PropertySettingsGroupId;
  label: string;
  rows: PortfolioSettingRow[];
};

const percent = (key: string, label: string, hint: string): PortfolioSettingRow =>
  ({ key, label, hint, type: "number", min: 0, max: 100, step: 0.5, unit: "%" });
const days = (key: string, label: string, hint: string): PortfolioSettingRow =>
  ({ key, label, hint, type: "number", min: 0, max: 3650, unit: "dias" });
const hours = (key: string, label: string, hint: string): PortfolioSettingRow =>
  ({ key, label, hint, type: "number", min: 1, max: 8760, unit: "horas" });
const toggle = (key: string, label: string, hint: string): PortfolioSettingRow =>
  ({ key, label, hint, type: "boolean" });

/** Keys mirror portfolioSettingsSchema; anything else would be refused by the API. */
export const PROPERTY_SETTINGS_GROUPS: PropertySettingsGroup[] = [
  {
    id: "general",
    label: "Geral",
    rows: [
      toggle("auto_code", "Código automático", "Prefixo por tipo, como AP, CA e CO"),
      { key: "required_fields", label: "Campos obrigatórios", hint: "O que trava o botão Cadastrar", type: "number", min: 0, max: 100, unit: "campos" },
      toggle("duplicate_warning", "Avisar imóvel duplicado", "Compara endereço, complemento e proprietário"),
      { key: "min_completeness_pct", label: "Mínimo para publicar", hint: "Cadastro completo a partir de", type: "number", min: 0, max: 100, unit: "%" },
      { key: "min_photos", label: "Mínimo de fotos", hint: "Antes de publicar", type: "number", min: 0, max: 20, unit: "fotos" },
      days("price_review_days", "Revisar preço a cada", "Lembra o responsável"),
    ],
  },
  {
    id: "ready",
    label: "Prontos",
    rows: [
      toggle("require_authorization", "Exigir autorização de venda", "Antes de divulgar"),
      days("authorization_warning_days", "Avisar vencimento da autorização", "Antes de vencer"),
      days("exclusivity_days", "Prazo padrão de exclusividade", "Em novos cadastros"),
      percent("default_sale_commission_pct", "Comissão de venda padrão", "Em novos cadastros"),
    ],
  },
  {
    id: "launches",
    label: "Lançamentos",
    rows: [
      percent("commission_pct", "Comissão padrão", "Em unidades de empreendimento"),
      days("table_warning_days", "Avisar tabela desatualizada", "Sem revisão há"),
      hours("reservation_hours", "Validade da reserva", "Antes de liberar a unidade"),
      {
        key: "reservation_approver",
        label: "Quem aprova reservas",
        hint: "Perfil responsável pela aprovação",
        type: "select",
        options: [{ value: "manager", label: "Gestor" }, { value: "admin", label: "Administrador" }],
      },
      toggle("broker_sees_sold", "Corretor vê unidades vendidas", "No espelho de vendas"),
    ],
  },
  {
    id: "rentals",
    label: "Aluguel",
    rows: [
      {
        key: "adjustment_index",
        label: "Índice de reajuste",
        hint: "Padrão em novos contratos",
        type: "select",
        options: ["IPCA", "IGP-M", "INPC"].map((value) => ({ value, label: value })),
      },
      { key: "guarantees", label: "Garantias aceitas", hint: "Separe por vírgula", type: "list", placeholder: "Fiador, Seguro fiança" },
      percent("admin_fee_pct", "Taxa de administração", "Sobre o aluguel"),
      percent("first_rent_fee_pct", "Taxa do primeiro aluguel", "Sobre o primeiro mês"),
      toggle("require_inspection", "Exigir vistoria", "Antes da entrega das chaves"),
      days("contract_warning_days", "Avisar fim de contrato", "Antes de vencer"),
    ],
  },
  {
    id: "third_party",
    label: "Terceiros",
    rows: [
      percent("default_split_pct", "Divisão padrão de comissão", "Parte da imobiliária"),
      toggle("require_authorization", "Exigir autorização", "Do parceiro ou proprietário particular"),
      days("partnership_days", "Prazo padrão da parceria", "Em novos cadastros"),
      toggle("publish_on_site", "Publicar no site", "Permite imóvel de terceiro no site"),
      toggle("show_partner_to_brokers", "Mostrar parceiro aos corretores", "Nome do parceiro na ficha"),
    ],
  },
  {
    id: "condominiums",
    label: "Condomínios",
    rows: [
      toggle("brokers_can_create", "Corretor pode cadastrar", "Sem passar por um gestor"),
      toggle("apply_default_fee", "Aplicar taxa padrão", "Ao escolher o condomínio no imóvel"),
    ],
  },
  {
    id: "locations",
    label: "Localidades",
    rows: [
      toggle("brokers_can_create_neighborhood", "Corretor pode criar bairro", "Sem passar por um gestor"),
      {
        key: "default_address_visibility",
        label: "Endereço no site",
        hint: "Padrão em novos cadastros",
        type: "select",
        options: [
          { value: "full", label: "Completo" },
          { value: "partial", label: "Parcial" },
          { value: "neighborhood", label: "Só o bairro" },
        ],
      },
    ],
  },
  {
    id: "owners",
    label: "Proprietários",
    rows: [
      toggle("email_notices", "Avisos por e-mail", "Quando houver novidade no imóvel"),
      toggle("monthly_report", "Relatório mensal", "Resumo enviado ao proprietário"),
    ],
  },
  {
    id: "keys",
    label: "Chaves",
    rows: [
      hours("return_hours", "Prazo de devolução", "Depois da retirada"),
      toggle("late_alert", "Alertar atraso", "Avisa quando passa do prazo"),
      toggle("require_reason", "Exigir motivo", "Ao registrar retirada"),
      { key: "locations", label: "Locais de guarda", hint: "Separe por vírgula", type: "list", placeholder: "Recepção, Gaveta 12" },
    ],
  },
  {
    id: "publication",
    label: "Publicação",
    rows: [
      toggle("auto_publish", "Publicar automaticamente", "Ao ficar pronto"),
      { key: "default_channels", label: "Canais padrão", hint: "Separe por vírgula", type: "list", placeholder: "Site, ZAP" },
      toggle("watermark", "Marca d'água nas fotos", "Nas fotos enviadas aos canais"),
      toggle("manager_approval", "Aprovação do gestor", "Antes de publicar"),
    ],
  },
];

export const PORTFOLIO_SETTINGS_PENDING_NOTICE = "Salva a preferência. Ainda não altera o sistema.";

type Draft = Record<string, Record<string, unknown>>;

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Only the keys that changed, so the API merge cannot overwrite someone else's edit. */
export function buildPortfolioSettingsPatch(saved: PortfolioSettings, draft: PortfolioSettings) {
  const patch: Draft = {};
  for (const [group, values] of Object.entries(draft as unknown as Draft)) {
    for (const [key, value] of Object.entries(values)) {
      if (!sameValue(value, (saved as unknown as Draft)[group]?.[key])) {
        patch[group] = { ...patch[group], [key]: value };
      }
    }
  }
  return patch;
}

export function parseSettingsList(text: string) {
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}
