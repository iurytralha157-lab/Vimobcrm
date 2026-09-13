import type { Property } from "@/hooks/use-properties";
import {
  getPropertyPhotoCount,
  PROPERTY_MEDIA_MAX_PHOTOS,
  withoutEphemeralPropertyMedia,
} from "@/lib/property-media-draft";
import {
  removePropertyOwnerMutationFields,
  shouldRequirePropertyOwnerDetails,
} from "./property-owner-privacy";
import { formatFixedBRLCurrency } from "@/lib/utils/formatting";
export interface PropertyFormData {
  // Existing fields
  title: string;
  tipo_de_imovel: string;
  tipo_de_negocio: string;
  status: string;
  destaque: boolean;
  endereco: string;
  numero: string;
  complemento: string;
  quadra: string;
  lote: string;
  bairro: string;
  cidade: string;
  city_id: string;
  uf: string;
  cep: string;
  neighborhood_id: string;
  condominium_id: string;
  public_address_visibility: string;
  quartos: string;
  suites: string;
  banheiros: string;
  vagas: string;
  area_util: string;
  area_total: string;
  mobilia: string;
  regra_pet: boolean;
  andar: string;
  ano_construcao: string;
  preco: string;
  valor_locacao: string;
  condominio: string;
  iptu: string;
  seguro_incendio: string;
  taxa_de_servico: string;
  condominio_isento: boolean;
  iptu_isento: boolean;
  iptu_period: string;
  rent_adjustment_index: string;
  financing_mode: string;
  commission_percentage: string;
  descricao: string;
  imagem_principal: string;
  fotos: string[];
  video_imovel: string;
  detalhes_extras: string[];
  proximidades: string[];
  // New fields - Owner
  owner_name: string;
  owner_id: string;
  owner_phone_residential: string;
  owner_phone_commercial: string;
  owner_cellphone: string;
  owner_email: string;
  owner_media_source: string;
  owner_notify_email: boolean;
  // Structure
  finalidade: string;
  // Location
  pais: string;
  // General data
  cadastrado_por: string;
  referencia_alternativa: string;
  condicao_pagamento: string;
  valor_itr: string;
  valor_seguro_fianca: string;
  // Property details
  padrao: string;
  posicao_localizacao: string;
  situacao_imovel: string;
  ocupacao: string;
  autorizado_comercializacao: boolean;
  exclusividade: boolean;
  ano_reforma: string;
  // Extras
  usou_fgts: boolean;
  aceita_financiamento: boolean;
  aceita_permuta: boolean;
  financing_details: string;
  exchange_details: string;
  hidden_site_image_urls: string[];
  zoneamento: string;
  valor_venda_avaliado: string;
  valor_locacao_avaliado: string;
  comentarios_internos: string;
  marcadores: string[];
  // Key control
  local_chaves: string;
  // Publication
  anunciar: boolean;
  super_destaque: boolean;
  tour_virtual: string;
  descricao_site: string;
  // Signs
  placa_no_local: boolean;
  // Commissions
  tipo_comissao: string;
  corretor_id: string;
  comissao_venda: string;
  comissao_locacao: string;
  data_inicio_comissao: string;
  condicao_comercial: string;
  // Confidential
  codigo_iptu: string;
  numero_matricula: string;
  codigo_eletricidade: string;
  codigo_agua: string;
  status_descritivo: string;
  aprovacao_ambiental: string;
  projeto_aprovado: boolean;
  observacoes_documentacao: string;
}

export const initialFormData: PropertyFormData = {
  title: "",
  tipo_de_imovel: "",
  tipo_de_negocio: "Venda",
  status: "ativo",
  destaque: false,
  endereco: "",
  numero: "",
  complemento: "",
  quadra: "",
  lote: "",
  bairro: "",
  cidade: "",
  city_id: "",
  neighborhood_id: "",
  condominium_id: "",
  uf: "",
  cep: "",
  public_address_visibility: "parcial",
  quartos: "",
  suites: "",
  banheiros: "",
  vagas: "",
  area_util: "",
  area_total: "",
  mobilia: "",
  regra_pet: false,
  andar: "",
  ano_construcao: "",
  preco: "",
  valor_locacao: "",
  condominio: "",
  iptu: "",
  seguro_incendio: "",
  taxa_de_servico: "",
  condominio_isento: false,
  iptu_isento: false,
  iptu_period: "mensal",
  rent_adjustment_index: "",
  financing_mode: "sim",
  commission_percentage: "",
  descricao: "",
  imagem_principal: "",
  fotos: [],
  video_imovel: "",
  detalhes_extras: [],
  proximidades: [],
  owner_id: "",
  owner_name: "",
  owner_phone_residential: "",
  owner_phone_commercial: "",
  owner_cellphone: "",
  owner_email: "",
  owner_media_source: "",
  owner_notify_email: false,
  finalidade: "Residencial",
  pais: "Brasil",
  cadastrado_por: "",
  referencia_alternativa: "",
  condicao_pagamento: "",
  valor_itr: "",
  valor_seguro_fianca: "",
  padrao: "",
  posicao_localizacao: "",
  situacao_imovel: "",
  ocupacao: "",
  autorizado_comercializacao: true,
  exclusividade: false,
  ano_reforma: "",
  usou_fgts: false,
  aceita_financiamento: true,
  aceita_permuta: false,
  financing_details: "",
  exchange_details: "",
  hidden_site_image_urls: [],
  zoneamento: "",
  valor_venda_avaliado: "",
  valor_locacao_avaliado: "",
  comentarios_internos: "",
  marcadores: [],
  local_chaves: "",
  anunciar: false,
  super_destaque: false,
  tour_virtual: "",
  descricao_site: "",
  placa_no_local: false,
  tipo_comissao: "",
  corretor_id: "",
  comissao_venda: "",
  comissao_locacao: "",
  data_inicio_comissao: "",
  condicao_comercial: "",
  codigo_iptu: "",
  numero_matricula: "",
  codigo_eletricidade: "",
  codigo_agua: "",
  status_descritivo: "",
  aprovacao_ambiental: "",
  projeto_aprovado: false,
  observacoes_documentacao: "",
};

export const DEFAULT_PURPOSE_OPTIONS = [
  "Residencial",
  "Comercial",
  "Industrial",
  "Rural",
];
export const DEFAULT_DEAL_OPTIONS = [
  "Venda",
  "Aluguel",
  "Venda e Aluguel",
  "Temporada",
  "Lançamento",
];
export const RENT_ADJUSTMENT_INDEXES = [
  "IGP-M",
  "IPCA",
  "INPC",
  "IVAR",
  "INCC",
  "IPC-FIPE",
  "IGP-DI",
  "Sem reajuste definido",
];

export function appendUniqueOption(options: string[], value: string) {
  const trimmed = value.trim();
  if (!trimmed) return options;
  if (options.some((option) => normalize(option) === normalize(trimmed)))
    return options;
  return [...options, trimmed];
}

export function optionsWithCurrent(options: string[], current: string) {
  return appendUniqueOption(options, current);
}

export const formatCurrencyDisplay = (value: string): string => {
  if (!value) return "";
  const parsed = parseLocaleNumber(value);
  if (parsed === null) return "";
  return formatFixedBRLCurrency(parsed);
};

export const parseCurrencyInput = (value: string): string =>
  normalizeLocaleNumberString(value, 2);
export const parseDecimalInput = (value: string): string =>
  value.replace(/[^\d,.]/g, "");
export function formatCurrencyEditable(value: string) {
  if (!value) return "";
  const normalized = normalizeLocaleNumberString(value, 2);
  if (!normalized) return "";

  const [integer = "0", fraction] = normalized.split(".");
  const formattedInteger = Number(integer || "0").toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
  return fraction === undefined
    ? formattedInteger
    : `${formattedInteger},${fraction}`;
}

export const onlyCepDigits = (value: string) => value.replace(/\D/g, "").slice(0, 8);
export const formatCep = (value: string) => {
  const digits = onlyCepDigits(value);
  return digits.length > 5
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
};

const DRAFT_KEY_PREFIX = "property-form-draft";

export type ValidationIssue = {
  label: string;
  tab: string;
  fieldId?: string;
};

export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const RENTAL_DEAL_TYPES = new Set([
  "aluguel",
  "locacao",
  "locacao anual",
  "rent",
  "temporada",
  "season",
  "venda e aluguel",
  "venda e locacao",
  "venda locacao",
  "venda/locacao",
  "venda/aluguel",
  "venda_locacao",
]);

const SALE_DEAL_TYPES = new Set([
  "venda",
  "sale",
  "lancamento",
  "launch",
  "release",
  "venda e aluguel",
  "venda e locacao",
  "venda locacao",
  "venda/locacao",
  "venda/aluguel",
  "venda_locacao",
]);

const SEASONAL_DEAL_TYPES = new Set(["temporada", "season"]);

export function normalizePropertyStatus(value?: string | null) {
  switch (normalize(value || "")) {
    case "reserved":
    case "reservado":
      return "reservado";
    case "sold":
    case "vendido":
      return "vendido";
    case "rented":
    case "alugado":
    case "locado":
      return "alugado";
    case "inactive":
    case "inativo":
      return "inativo";
    case "draft":
    case "rascunho":
      return "rascunho";
    case "archived":
    case "arquivado":
      return "arquivado";
    default:
      return "ativo";
  }
}
export const isLandType = (value: string) =>
  ["terreno", "lote"].includes(normalize(value));
export const isRentalType = (value: string) =>
  RENTAL_DEAL_TYPES.has(normalize(value));
export const isSaleType = (value: string) =>
  SALE_DEAL_TYPES.has(normalize(value));
export const isSupportedDealType = (value: string) =>
  SALE_DEAL_TYPES.has(normalize(value)) ||
  RENTAL_DEAL_TYPES.has(normalize(value));

export type PropertyMutationInput = Omit<
  Partial<Property>,
  "id" | "code" | "organization_id" | "created_at" | "updated_at"
> & {
  metadata?: Record<string, unknown>;
  property_type_id?: string | null;
};
export type PropertyOwnership = Property & {
  created_by?: string | null;
  responsible_user_id?: string | null;
};

const PROPERTY_MANAGER_ONLY_MUTATION_FIELDS = [
  "commission_percentage",
  "comissao_venda",
  "comissao_locacao",
  "tipo_comissao",
  "data_inicio_comissao",
  "condicao_comercial",
  "condicao_pagamento",
  "comentarios_internos",
  "local_chaves",
  "numero_matricula",
  "codigo_iptu",
  "codigo_eletricidade",
  "codigo_agua",
  "observacoes_documentacao",
  "documents",
  "arquivos",
  "metadata",
  "valor_venda_avaliado",
  "valor_locacao_avaliado",
  "ocupacao",
  "situacao_imovel",
  "autorizado_comercializacao",
  "referencia_alternativa",
  "external_id",
  "external_provider",
  "imoview_codigo",
  "vista_codigo",
  "created_by",
  "aprovacao_ambiental",
  "projeto_aprovado",
  "status_descritivo",
  "faixa_valor_imovel",
  "renda_familiar",
  "is_demo",
] as const;

const PROPERTY_MANAGER_ONLY_MEDIA_MUTATION_FIELDS = [
  "imagem_principal",
  "image_urls",
  "fotos",
  "documents",
  "arquivos",
  "tour_virtual",
  "video_imovel",
] as const;

function removePropertyManagerOnlyMutationFields(
  input: PropertyMutationInput,
) {
  const mutable = input as Record<string, unknown>;
  for (const field of [
    ...PROPERTY_MANAGER_ONLY_MUTATION_FIELDS,
    ...PROPERTY_MANAGER_ONLY_MEDIA_MUTATION_FIELDS,
  ]) {
    delete mutable[field];
  }
}

export function normalizeLocaleNumberString(value: string, maxDecimals?: number) {
  const cleaned = value.replace(/[^\d,.]/g, "");
  if (!cleaned) return "";

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = lastComma > lastDot ? lastComma : lastDot;
  const separator = decimalIndex >= 0 ? cleaned[decimalIndex] : "";
  const fraction =
    decimalIndex >= 0 ? cleaned.slice(decimalIndex + 1).replace(/\D/g, "") : "";
  const integerSource =
    decimalIndex >= 0 ? cleaned.slice(0, decimalIndex) : cleaned;
  const hasComma = cleaned.includes(",");
  const dotCount = (cleaned.match(/\./g) || []).length;

  if (
    !separator ||
    fraction.length === 0 ||
    (separator === "." && !hasComma && fraction.length === 3) ||
    (separator === "." && !hasComma && dotCount > 1 && fraction.length > 2)
  ) {
    return cleaned.replace(/\D/g, "");
  }

  const integer = integerSource.replace(/\D/g, "") || "0";
  const decimals =
    typeof maxDecimals === "number" ? fraction.slice(0, maxDecimals) : fraction;
  return decimals ? `${integer}.${decimals}` : integer;
}

export function parseLocaleNumber(value: string) {
  const normalized = normalizeLocaleNumberString(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function propertyDraftKey(
  organizationId?: string | null,
  userId?: string | null,
) {
  return `${DRAFT_KEY_PREFIX}:${organizationId || "no-organization"}:${userId || "anonymous"}`;
}

export function readDraft(draftKey: string) {
  const raw = localStorage.getItem(draftKey);
  if (!raw) return null;

  const draft = JSON.parse(raw) as Partial<PropertyFormData>;
  return withoutEphemeralPropertyMedia({
    ...initialFormData,
    ...draft,
  } as PropertyFormData);
}

export function saveDraft(draftKey: string, data: PropertyFormData) {
  localStorage.setItem(
    draftKey,
    // File/blob references cannot survive a reload. Keeping them would make
    // the form look complete while the bytes are unavailable for upload.
    JSON.stringify(withoutEphemeralPropertyMedia(data)),
  );
}

export function clearDraft(draftKey: string) {
  localStorage.removeItem(draftKey);
}

export function getPropertyFormRules(formData: PropertyFormData) {
  const isLand = isLandType(formData.tipo_de_imovel);
  const isRental = isRentalType(formData.tipo_de_negocio);
  const isSale = isSaleType(formData.tipo_de_negocio);
  const isSeasonal = SEASONAL_DEAL_TYPES.has(
    normalize(formData.tipo_de_negocio),
  );

  return {
    isLand,
    isRental,
    isSale,
    isSeasonal,
    supportsRentalContractTerms: isRental && !isSeasonal,
    supportsSaleTerms: isSaleType(formData.tipo_de_negocio),
  };
}

export function getPropertyValidationIssues(
  formData: PropertyFormData,
  options: { isEditing?: boolean; canEditOwnerDetails?: boolean } = {},
): ValidationIssue[] {
  const { isLand, isRental, isSale } = getPropertyFormRules(formData);
  const requireOwnerDetails = shouldRequirePropertyOwnerDetails(
    options.isEditing,
    options.canEditOwnerDetails,
  );
  const hasOwnerContact = [
    formData.owner_cellphone,
    formData.owner_phone_residential,
    formData.owner_phone_commercial,
    formData.owner_email,
  ].some((value) => value.trim() !== "");
  const selectedPhotoCount = getPropertyPhotoCount(
    formData.fotos,
    formData.imagem_principal,
  );

  return [
    !formData.cadastrado_por.trim()
      ? {
          label: "Responsável pela captação",
          tab: "owner",
          fieldId: "property-captor",
        }
      : null,
    requireOwnerDetails && !formData.owner_name.trim()
      ? {
          label: "Nome do proprietário",
          tab: "owner",
          fieldId: "property-owner-name",
        }
      : null,
    requireOwnerDetails && !hasOwnerContact
      ? {
          label: "Ao menos um contato do proprietário",
          tab: "owner",
          fieldId: "property-owner-cellphone",
        }
      : null,
    !formData.title.trim()
      ? {
          label: "Título do imóvel",
          tab: "structure",
          fieldId: "property-title",
        }
      : null,
    !formData.tipo_de_imovel.trim()
      ? {
          label: "Tipo de imóvel",
          tab: "structure",
          fieldId: "property-type",
        }
      : null,
    !isSupportedDealType(formData.tipo_de_negocio)
      ? {
          label: "Modalidade válida",
          tab: "structure",
          fieldId: "property-deal-type",
        }
      : null,
    !formData.public_address_visibility.trim()
      ? {
          label: "Visibilidade do endereço no site",
          tab: "location",
          fieldId: "property-address-visibility",
        }
      : null,
    isSale && !formData.preco.trim()
      ? {
          label: "Preço de venda",
          tab: "values",
          fieldId: "property-sale-price",
        }
      : null,
    isRental && !formData.valor_locacao.trim()
      ? {
          label: "Valor de locação",
          tab: "values",
          fieldId: "property-rental-price",
        }
      : null,
    isLand && !formData.area_total.trim()
      ? {
          label: "Área total",
          tab: "characteristics",
          fieldId: "property-total-area",
        }
      : null,
    !isLand && !formData.quartos.trim()
      ? {
          label: "Quartos",
          tab: "characteristics",
          fieldId: "property-bedrooms",
        }
      : null,
    !options.isEditing && selectedPhotoCount === 0
      ? { label: "Ao menos uma foto do imóvel", tab: "media" }
      : null,
    !options.isEditing && selectedPhotoCount > PROPERTY_MEDIA_MAX_PHOTOS
      ? {
          label: `No máximo ${PROPERTY_MEDIA_MAX_PHOTOS} fotos do imóvel`,
          tab: "media",
        }
      : null,
  ].filter((issue): issue is ValidationIssue => Boolean(issue));
}

export function buildPropertyMutationInput(
  formData: PropertyFormData,
  options: {
    isEditing: boolean;
    canAssignProperty: boolean;
    canManagePropertyCatalogs: boolean;
    canEditOwnerDetails?: boolean;
  },
) {
  const { isRental, isSale, supportsRentalContractTerms, supportsSaleTerms } =
    getPropertyFormRules(formData);
  const parseNum = (value: string) => parseLocaleNumber(value);
  const parseInteger = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isInteger(parsed) ? parsed : null;
  };

  const propertyData: PropertyMutationInput = {
    title: formData.title || null,
    tipo_de_imovel: formData.tipo_de_imovel,
    tipo_de_negocio: formData.tipo_de_negocio,
    status: formData.status,
    destaque: formData.destaque,
    endereco: formData.endereco || null,
    numero: formData.numero || null,
    complemento: formData.complemento || null,
    bairro: formData.bairro || null,
    cidade: formData.cidade || null,
    city_id: formData.city_id || null,
    neighborhood_id: formData.neighborhood_id || null,
    condominium_id: formData.condominium_id || null,
    uf: formData.uf || null,
    cep: formData.cep || null,
    public_address_visibility: formData.public_address_visibility,
    quartos: parseInteger(formData.quartos),
    suites: parseInteger(formData.suites),
    banheiros: parseInteger(formData.banheiros),
    vagas: parseInteger(formData.vagas),
    area_util: parseNum(formData.area_util),
    area_total: parseNum(formData.area_total),
    mobilia: formData.mobilia || null,
    regra_pet: formData.regra_pet,
    andar: parseInteger(formData.andar),
    ano_construcao: parseInteger(formData.ano_construcao),
    preco: isSale ? parseNum(formData.preco) : null,
    valor_locacao: isRental ? parseNum(formData.valor_locacao) : null,
    condominio: formData.condominio_isento
      ? null
      : parseNum(formData.condominio),
    iptu: formData.iptu_isento ? null : parseNum(formData.iptu),
    seguro_incendio: parseNum(formData.seguro_incendio),
    taxa_de_servico: parseNum(formData.taxa_de_servico),
    commission_percentage: formData.commission_percentage
      ? parseFloat(formData.commission_percentage)
      : null,
    descricao: formData.descricao || null,
    video_imovel: formData.video_imovel || null,
    detalhes_extras: formData.detalhes_extras,
    proximidades: formData.proximidades,
    owner_id: formData.owner_id || null,
    owner_name: formData.owner_name || null,
    owner_phone_residential: formData.owner_phone_residential || null,
    owner_phone_commercial: formData.owner_phone_commercial || null,
    owner_cellphone: formData.owner_cellphone || null,
    owner_email: formData.owner_email || null,
    owner_media_source: formData.owner_media_source || null,
    owner_notify_email: formData.owner_notify_email,
    finalidade: formData.finalidade || null,
    pais: formData.pais || null,
    cadastrado_por: formData.cadastrado_por || null,
    referencia_alternativa: formData.referencia_alternativa || null,
    condicao_pagamento: formData.condicao_pagamento || null,
    valor_itr: parseNum(formData.valor_itr),
    valor_seguro_fianca: supportsRentalContractTerms
      ? parseNum(formData.valor_seguro_fianca)
      : null,
    padrao: formData.padrao || null,
    posicao_localizacao: formData.posicao_localizacao || null,
    situacao_imovel: formData.situacao_imovel || null,
    ocupacao: formData.ocupacao || null,
    autorizado_comercializacao: formData.autorizado_comercializacao,
    exclusividade: formData.exclusividade,
    ano_reforma: parseInteger(formData.ano_reforma),
    usou_fgts: supportsSaleTerms ? formData.usou_fgts : false,
    aceita_financiamento:
      supportsSaleTerms && formData.financing_mode !== "nao",
    aceita_permuta: supportsSaleTerms && formData.aceita_permuta,
    metadata: {
      financing_details:
        supportsSaleTerms && formData.financing_mode !== "nao"
          ? formData.financing_details.trim() || null
          : null,
      exchange_details:
        supportsSaleTerms && formData.aceita_permuta
          ? formData.exchange_details.trim() || null
          : null,
      condominio_isento: formData.condominio_isento,
      iptu_isento: formData.iptu_isento,
      iptu_period: formData.iptu_period || null,
      rent_adjustment_index: supportsRentalContractTerms
        ? formData.rent_adjustment_index || null
        : null,
      financing_mode: supportsSaleTerms
        ? formData.financing_mode || null
        : "nao",
      quadra: formData.quadra.trim() || null,
      lote: formData.lote.trim() || null,
    },
    zoneamento: formData.zoneamento || null,
    valor_venda_avaliado: isSale
      ? parseNum(formData.valor_venda_avaliado)
      : null,
    valor_locacao_avaliado: isRental
      ? parseNum(formData.valor_locacao_avaliado)
      : null,
    comentarios_internos: formData.comentarios_internos || null,
    marcadores: formData.marcadores,
    local_chaves: formData.local_chaves || null,
    super_destaque: formData.super_destaque,
    tour_virtual: formData.tour_virtual || null,
    descricao_site: formData.descricao_site || null,
    placa_no_local: formData.placa_no_local,
    tipo_comissao: formData.tipo_comissao || null,
    corretor_id: formData.corretor_id || null,
    comissao_venda: formData.comissao_venda
      ? parseFloat(formData.comissao_venda)
      : null,
    comissao_locacao: formData.comissao_locacao
      ? parseFloat(formData.comissao_locacao)
      : null,
    data_inicio_comissao: formData.data_inicio_comissao || null,
    condicao_comercial: formData.condicao_comercial || null,
    codigo_iptu: formData.codigo_iptu || null,
    numero_matricula: formData.numero_matricula || null,
    codigo_eletricidade: formData.codigo_eletricidade || null,
    codigo_agua: formData.codigo_agua || null,
    status_descritivo: formData.status_descritivo || null,
    aprovacao_ambiental: formData.aprovacao_ambiental || null,
    projeto_aprovado: formData.projeto_aprovado,
    observacoes_documentacao: formData.observacoes_documentacao || null,
  };

  // The catalog row is authoritative for a selected owner. Echoing its contact
  // projection can be stale and the backend correctly rejects that as an
  // identity conflict, so inline details are sent only for a manual owner.
  if (formData.owner_id) {
    for (const field of [
      "owner_name",
      "owner_phone_residential",
      "owner_phone_commercial",
      "owner_cellphone",
      "owner_email",
      "owner_media_source",
      "owner_notify_email",
    ] as const) {
      delete propertyData[field];
    }
  }

  if (options.isEditing && !options.canAssignProperty) {
    delete propertyData.cadastrado_por;
    delete propertyData.corretor_id;
  }
  if (options.isEditing && !options.canManagePropertyCatalogs) {
    removePropertyManagerOnlyMutationFields(propertyData);
  }
  if (options.isEditing && options.canEditOwnerDetails === false) {
    removePropertyOwnerMutationFields(propertyData);
  }
  if (options.isEditing) {
    delete propertyData.tipo_de_imovel;
    delete propertyData.property_type_id;
  }

  return propertyData;
}

export type PropertyFormSetField = <K extends keyof PropertyFormData>(
  field: K,
  value: PropertyFormData[K],
) => void;
