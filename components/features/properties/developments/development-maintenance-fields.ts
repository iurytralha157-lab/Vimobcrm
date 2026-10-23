import type { PropertyDevelopmentMaintenanceKind } from "@/lib/validation";
import {
  BUILDING_TYPE_LABELS,
  COMMERCIAL_STATUS_LABELS,
  DEVELOPMENT_STATUS_LABELS,
  DEVELOPMENT_TYPE_LABELS,
  PHASE_STATUS_LABELS,
} from "./development-ui";

export type DevelopmentMaintenanceField = {
  key: string;
  label: string;
  type?: "number" | "date" | "textarea";
  required?: boolean;
  options?: Record<string, string>;
  maxLength?: number;
};
const COMMON: DevelopmentMaintenanceField[] = [
  { key: "code", label: "Código", required: true, maxLength: 80 },
  { key: "name", label: "Nome", required: true, maxLength: 160 },
];
const DATES: DevelopmentMaintenanceField[] = [
  { key: "launch_date", label: "Lançamento", type: "date" },
  { key: "construction_started_at", label: "Início da obra", type: "date" },
  { key: "expected_delivery_date", label: "Previsão de entrega", type: "date" },
];
export const DEVELOPMENT_MAINTENANCE_FIELDS: Record<
  PropertyDevelopmentMaintenanceKind,
  DevelopmentMaintenanceField[]
> = {
  development: [
    COMMON[0],
    { ...COMMON[1], maxLength: 200 },
    { key: "status", label: "Etapa", options: DEVELOPMENT_STATUS_LABELS },
    {
      key: "commercial_status",
      label: "Situação comercial",
      options: COMMERCIAL_STATUS_LABELS,
    },
    {
      key: "development_type",
      label: "Tipo",
      options: DEVELOPMENT_TYPE_LABELS,
    },
    {
      key: "construction_progress",
      label: "Progresso da obra (%)",
      type: "number",
    },
    { key: "registration_number", label: "Registro", maxLength: 120 },
    {
      key: "summary",
      label: "Resumo comercial",
      type: "textarea",
      maxLength: 500,
    },
    {
      key: "description",
      label: "Descrição",
      type: "textarea",
      maxLength: 10_000,
    },
    { key: "postal_code", label: "CEP", maxLength: 20 },
    { key: "address", label: "Endereço", maxLength: 240 },
    { key: "address_number", label: "Número", maxLength: 40 },
    { key: "complement", label: "Complemento", maxLength: 120 },
    { key: "neighborhood", label: "Bairro", maxLength: 120 },
    { key: "city", label: "Cidade", maxLength: 120 },
    { key: "state", label: "UF", maxLength: 2 },
    ...DATES,
  ],
  phase: [
    ...COMMON,
    { key: "status", label: "Etapa", options: PHASE_STATUS_LABELS },
    { key: "sort_order", label: "Ordem", type: "number" },
    ...DATES,
  ],
  building: [
    ...COMMON,
    {
      key: "status",
      label: "Situação",
      options: {
        planned: "Planejada",
        active: "Ativa",
        delivered: "Entregue",
        inactive: "Inativa",
      },
    },
    { key: "phase_id", label: "Fase", options: {} },
    { key: "building_type", label: "Estrutura", options: BUILDING_TYPE_LABELS },
    { key: "floor_count", label: "Andares", type: "number" },
    { key: "sort_order", label: "Ordem", type: "number" },
  ],
  floor_plan: [
    ...COMMON,
    {
      key: "status",
      label: "Situação",
      options: {
        draft: "Rascunho",
        active: "Ativa",
        inactive: "Inativa",
        archived: "Arquivada",
      },
    },
    { key: "property_type", label: "Tipo do imóvel", maxLength: 120 },
    { key: "bedrooms", label: "Quartos", type: "number" },
    { key: "suites", label: "Suítes", type: "number" },
    { key: "bathrooms", label: "Banheiros", type: "number" },
    { key: "parking_spaces", label: "Vagas", type: "number" },
    { key: "private_area", label: "Área privativa (m²)", type: "number" },
    { key: "total_area", label: "Área total (m²)", type: "number" },
    { key: "balcony_area", label: "Varanda (m²)", type: "number" },
    { key: "garden_area", label: "Jardim (m²)", type: "number" },
    {
      key: "description",
      label: "Descrição",
      type: "textarea",
      maxLength: 5_000,
    },
  ],
};
export const DEVELOPMENT_MAINTENANCE_KIND_LABELS: Record<
  PropertyDevelopmentMaintenanceKind,
  string
> = {
  development: "Empreendimento",
  phase: "Fase",
  building: "Torre ou estrutura",
  floor_plan: "Planta ou tipologia",
};
