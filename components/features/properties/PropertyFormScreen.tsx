"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Loader2,
  Save,
  User,
  MapPin,
  Home,
  Settings2,
  Image,
  Globe,
  DollarSign,
  Percent,
  Lock,
  Tag,
  AlertTriangle,
} from "lucide-react";
import {
  type Property,
  useProperty,
  useCreateProperty,
  useUpdateProperty,
} from "@/hooks/use-properties";
import {
  usePropertyTypes,
  useCreatePropertyType,
} from "@/hooks/use-property-types";
import {
  usePropertyFeatures,
  useCreatePropertyFeature,
  useSeedDefaultFeatures,
  DEFAULT_FEATURES,
} from "@/hooks/use-property-features";
import {
  usePropertyProximities,
  useCreatePropertyProximity,
  useSeedDefaultProximities,
  DEFAULT_PROXIMITIES,
} from "@/hooks/use-property-proximities";
import {
  useCreateCity,
  useCreateCondominium,
  useCreateNeighborhood,
  usePropertyCities,
  usePropertyCondominiums,
  usePropertyNeighborhoods,
  type PropertyCity,
  type PropertyCondominium,
  type PropertyNeighborhood,
} from "@/hooks/use-property-locations";
import {
  useCreatePropertyOwner,
  usePropertyOwners,
  type PropertyOwner,
} from "@/hooks/use-property-owners";
import { ImageUploader } from "@/components/features/properties/ImageUploader";
import { FeatureSelector } from "@/components/features/properties/FeatureSelector";
import { useUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import {
  canAssignProperties,
  canEditPropertyDetails,
} from "@/lib/access/properties";
import { cleanPropertyDescription } from "@/lib/property-description";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface PropertyFormData {
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

const initialFormData: PropertyFormData = {
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

const DEFAULT_PURPOSE_OPTIONS = [
  "Residencial",
  "Comercial",
  "Industrial",
  "Rural",
];
const DEFAULT_DEAL_OPTIONS = [
  "Venda",
  "Aluguel",
  "Venda e Aluguel",
  "Temporada",
  "Lançamento",
];
const RENT_ADJUSTMENT_INDEXES = [
  "IGP-M",
  "IPCA",
  "INPC",
  "IVAR",
  "INCC",
  "IPC-FIPE",
  "IGP-DI",
  "Sem reajuste definido",
];

function appendUniqueOption(options: string[], value: string) {
  const trimmed = value.trim();
  if (!trimmed) return options;
  if (options.some((option) => normalize(option) === normalize(trimmed)))
    return options;
  return [...options, trimmed];
}

function optionsWithCurrent(options: string[], current: string) {
  return appendUniqueOption(options, current);
}

const formatCurrencyDisplay = (value: string): string => {
  if (!value) return "";
  const parsed = parseLocaleNumber(value);
  if (parsed === null) return "";
  return `R$ ${parsed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const parseCurrencyInput = (value: string): string =>
  normalizeLocaleNumberString(value, 2);
const parseDecimalInput = (value: string): string =>
  value.replace(/[^\d,.]/g, "");

function CurrencyInput({
  value,
  onValueChange,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatCurrencyEditable(value));

  useEffect(() => {
    if (isFocused) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDraft(formatCurrencyEditable(value));
    });
    return () => {
      cancelled = true;
    };
  }, [isFocused, value]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <Input
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value.replace(/[^\d,.]/g, "");
          setDraft(nextDraft);
          onValueChange(parseCurrencyInput(nextDraft));
        }}
        onFocus={(event) => {
          setDraft(formatCurrencyEditable(value));
          setIsFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          const normalized = parseCurrencyInput(draft);
          onValueChange(normalized);
          setDraft(formatCurrencyEditable(normalized));
          setIsFocused(false);
        }}
        inputMode="decimal"
        placeholder="1,00"
        className={cn("pl-9", className)}
        disabled={disabled}
      />
    </div>
  );
}

function formatCurrencyEditable(value: string) {
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

const onlyCepDigits = (value: string) => value.replace(/\D/g, "").slice(0, 8);
const formatCep = (value: string) => {
  const digits = onlyCepDigits(value);
  return digits.length > 5
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
};

const DRAFT_KEY_PREFIX = "property-form-draft";

const RequiredMark = () => <span className="ml-0.5 text-primary">*</span>;
const togglePanelClass =
  "flex items-center justify-between gap-3 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-3 text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)]";
const propertyFormTabTriggerClass =
  "mx-0 h-8 w-8 min-w-8 shrink-0 gap-0 rounded-[6px] p-0 text-[var(--app-text-secondary)] shadow-none";

type PropertyFormTab = {
  value: string;
  label: string;
  description: string;
  icon: typeof User;
};

type ValidationIssue = {
  label: string;
  tab: string;
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const isLandType = (value: string) =>
  ["terreno", "lote"].includes(normalize(value));
const isRentalType = (value: string) =>
  [
    "aluguel",
    "locacao",
    "temporada",
    "venda e aluguel",
    "venda e locacao",
  ].includes(normalize(value));
const isSaleType = (value: string) =>
  ["venda", "venda e aluguel", "venda e locacao", "lancamento"].includes(
    normalize(value),
  );

type PropertyMutationInput = Omit<
  Partial<Property>,
  "id" | "code" | "organization_id" | "created_at" | "updated_at"
> & {
  metadata?: Record<string, unknown>;
  property_type_id?: string | null;
};
type PropertyOwnership = Property & {
  created_by?: string | null;
  responsible_user_id?: string | null;
};
type PropertyMetadata = {
  financing_details?: unknown;
  exchange_details?: unknown;
  hidden_site_image_urls?: unknown;
  condominio_isento?: unknown;
  iptu_isento?: unknown;
  iptu_period?: unknown;
  rent_adjustment_index?: unknown;
  financing_mode?: unknown;
  quadra?: unknown;
  lote?: unknown;
};

type PropertyWithCanonicalType = Property & {
  tipo?: string | null;
};

function normalizeLocaleNumberString(value: string, maxDecimals?: number) {
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

function parseLocaleNumber(value: string) {
  const normalized = normalizeLocaleNumberString(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getPropertyMetadata(property: Property): PropertyMetadata {
  const raw = (property as Property & { metadata?: unknown }).metadata;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as PropertyMetadata)
    : {};
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function metadataBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function propertyToFormData(p: Property): PropertyFormData {
  const metadata = getPropertyMetadata(p);
  const propertyType =
    p.tipo_de_imovel || (p as PropertyWithCanonicalType).tipo || "";
  return {
    title: p.title || "",
    tipo_de_imovel: propertyType,
    tipo_de_negocio: p.tipo_de_negocio || "Venda",
    status: p.status || "ativo",
    destaque: p.destaque || false,
    endereco: p.endereco || "",
    numero: p.numero || "",
    complemento: p.complemento || "",
    quadra: metadataString(metadata.quadra),
    lote: metadataString(metadata.lote),
    bairro: p.bairro || "",
    cidade: p.cidade || "",
    city_id: p.city_id || "",
    neighborhood_id: p.neighborhood_id || "",
    condominium_id: p.condominium_id || "",
    uf: p.uf || "",
    cep: p.cep || "",
    public_address_visibility: p.public_address_visibility || "parcial",
    quartos: p.quartos?.toString() || "",
    suites: p.suites?.toString() || "",
    banheiros: p.banheiros?.toString() || "",
    vagas: p.vagas?.toString() || "",
    area_util: p.area_util?.toString() || "",
    area_total: p.area_total?.toString() || "",
    mobilia: p.mobilia || "",
    regra_pet: p.regra_pet || false,
    andar: p.andar?.toString() || "",
    ano_construcao: p.ano_construcao?.toString() || "",
    preco: p.preco?.toString() || "",
    valor_locacao: p.valor_locacao?.toString() || "",
    condominio: p.condominio?.toString() || "",
    iptu: p.iptu?.toString() || "",
    seguro_incendio: p.seguro_incendio?.toString() || "",
    taxa_de_servico: p.taxa_de_servico?.toString() || "",
    condominio_isento: metadataBoolean(metadata.condominio_isento),
    iptu_isento:
      metadataBoolean(metadata.iptu_isento) ||
      normalize(p.tipo_de_negocio || "") === "temporada",
    iptu_period: metadataString(metadata.iptu_period) || "mensal",
    rent_adjustment_index: metadataString(metadata.rent_adjustment_index),
    financing_mode:
      metadataString(metadata.financing_mode) ||
      (p.aceita_financiamento === false ? "nao" : "sim"),
    commission_percentage: p.commission_percentage?.toString() || "",
    descricao: cleanPropertyDescription(p.descricao),
    imagem_principal: p.imagem_principal || "",
    fotos: toStringArray(p.fotos),
    video_imovel: p.video_imovel || "",
    detalhes_extras: p.detalhes_extras || [],
    proximidades: p.proximidades || [],
    owner_id: p.owner_id || "",
    owner_name: p.owner_name || "",
    owner_phone_residential: p.owner_phone_residential || "",
    owner_phone_commercial: p.owner_phone_commercial || "",
    owner_cellphone: p.owner_cellphone || "",
    owner_email: p.owner_email || "",
    owner_media_source: p.owner_media_source || "",
    owner_notify_email: p.owner_notify_email || false,
    finalidade: p.finalidade || "Residencial",
    pais: p.pais || "Brasil",
    cadastrado_por: p.cadastrado_por || "",
    referencia_alternativa: p.referencia_alternativa || "",
    condicao_pagamento: p.condicao_pagamento || "",
    valor_itr: p.valor_itr?.toString() || "",
    valor_seguro_fianca: p.valor_seguro_fianca?.toString() || "",
    padrao: p.padrao || "",
    posicao_localizacao: p.posicao_localizacao || "",
    situacao_imovel: p.situacao_imovel || "",
    ocupacao: p.ocupacao || "",
    autorizado_comercializacao: p.autorizado_comercializacao ?? true,
    exclusividade: p.exclusividade || false,
    ano_reforma: p.ano_reforma?.toString() || "",
    usou_fgts: p.usou_fgts || false,
    aceita_financiamento: p.aceita_financiamento ?? true,
    aceita_permuta: p.aceita_permuta || false,
    financing_details: metadataString(metadata.financing_details),
    exchange_details: metadataString(metadata.exchange_details),
    hidden_site_image_urls: toStringArray(metadata.hidden_site_image_urls),
    zoneamento: p.zoneamento || "",
    valor_venda_avaliado: p.valor_venda_avaliado?.toString() || "",
    valor_locacao_avaliado: p.valor_locacao_avaliado?.toString() || "",
    comentarios_internos: p.comentarios_internos || "",
    marcadores: p.marcadores || [],
    local_chaves: p.local_chaves || "",
    anunciar: p.published_on_site ?? p.anunciar ?? false,
    super_destaque: p.super_destaque || false,
    tour_virtual: p.tour_virtual || "",
    descricao_site: p.descricao_site || "",
    placa_no_local: p.placa_no_local || false,
    tipo_comissao: p.tipo_comissao || "",
    corretor_id: p.corretor_id || "",
    comissao_venda: p.comissao_venda?.toString() || "",
    comissao_locacao: p.comissao_locacao?.toString() || "",
    data_inicio_comissao: p.data_inicio_comissao || "",
    condicao_comercial: p.condicao_comercial || "",
    codigo_iptu: p.codigo_iptu || "",
    numero_matricula: p.numero_matricula || "",
    codigo_eletricidade: p.codigo_eletricidade || "",
    codigo_agua: p.codigo_agua || "",
    status_descritivo: p.status_descritivo || "",
    aprovacao_ambiental: p.aprovacao_ambiental || "",
    projeto_aprovado: p.projeto_aprovado || false,
    observacoes_documentacao: p.observacoes_documentacao || "",
  };
}

function propertyDraftKey(
  organizationId?: string | null,
  userId?: string | null,
) {
  return `${DRAFT_KEY_PREFIX}:${organizationId || "no-organization"}:${userId || "anonymous"}`;
}

function readDraft(draftKey: string) {
  const raw = localStorage.getItem(draftKey);
  return raw
    ? ({ ...initialFormData, ...JSON.parse(raw) } as PropertyFormData)
    : null;
}

function saveDraft(draftKey: string, data: PropertyFormData) {
  localStorage.setItem(draftKey, JSON.stringify(data));
}

function clearDraft(draftKey: string) {
  localStorage.removeItem(draftKey);
}

export default function PropertyForm() {
  const router = useRouter();
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const propertyId = Array.isArray(rawId)
    ? (rawId[0] ?? null)
    : (rawId ?? null);
  const isEditing = !!propertyId;
  const { user, profile, organization, tenantContext, isSuperAdmin } =
    useAuth();
  const draftKey = propertyDraftKey(
    organization?.id ?? profile?.organization_id,
    user?.id ?? profile?.id,
  );

  const [formData, setFormData] = useState<PropertyFormData>(() => {
    if (!propertyId && typeof window !== "undefined") {
      try {
        return readDraft(draftKey) ?? initialFormData;
      } catch {
        // noop
      }
    }
    return initialFormData;
  });
  const [hasDraft, setHasDraft] = useState(
    () =>
      !propertyId &&
      typeof window !== "undefined" &&
      !!localStorage.getItem(draftKey),
  );
  const [activeTab, setActiveTab] = useState("owner");
  const propertyTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [purposeOptions, setPurposeOptions] = useState(DEFAULT_PURPOSE_OPTIONS);
  const [dealOptions, setDealOptions] = useState(DEFAULT_DEAL_OPTIONS);

  useEffect(() => {
    propertyTabRefs.current[activeTab]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTab]);
  const [newPurposeName, setNewPurposeName] = useState("");
  const [newDealName, setNewDealName] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [showAddPurpose, setShowAddPurpose] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showAddCity, setShowAddCity] = useState(false);
  const [showAddNeighborhood, setShowAddNeighborhood] = useState(false);
  const [showAddCondominium, setShowAddCondominium] = useState(false);
  const [newCityName, setNewCityName] = useState("");
  const [newCityUf, setNewCityUf] = useState("");
  const [newNeighborhoodName, setNewNeighborhoodName] = useState("");
  const [newCondominiumName, setNewCondominiumName] = useState("");
  const [newCondominiumFee, setNewCondominiumFee] = useState("");
  const [newCondominiumPhoto, setNewCondominiumPhoto] = useState("");
  const [newCondominiumHasConcierge, setNewCondominiumHasConcierge] =
    useState(false);
  const [newCondominiumConciergeType, setNewCondominiumConciergeType] =
    useState("");
  const [isCepLoading, setIsCepLoading] = useState(false);
  const lastCepLookupRef = useRef("");

  useEffect(() => {
    if (isEditing || typeof window === "undefined") return;

    let isActive = true;
    let draft: PropertyFormData | null = null;
    try {
      draft = readDraft(draftKey);
    } catch {
      draft = null;
    }

    queueMicrotask(() => {
      if (!isActive) return;
      setFormData(draft ?? initialFormData);
      setHasDraft(!!draft);
    });

    return () => {
      isActive = false;
    };
  }, [draftKey, isEditing]);

  const { data: property, isLoading: loadingProperty } =
    useProperty(propertyId);
  const { data: propertyTypes = [] } = usePropertyTypes();
  const { data: features = [], isLoading: loadingFeatures } =
    usePropertyFeatures();
  const { data: proximities = [], isLoading: loadingProximities } =
    usePropertyProximities();
  const { data: cities = [] } = usePropertyCities();
  const { data: neighborhoods = [] } = usePropertyNeighborhoods(
    formData.city_id || undefined,
  );
  const { data: condominiums = [] } = usePropertyCondominiums();
  const { data: propertyOwners = [] } = usePropertyOwners();
  const { data: users = [] } = useUsers();
  const createPropertyType = useCreatePropertyType();
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  const createFeature = useCreatePropertyFeature();
  const createProximity = useCreatePropertyProximity();
  const createCity = useCreateCity();
  const createNeighborhood = useCreateNeighborhood();
  const createCondominium = useCreateCondominium();
  const createPropertyOwner = useCreatePropertyOwner();
  const { mutate: seedDefaultFeatures } = useSeedDefaultFeatures();
  const { mutate: seedDefaultProximities } = useSeedDefaultProximities();

  const activeOrganizationId =
    property?.organization_id ||
    organization?.id ||
    profile?.organization_id ||
    undefined;
  const propertyAccessContext = {
    userId: user?.id,
    organizationId: activeOrganizationId,
    isSuperAdmin,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
  };
  const propertyOwnership = property as PropertyOwnership | undefined;
  const canAssignProperty = canAssignProperties(propertyAccessContext);
  const canEdit =
    !isEditing ||
    canEditPropertyDetails({
      ...propertyAccessContext,
      ownerIds: [
        propertyOwnership?.cadastrado_por,
        propertyOwnership?.responsible_user_id,
        propertyOwnership?.created_by,
      ],
    });

  const set = <K extends keyof PropertyFormData>(
    field: K,
    value: PropertyFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const applyCity = (city: PropertyCity | null) => {
    setFormData((prev) => ({
      ...prev,
      city_id: city?.id || "",
      cidade: city?.name || prev.cidade,
      uf: city?.uf || prev.uf,
      neighborhood_id: city?.id === prev.city_id ? prev.neighborhood_id : "",
      condominium_id: city?.id === prev.city_id ? prev.condominium_id : "",
    }));
  };

  const applyNeighborhood = (neighborhood: PropertyNeighborhood | null) => {
    setFormData((prev) => ({
      ...prev,
      neighborhood_id: neighborhood?.id || "",
      bairro: neighborhood?.name || prev.bairro,
      city_id: neighborhood?.city?.id || prev.city_id,
      cidade: neighborhood?.city?.name || prev.cidade,
      uf: neighborhood?.city?.uf || prev.uf,
      condominium_id:
        neighborhood?.id === prev.neighborhood_id ? prev.condominium_id : "",
    }));
  };

  const applyCondominium = (condominium: PropertyCondominium | null) => {
    setFormData((prev) => ({
      ...prev,
      condominium_id: condominium?.id || "",
      city_id: condominium?.city?.id || prev.city_id,
      neighborhood_id: condominium?.neighborhood?.id || prev.neighborhood_id,
      cidade: condominium?.city?.name || prev.cidade,
      uf: condominium?.city?.uf || prev.uf,
      bairro: condominium?.neighborhood?.name || prev.bairro,
      endereco: condominium?.address || prev.endereco,
      cep: condominium?.cep ? formatCep(condominium.cep) : prev.cep,
      condominio:
        condominium?.default_condominium_fee != null
          ? String(Math.round(Number(condominium.default_condominium_fee)))
          : prev.condominio,
    }));
  };

  const applyOwner = (owner: PropertyOwner | null) => {
    setFormData((prev) => ({
      ...prev,
      owner_id: owner?.id || "",
      owner_name: owner?.name || prev.owner_name,
      owner_phone_residential:
        owner?.phone_residential || prev.owner_phone_residential,
      owner_phone_commercial:
        owner?.phone_commercial || prev.owner_phone_commercial,
      owner_cellphone: owner?.cellphone || prev.owner_cellphone,
      owner_email: owner?.email || prev.owner_email,
      owner_media_source: owner?.media_source || prev.owner_media_source,
      owner_notify_email: owner?.notify_email ?? prev.owner_notify_email,
    }));
  };

  const lookupCep = async (rawCep: string) => {
    const cep = onlyCepDigits(rawCep);
    if (cep.length !== 8 || lastCepLookupRef.current === cep) return;

    lastCepLookupRef.current = cep;
    setIsCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!res.ok) throw new Error("cep_lookup_failed");

      const data = (await res.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };

      if (data.erro) {
        toast.error("CEP não encontrado.");
        return;
      }

      const matchedCity = cities.find(
        (city) =>
          normalize(city.name) === normalize(data.localidade || "") &&
          (!data.uf ||
            !city.uf ||
            city.uf.toUpperCase() === data.uf.toUpperCase()),
      );
      const matchedNeighborhood = neighborhoods.find(
        (neighborhood) =>
          normalize(neighborhood.name) === normalize(data.bairro || "") &&
          (!matchedCity ||
            !neighborhood.city_id ||
            neighborhood.city_id === matchedCity.id),
      );
      const cepHasCity = Boolean(data.localidade);
      const cepHasNeighborhood = Boolean(data.bairro);

      setFormData((prev) => ({
        ...prev,
        endereco: data.logradouro || prev.endereco,
        bairro: data.bairro || prev.bairro,
        cidade: data.localidade || prev.cidade,
        uf: data.uf || prev.uf,
        city_id: matchedCity?.id || (cepHasCity ? "" : prev.city_id),
        neighborhood_id:
          matchedNeighborhood?.id ||
          (cepHasNeighborhood ? "" : prev.neighborhood_id),
        condominium_id:
          cepHasCity || cepHasNeighborhood ? "" : prev.condominium_id,
      }));
    } catch {
      lastCepLookupRef.current = "";
      toast.error("Não foi possível preencher o endereço pelo CEP agora.");
    } finally {
      setIsCepLoading(false);
    }
  };

  useEffect(() => {
    if (isEditing && property && !loadingProperty && !canEdit) {
      toast.error("Você não tem permissão para editar este imóvel.");
      router.push("/properties");
    }
  }, [isEditing, property, loadingProperty, canEdit, router]);

  useEffect(() => {
    if (!loadingFeatures && features.length === 0) seedDefaultFeatures();
  }, [loadingFeatures, features.length, seedDefaultFeatures]);

  useEffect(() => {
    if (!loadingProximities && proximities.length === 0)
      seedDefaultProximities();
  }, [loadingProximities, proximities.length, seedDefaultProximities]);

  // Auto-set cadastrado_por to current user for new properties
  useEffect(() => {
    if (!isEditing && user?.id && !formData.cadastrado_por) {
      const currentUserId = user.id;
      queueMicrotask(() => {
        setFormData((prev) =>
          prev.cadastrado_por
            ? prev
            : { ...prev, cadastrado_por: currentUserId },
        );
      });
    }
  }, [formData.cadastrado_por, isEditing, user?.id]);

  // Auto-save draft for new properties
  useEffect(() => {
    if (!isEditing) {
      const timer = setTimeout(() => saveDraft(draftKey, formData), 2000);
      return () => clearTimeout(timer);
    }
  }, [draftKey, formData, isEditing]);

  useEffect(() => {
    if (property && isEditing) {
      const nextFormData = propertyToFormData(property);
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setFormData(nextFormData);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [property, isEditing]);

  const isLand = isLandType(formData.tipo_de_imovel);
  const isRental = isRentalType(formData.tipo_de_negocio);
  const isSale = isSaleType(formData.tipo_de_negocio) || !isRental;
  const isSeasonal = normalize(formData.tipo_de_negocio) === "temporada";
  const supportsRentalContractTerms = isRental && !isSeasonal;
  const supportsSaleTerms = isSaleType(formData.tipo_de_negocio);
  const displayedPurposeOptions = optionsWithCurrent(
    purposeOptions,
    formData.finalidade,
  );
  const displayedDealOptions = optionsWithCurrent(
    dealOptions,
    formData.tipo_de_negocio,
  );
  const selectedCity = cities.find((city) => city.id === formData.city_id);
  const selectedNeighborhood = neighborhoods.find(
    (neighborhood) => neighborhood.id === formData.neighborhood_id,
  );
  const selectedCondominium = condominiums.find(
    (condominium) => condominium.id === formData.condominium_id,
  );
  const primaryValuesGridClass = cn(
    "grid grid-cols-1 gap-3 md:grid-cols-2",
    isSale && isRental
      ? "lg:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_minmax(180px,1.15fr)_minmax(160px,1fr)_minmax(150px,.95fr)]"
      : "lg:grid-cols-[minmax(190px,1fr)_minmax(220px,1.18fr)_minmax(200px,1.05fr)_minmax(180px,.95fr)]",
  );
  const statusOptions = [
    { value: "ativo", label: "Ativo" },
    { value: "reservado", label: "Reservado" },
    ...(isSale ? [{ value: "vendido", label: "Vendido" }] : []),
    ...(isRental ? [{ value: "alugado", label: "Alugado" }] : []),
    { value: "inativo", label: "Inativo" },
  ];
  const hasOwnerContact = [
    formData.owner_cellphone,
    formData.owner_phone_residential,
    formData.owner_phone_commercial,
    formData.owner_email,
  ].some((value) => value.trim() !== "");
  const validationIssues: ValidationIssue[] = [
    !formData.cadastrado_por.trim()
      ? { label: "Responsável pela captação", tab: "owner" }
      : null,
    !formData.owner_name.trim()
      ? { label: "Nome do proprietário", tab: "owner" }
      : null,
    !hasOwnerContact
      ? { label: "Ao menos um contato do proprietário", tab: "owner" }
      : null,
    !formData.title.trim()
      ? { label: "Título do imóvel", tab: "structure" }
      : null,
    !formData.tipo_de_imovel.trim()
      ? { label: "Tipo de imóvel", tab: "structure" }
      : null,
    !formData.tipo_de_negocio.trim()
      ? { label: "Modalidade", tab: "structure" }
      : null,
    !formData.public_address_visibility.trim()
      ? { label: "Visibilidade do endereço no site", tab: "location" }
      : null,
    isSale && !formData.preco.trim()
      ? { label: "Preço de venda", tab: "values" }
      : null,
    isRental && !formData.valor_locacao.trim()
      ? { label: "Valor de locação", tab: "values" }
      : null,
    isLand && !formData.area_total.trim()
      ? { label: "Área total", tab: "characteristics" }
      : null,
    !isLand && !formData.quartos.trim()
      ? { label: "Quartos", tab: "characteristics" }
      : null,
    !formData.imagem_principal.trim()
      ? { label: "Imagem principal", tab: "media" }
      : null,
    formData.fotos.length === 0
      ? { label: "Fotos do imóvel", tab: "media" }
      : null,
  ].filter((issue): issue is ValidationIssue => Boolean(issue));
  const visibleValidationIssues = hasTriedSubmit ? validationIssues : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasTriedSubmit(true);

    if (validationIssues.length > 0) {
      const firstIssue = validationIssues[0];
      setActiveTab(firstIssue.tab);
      toast.error(
        `Preencha: ${validationIssues
          .slice(0, 4)
          .map((issue) => issue.label)
          .join(", ")}${validationIssues.length > 4 ? "..." : ""}`,
      );
      return;
    }

    const parseNum = (v: string) => parseLocaleNumber(v);
    const parseInt2 = (v: string) => (v ? parseInt(v) || null : null);

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
      quartos: parseInt2(formData.quartos),
      suites: parseInt2(formData.suites),
      banheiros: parseInt2(formData.banheiros),
      vagas: parseInt2(formData.vagas),
      area_util: parseNum(formData.area_util),
      area_total: parseNum(formData.area_total),
      mobilia: formData.mobilia || null,
      regra_pet: formData.regra_pet,
      andar: parseInt2(formData.andar),
      ano_construcao: parseInt2(formData.ano_construcao),
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
      imagem_principal: formData.imagem_principal || null,
      fotos: formData.fotos,
      video_imovel: formData.video_imovel || null,
      detalhes_extras: formData.detalhes_extras,
      proximidades: formData.proximidades,
      // New fields
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
      ano_reforma: parseInt2(formData.ano_reforma),
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
        hidden_site_image_urls: formData.hidden_site_image_urls,
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

    if (isEditing && !canAssignProperty) {
      delete propertyData.cadastrado_por;
    }
    if (isEditing) {
      delete propertyData.tipo_de_imovel;
      delete propertyData.property_type_id;
    }

    try {
      if (isEditing && propertyId) {
        await updateProperty.mutateAsync({ id: propertyId, ...propertyData });
      } else {
        await createProperty.mutateAsync(propertyData);
      }
      clearDraft(draftKey);
      router.push("/properties");
    } catch {
      // errors handled by mutation
    }
  };

  const handleImagesChange = (images: string[], mainImage: string) => {
    setFormData((prev) => ({
      ...prev,
      fotos: images,
      imagem_principal: mainImage,
    }));
  };

  const handleAddPurpose = () => {
    const name = newPurposeName.trim();
    if (!name) return;
    setPurposeOptions((prev) => appendUniqueOption(prev, name));
    set("finalidade", name);
    setNewPurposeName("");
    setShowAddPurpose(false);
  };

  const handleAddPropertyType = async () => {
    const name = newTypeName.trim();
    if (!name) return;
    await createPropertyType.mutateAsync(name);
    set("tipo_de_imovel", name);
    setNewTypeName("");
    setShowAddType(false);
  };

  const handleAddDealType = () => {
    const name = newDealName.trim();
    if (!name) return;
    setDealOptions((prev) => appendUniqueOption(prev, name));
    handleDealTypeChange(name);
    setNewDealName("");
    setShowAddDeal(false);
  };

  const handleDealTypeChange = (value: string) => {
    const supportsTerms = isSaleType(value);
    const isSeasonal = normalize(value) === "temporada";

    setFormData((prev) => ({
      ...prev,
      tipo_de_negocio: value,
      financing_mode: supportsTerms ? prev.financing_mode || "sim" : "nao",
      aceita_financiamento: supportsTerms
        ? prev.financing_mode !== "nao"
        : false,
      aceita_permuta: supportsTerms ? prev.aceita_permuta : false,
      iptu_isento: isSeasonal ? true : prev.iptu_isento,
    }));
  };

  const handleCreateCity = async () => {
    const name = (newCityName || formData.cidade).trim();
    const uf = (newCityUf || formData.uf).trim().toUpperCase();
    if (!name) {
      toast.error("Informe o nome da cidade.");
      return;
    }
    const city = await createCity.mutateAsync({ name, uf });
    applyCity(city);
    setNewCityName("");
    setNewCityUf("");
    setShowAddCity(false);
  };

  const handleCreateNeighborhood = async () => {
    const name = (newNeighborhoodName || formData.bairro).trim();
    if (!formData.city_id) {
      toast.error("Selecione ou cadastre a cidade antes do bairro.");
      return;
    }
    if (!name) {
      toast.error("Informe o nome do bairro.");
      return;
    }
    const neighborhood = await createNeighborhood.mutateAsync({
      name,
      city_id: formData.city_id,
    });
    applyNeighborhood(neighborhood);
    setNewNeighborhoodName("");
    setShowAddNeighborhood(false);
  };

  const handleCreateCondominium = async () => {
    const name = newCondominiumName.trim();
    if (!name) {
      toast.error("Informe o nome do condomínio.");
      return;
    }
    const fee = newCondominiumFee
      ? Number(parseCurrencyInput(newCondominiumFee))
      : undefined;
    const condominium = await createCondominium.mutateAsync({
      name,
      city_id: formData.city_id || undefined,
      neighborhood_id: formData.neighborhood_id || undefined,
      address: formData.endereco || undefined,
      cep: formData.cep || undefined,
      number: formData.numero || undefined,
      complement: formData.complemento || undefined,
      photo_url: newCondominiumPhoto || undefined,
      default_condominium_fee: Number.isFinite(fee) ? fee : undefined,
      has_concierge: newCondominiumHasConcierge,
      concierge_type: newCondominiumConciergeType || undefined,
    });
    applyCondominium(condominium);
    setNewCondominiumName("");
    setNewCondominiumFee("");
    setNewCondominiumPhoto("");
    setNewCondominiumHasConcierge(false);
    setNewCondominiumConciergeType("");
    setShowAddCondominium(false);
  };

  const handleCreateOwner = async () => {
    if (!formData.owner_name.trim()) {
      toast.error("Informe o nome do proprietário.");
      return;
    }
    const owner = await createPropertyOwner.mutateAsync({
      name: formData.owner_name,
      phone_residential: formData.owner_phone_residential || undefined,
      phone_commercial: formData.owner_phone_commercial || undefined,
      cellphone: formData.owner_cellphone || undefined,
      email: formData.owner_email || undefined,
      media_source: formData.owner_media_source || undefined,
      notify_email: formData.owner_notify_email,
    });
    applyOwner(owner);
  };

  if (isEditing && loadingProperty) {
    return (
      <AppLayout title="Carregando...">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const tabs: PropertyFormTab[] = [
    {
      value: "owner",
      label: "Proprietário",
      description: "Proprietário e responsável interno",
      icon: User,
    },
    {
      value: "structure",
      label: "Dados do imóvel",
      description: "Título, tipo e modalidade",
      icon: Home,
    },
    {
      value: "location",
      label: "Localização",
      description: "Endereço e visibilidade pública",
      icon: MapPin,
    },
    {
      value: "values",
      label: "Valores",
      description: "Venda, locação e encargos",
      icon: DollarSign,
    },
    {
      value: "characteristics",
      label: "Características",
      description: "Cômodos, áreas e condições",
      icon: Settings2,
    },
    {
      value: "extras",
      label: "Extras",
      description: "Diferenciais e proximidades",
      icon: Tag,
    },
    {
      value: "media",
      label: "Mídia e descrições",
      description: "Fotos, vídeo e textos",
      icon: Image,
    },
    {
      value: "publication",
      label: "Publicação",
      description: "Destaques e site público",
      icon: Globe,
    },
    {
      value: "commissions",
      label: "Comissões",
      description: "Corretor e condição comercial",
      icon: Percent,
    },
    {
      value: "confidential",
      label: "Confidencial",
      description: "Documentação e dados internos",
      icon: Lock,
    },
  ];
  return (
    <AppLayout
      title={isEditing ? "Editar Imóvel" : "Novo Imóvel"}
      disableMainScroll
    >
      <form
        data-tour="property-form"
        onSubmit={handleSubmit}
        className="property-form-surface h-full min-h-0 flex flex-col gap-3 text-[12px] font-light animate-in [&_.app-card]:rounded-[8px] [&_.app-card-soft]:rounded-[6px] [&_button]:text-[12px] [&_button]:font-light [&_input]:rounded-[6px] [&_input]:text-[12px] [&_input]:font-light [&_label]:text-[12px] [&_label]:font-light [&_textarea]:rounded-[6px] [&_textarea]:text-[12px] [&_textarea]:font-light [&_[role=combobox]]:rounded-[6px] [&_[role=combobox]]:text-[12px] [&_[role=combobox]]:font-light"
      >
        {((isEditing && property) || (hasDraft && !isEditing)) && (
          <div className="text-sm text-muted-foreground flex-shrink-0 flex items-center gap-2">
            {isEditing && property && (
              <span>
                Código:{" "}
                <span className="font-mono font-medium text-foreground">
                  {property.code}
                </span>
              </span>
            )}
            {hasDraft && !isEditing && (
              <span className="text-xs text-muted-foreground/80 bg-[var(--app-surface-soft)] px-2 py-0.5 rounded">
                Rascunho restaurado
              </span>
            )}
          </div>
        )}

        {visibleValidationIssues.length > 0 && (
          <div className="app-card-soft flex flex-col gap-3 border-0 p-4 text-sm sm:flex-row sm:items-start">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 space-y-2">
              <p className="font-medium">
                Faltam alguns dados obrigatórios para salvar este imóvel.
              </p>
              <p className="text-muted-foreground">
                Preencha:{" "}
                {visibleValidationIssues
                  .slice(0, 6)
                  .map((issue) => issue.label)
                  .join(", ")}
                {visibleValidationIssues.length > 6
                  ? ` e mais ${visibleValidationIssues.length - 6}`
                  : ""}
                .
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveTab(visibleValidationIssues[0].tab)}
              >
                Ir para primeiro campo pendente
              </Button>
            </div>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col gap-3"
        >
          <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
            <div
              data-collapse="compact"
              className="app-responsive-tab-list property-form-tabs-icon-only min-w-0 flex-1"
            >
              <TooltipProvider delayDuration={100}>
                <TabsList
                  data-tour="property-form-tabs"
                  data-responsive-tab-scroll
                  aria-label="Etapas do formulário do imóvel"
                  className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const tabHasIssue = visibleValidationIssues.some(
                      (issue) => issue.tab === tab.value,
                    );

                    return (
                      <Tooltip key={tab.value}>
                        <TooltipTrigger asChild>
                          <TabsTrigger
                            ref={(node) => {
                              propertyTabRefs.current[tab.value] = node;
                            }}
                            value={tab.value}
                            type="button"
                            data-responsive-tab
                            data-tour={`property-tab-${tab.value}`}
                            aria-label={tab.label}
                            className={propertyFormTabTriggerClass}
                          >
                            <Icon aria-hidden="true" className="h-3 w-3" />
                            {tabHasIssue && (
                              <span
                                data-responsive-tab-badge
                                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary"
                              />
                            )}
                          </TabsTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          {tab.label}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </TabsList>
              </TooltipProvider>
            </div>
            <div className="ml-auto grid w-auto flex-shrink-0 grid-cols-2 items-center gap-2 sm:flex">
              <Button
                type="button"
                variant="ghost"
                className="h-9 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-foreground shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() => {
                  clearDraft(draftKey);
                  router.push("/properties");
                }}
              >
                Cancelar
              </Button>
              <Button
                data-tour="property-save-button"
                type="submit"
                className="h-9 min-w-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                disabled={
                  createProperty.isPending ||
                  updateProperty.isPending ||
                  !canEdit
                }
              >
                {(createProperty.isPending || updateProperty.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <Save className="mr-2 h-4 w-4" />
                {isEditing ? "Salvar" : "Cadastrar"}
              </Button>
            </div>
          </div>
          <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
            {/* 1. Proprietário */}
            <TabsContent value="owner">
              <Card data-tour="property-owner-section" className="app-card">
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Responsável e Proprietário
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="app-card-soft border-0 p-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_184px] lg:items-end">
                      <div className="space-y-2">
                        <Label>
                          Responsável pela captação <RequiredMark />
                        </Label>
                        <Select
                          value={formData.cadastrado_por}
                          onValueChange={(v) => set("cadastrado_por", v)}
                          disabled={!canAssignProperty}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o captador responsável" />
                          </SelectTrigger>
                          <SelectContent>
                            {user?.id && (
                              <SelectItem key={user.id} value={user.id}>
                                {profile?.name || user.email} (Você)
                              </SelectItem>
                            )}
                            {users
                              .filter((u) => u.id !== user?.id)
                              .map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.name || u.email}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Proprietário cadastrado</Label>
                        <Select
                          value={formData.owner_id || "__manual__"}
                          onValueChange={(value) => {
                            if (value === "__manual__") {
                              set("owner_id", "");
                              return;
                            }
                            applyOwner(
                              propertyOwners.find(
                                (owner) => owner.id === value,
                              ) || null,
                            );
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecionar proprietário" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">
                              Digitar novo proprietário
                            </SelectItem>
                            {propertyOwners.map((owner) => (
                              <SelectItem key={owner.id} value={owner.id}>
                                {owner.name}
                                {owner.cellphone ? ` - ${owner.cellphone}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleCreateOwner}
                        disabled={
                          createPropertyOwner.isPending ||
                          !formData.owner_name.trim()
                        }
                        className="h-10 w-full rounded-[6px] border-0 bg-[var(--app-surface)] px-5 shadow-none hover:bg-primary hover:text-primary-foreground disabled:hover:bg-[var(--app-surface)] disabled:hover:text-muted-foreground lg:mb-2"
                      >
                        {createPropertyOwner.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        <Plus className="mr-2 h-4 w-4" />
                        Salvar proprietário
                      </Button>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Apenas administradores e o responsável pela captação
                      poderão editar o imóvel depois.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>
                        Nome do Proprietário <RequiredMark />
                      </Label>
                      <Input
                        value={formData.owner_name}
                        onChange={(e) => {
                          set("owner_id", "");
                          set("owner_name", e.target.value);
                        }}
                        placeholder="Nome completo"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>E-mail</Label>
                      <Input
                        type="email"
                        value={formData.owner_email}
                        onChange={(e) => set("owner_email", e.target.value)}
                        placeholder="email@exemplo.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Tel. Residencial</Label>
                      <Input
                        value={formData.owner_phone_residential}
                        onChange={(e) =>
                          set("owner_phone_residential", e.target.value)
                        }
                        placeholder="(00) 0000-0000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tel. Comercial</Label>
                      <Input
                        value={formData.owner_phone_commercial}
                        onChange={(e) =>
                          set("owner_phone_commercial", e.target.value)
                        }
                        placeholder="(00) 0000-0000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Celular</Label>
                      <Input
                        value={formData.owner_cellphone}
                        onChange={(e) => set("owner_cellphone", e.target.value)}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Informe pelo menos um contato do proprietário{" "}
                    <RequiredMark />: celular, telefone ou e-mail.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1.25fr] gap-4">
                    <div className="space-y-2">
                      <Label>Mídia de Origem</Label>
                      <Select
                        value={formData.owner_media_source}
                        onValueChange={(v) => set("owner_media_source", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="indicacao">Indicação</SelectItem>
                          <SelectItem value="site">Site</SelectItem>
                          <SelectItem value="redes_sociais">
                            Redes Sociais
                          </SelectItem>
                          <SelectItem value="placa">Placa</SelectItem>
                          <SelectItem value="portais">
                            Portais Imobiliários
                          </SelectItem>
                          <SelectItem value="outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className={togglePanelClass}>
                      <Label>
                        Enviar avisos por e-mail para o proprietário
                      </Label>
                      <Switch
                        checked={formData.owner_notify_email}
                        onCheckedChange={(v) => set("owner_notify_email", v)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 2. Estrutura */}
            <TabsContent value="structure">
              <Card data-tour="property-structure-section" className="app-card">
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Estrutura
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>
                      Título do Imóvel <RequiredMark />
                    </Label>
                    <Input
                      value={formData.title}
                      onChange={(e) => set("title", e.target.value)}
                      placeholder="Ex: Apartamento 3 quartos..."
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>Finalidade</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                          onClick={() => setShowAddPurpose(!showAddPurpose)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Nova
                        </Button>
                      </div>
                      {showAddPurpose && (
                        <div className="flex gap-2 mb-2">
                          <Input
                            placeholder="Nova finalidade..."
                            value={newPurposeName}
                            onChange={(e) => setNewPurposeName(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={handleAddPurpose}
                          >
                            OK
                          </Button>
                        </div>
                      )}
                      <Select
                        value={formData.finalidade}
                        onValueChange={(v) => set("finalidade", v)}
                      >
                        <SelectTrigger>
                          <span className="truncate">
                            {formData.finalidade || "Selecione"}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {displayedPurposeOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>
                          Tipo de Imóvel <RequiredMark />
                        </Label>
                        {!isEditing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                            onClick={() => setShowAddType(!showAddType)}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Novo
                          </Button>
                        )}
                      </div>
                      {!isEditing && showAddType && (
                        <div className="flex gap-2 mb-2">
                          <Input
                            placeholder="Novo tipo..."
                            value={newTypeName}
                            onChange={(e) => setNewTypeName(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={handleAddPropertyType}
                            disabled={createPropertyType.isPending}
                          >
                            OK
                          </Button>
                        </div>
                      )}
                      {isEditing ? (
                        <div className="flex min-h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-sm text-muted-foreground">
                          <Lock className="h-4 w-4 shrink-0" />
                          <span className="truncate font-medium text-foreground">
                            {formData.tipo_de_imovel || "Tipo não informado"}
                          </span>
                        </div>
                      ) : (
                        <Select
                          value={formData.tipo_de_imovel}
                          onValueChange={(v) => set("tipo_de_imovel", v)}
                        >
                          <SelectTrigger>
                            <span className="truncate">
                              {formData.tipo_de_imovel || "Selecione"}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            {propertyTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>
                          Modalidade <RequiredMark />
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                          onClick={() => setShowAddDeal(!showAddDeal)}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Nova
                        </Button>
                      </div>
                      {showAddDeal && (
                        <div className="flex gap-2 mb-2">
                          <Input
                            placeholder="Nova modalidade..."
                            value={newDealName}
                            onChange={(e) => setNewDealName(e.target.value)}
                            className="h-8 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={handleAddDealType}
                          >
                            OK
                          </Button>
                        </div>
                      )}
                      <Select
                        value={formData.tipo_de_negocio}
                        onValueChange={handleDealTypeChange}
                      >
                        <SelectTrigger>
                          <span className="truncate">
                            {formData.tipo_de_negocio || "Selecione"}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {displayedDealOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={formData.status}
                        onValueChange={(v) => set("status", v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Referência Alternativa</Label>
                      <Input
                        value={formData.referencia_alternativa}
                        onChange={(e) =>
                          set("referencia_alternativa", e.target.value)
                        }
                        placeholder="Código externo..."
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 3. Localização */}
            <TabsContent value="location">
              <Card data-tour="property-location-section" className="app-card">
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Localização do Imóvel
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,.9fr)_minmax(240px,1fr)_140px]">
                    <div className="space-y-2">
                      <Label>
                        Endereço no site público <RequiredMark />
                      </Label>
                      <Select
                        value={formData.public_address_visibility}
                        onValueChange={(v) =>
                          set("public_address_visibility", v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Visibilidade do endereço" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="completo">
                            Completo - rua, número, bairro, cidade, UF e CEP
                          </SelectItem>
                          <SelectItem value="parcial">
                            Parcial - bairro, cidade e UF
                          </SelectItem>
                          <SelectItem value="minimo">
                            Mínimo - cidade e UF
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>CEP</Label>
                      <div className="relative">
                        <Input
                          value={formData.cep}
                          onChange={(e) => {
                            const digits = onlyCepDigits(e.target.value);
                            const formatted = formatCep(digits);
                            set("cep", formatted);
                            if (digits.length === 8) {
                              void lookupCep(digits);
                            }
                          }}
                          onBlur={() => void lookupCep(formData.cep)}
                          placeholder="00000-000"
                          className="pr-9"
                        />
                        {isCepLoading && (
                          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>País</Label>
                      <Input
                        value={formData.pais}
                        onChange={(e) => set("pais", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[84px_minmax(230px,1.2fr)_minmax(220px,1.1fr)_minmax(220px,1.15fr)]">
                    <div className="space-y-2">
                      <Label>UF</Label>
                      <Input
                        maxLength={2}
                        value={formData.uf}
                        onChange={(e) =>
                          set("uf", e.target.value.toUpperCase())
                        }
                        placeholder="SP"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>Cidade</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                          onClick={() => {
                            setNewCityName(formData.cidade);
                            setNewCityUf(formData.uf);
                            setShowAddCity((open) => !open);
                          }}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Nova
                        </Button>
                      </div>
                      <div
                        className={
                          !formData.city_id
                            ? "grid grid-cols-[92px_minmax(0,1fr)] gap-2"
                            : "grid grid-cols-1 gap-2"
                        }
                      >
                        <Select
                          value={formData.city_id || "__manual__"}
                          onValueChange={(value) => {
                            if (value === "__manual__") {
                              set("city_id", "");
                              return;
                            }
                            applyCity(
                              cities.find((city) => city.id === value) || null,
                            );
                          }}
                        >
                          <SelectTrigger>
                            <span className="truncate">
                              {formData.city_id
                                ? `${selectedCity?.name || formData.cidade}${selectedCity?.uf ? ` (${selectedCity.uf})` : ""}`
                                : "Manual"}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">Manual</SelectItem>
                            {cities.map((city) => (
                              <SelectItem key={city.id} value={city.id}>
                                {city.name}
                                {city.uf ? ` (${city.uf})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!formData.city_id && (
                          <Input
                            value={formData.cidade}
                            onChange={(e) => set("cidade", e.target.value)}
                            placeholder="Digite a cidade"
                          />
                        )}
                      </div>
                      {showAddCity && (
                        <div className="grid grid-cols-[minmax(0,1fr)_64px_auto] gap-2">
                          <Input
                            value={newCityName}
                            onChange={(e) => setNewCityName(e.target.value)}
                            placeholder="Nova cidade"
                            className="h-8 text-sm"
                          />
                          <Input
                            value={newCityUf}
                            onChange={(e) =>
                              setNewCityUf(e.target.value.toUpperCase())
                            }
                            placeholder="UF"
                            maxLength={2}
                            className="h-8 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={handleCreateCity}
                            disabled={createCity.isPending}
                          >
                            OK
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>Bairro</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                          onClick={() => {
                            setNewNeighborhoodName(formData.bairro);
                            setShowAddNeighborhood((open) => !open);
                          }}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Novo
                        </Button>
                      </div>
                      <div
                        className={
                          !formData.neighborhood_id
                            ? "grid grid-cols-[92px_minmax(0,1fr)] gap-2"
                            : "grid grid-cols-1 gap-2"
                        }
                      >
                        <Select
                          value={formData.neighborhood_id || "__manual__"}
                          onValueChange={(value) => {
                            if (value === "__manual__") {
                              set("neighborhood_id", "");
                              return;
                            }
                            applyNeighborhood(
                              neighborhoods.find(
                                (neighborhood) => neighborhood.id === value,
                              ) || null,
                            );
                          }}
                        >
                          <SelectTrigger>
                            <span className="truncate">
                              {formData.neighborhood_id
                                ? selectedNeighborhood?.name || formData.bairro
                                : "Manual"}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__manual__">Manual</SelectItem>
                            {neighborhoods.map((neighborhood) => (
                              <SelectItem
                                key={neighborhood.id}
                                value={neighborhood.id}
                              >
                                {neighborhood.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!formData.neighborhood_id && (
                          <Input
                            value={formData.bairro}
                            onChange={(e) => set("bairro", e.target.value)}
                            placeholder="Digite o bairro"
                          />
                        )}
                      </div>
                      {showAddNeighborhood && (
                        <div className="flex gap-2">
                          <Input
                            value={newNeighborhoodName}
                            onChange={(e) =>
                              setNewNeighborhoodName(e.target.value)
                            }
                            placeholder="Novo bairro"
                            className="h-8 text-sm"
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            onClick={handleCreateNeighborhood}
                            disabled={createNeighborhood.isPending}
                          >
                            OK
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label>Condomínio</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 border-0 px-2 text-xs shadow-none hover:bg-primary hover:text-primary-foreground"
                          onClick={() => setShowAddCondominium((open) => !open)}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Novo
                        </Button>
                      </div>
                      <Select
                        value={formData.condominium_id || "__none__"}
                        onValueChange={(value) => {
                          if (value === "__none__") {
                            applyCondominium(null);
                            return;
                          }
                          applyCondominium(
                            condominiums.find(
                              (condominium) => condominium.id === value,
                            ) || null,
                          );
                        }}
                      >
                        <SelectTrigger>
                          <span className="truncate">
                            {formData.condominium_id
                              ? selectedCondominium?.name || "Condomínio"
                              : "Sem condomínio"}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            Sem condomínio
                          </SelectItem>
                          {condominiums.map((condominium) => (
                            <SelectItem
                              key={condominium.id}
                              value={condominium.id}
                            >
                              {[
                                condominium.name,
                                condominium.neighborhood?.name,
                                condominium.city?.name,
                              ]
                                .filter(Boolean)
                                .join(" - ")}
                              {condominium.default_condominium_fee
                                ? ` - R$ ${Number(condominium.default_condominium_fee).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_112px_minmax(220px,.55fr)]">
                    <div className="space-y-2">
                      <Label>Logradouro</Label>
                      <Input
                        value={formData.endereco}
                        onChange={(e) => set("endereco", e.target.value)}
                        placeholder="Rua, Avenida..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Número</Label>
                      <Input
                        value={formData.numero}
                        onChange={(e) => set("numero", e.target.value)}
                        placeholder="123"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Complemento</Label>
                      <Input
                        value={formData.complemento}
                        onChange={(e) => set("complemento", e.target.value)}
                        placeholder="Apto, bloco..."
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Quadra</Label>
                      <Input
                        value={formData.quadra}
                        onChange={(e) => set("quadra", e.target.value)}
                        placeholder="Ex: QD 12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Lote</Label>
                      <Input
                        value={formData.lote}
                        onChange={(e) => set("lote", e.target.value)}
                        placeholder="Ex: LT 08"
                      />
                    </div>
                  </div>
                  {showAddCondominium && (
                    <div className="app-card-soft grid grid-cols-1 gap-3 border-0 p-3 md:grid-cols-[1.35fr_.85fr]">
                      <div className="space-y-2">
                        <Label>Nome do condomínio</Label>
                        <Input
                          value={newCondominiumName}
                          onChange={(e) =>
                            setNewCondominiumName(e.target.value)
                          }
                          placeholder="Residencial..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Taxa padrão (R$)</Label>
                        <Input
                          value={formatCurrencyDisplay(newCondominiumFee)}
                          onChange={(e) =>
                            setNewCondominiumFee(
                              parseCurrencyInput(e.target.value),
                            )
                          }
                          placeholder="800"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>Foto do condomínio (URL)</Label>
                        <Input
                          value={newCondominiumPhoto}
                          onChange={(e) =>
                            setNewCondominiumPhoto(e.target.value)
                          }
                          placeholder="https://..."
                        />
                      </div>
                      <div className={togglePanelClass}>
                        <Label>Tem portaria</Label>
                        <Switch
                          checked={newCondominiumHasConcierge}
                          onCheckedChange={setNewCondominiumHasConcierge}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Tipo de portaria</Label>
                        <Select
                          value={newCondominiumConciergeType || undefined}
                          onValueChange={setNewCondominiumConciergeType}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="24h">24h</SelectItem>
                            <SelectItem value="comercial">
                              Horário comercial
                            </SelectItem>
                            <SelectItem value="remota">Remota</SelectItem>
                            <SelectItem value="sem_portaria">
                              Sem portaria
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end md:col-span-2">
                        <Button
                          type="button"
                          onClick={handleCreateCondominium}
                          disabled={createCondominium.isPending}
                        >
                          {createCondominium.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Cadastrar condomínio
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* 4. Características */}
            <TabsContent value="characteristics">
              <div
                data-tour="property-characteristics-section"
                className="space-y-4"
              >
                {/* Detalhes do imóvel */}
                <Card className="app-card">
                  <CardHeader>
                    <CardTitle className="text-[14px] font-normal">
                      Detalhes do Imóvel
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!isLand ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label>
                            Quartos <RequiredMark />
                          </Label>
                          <Select
                            value={formData.quartos}
                            onValueChange={(v) => set("quartos", v)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Qtd" />
                            </SelectTrigger>
                            <SelectContent>
                              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                  {n === 10 ? "10+" : String(n)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Suítes</Label>
                          <Input
                            type="number"
                            value={formData.suites}
                            onChange={(e) => set("suites", e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Banheiros</Label>
                          <Input
                            type="number"
                            value={formData.banheiros}
                            onChange={(e) => set("banheiros", e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Vagas</Label>
                          <Input
                            type="number"
                            value={formData.vagas}
                            onChange={(e) => set("vagas", e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                        Terreno e lote usam metragem total como dado principal.
                        Quartos, suítes, banheiros e vagas deixam de ser
                        obrigatórios.
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Área Útil (m²)</Label>
                        <Input
                          inputMode="decimal"
                          value={formData.area_util}
                          onChange={(e) =>
                            set("area_util", parseDecimalInput(e.target.value))
                          }
                          placeholder="120,5"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>
                          Área Total (m²){isLand && <RequiredMark />}
                        </Label>
                        <Input
                          inputMode="decimal"
                          value={formData.area_total}
                          onChange={(e) =>
                            set("area_total", parseDecimalInput(e.target.value))
                          }
                          placeholder="150,5"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Andar</Label>
                        <Input
                          type="number"
                          value={formData.andar}
                          onChange={(e) => set("andar", e.target.value)}
                          placeholder="5"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Ano de Construção</Label>
                        <Input
                          type="number"
                          value={formData.ano_construcao}
                          onChange={(e) =>
                            set("ano_construcao", e.target.value)
                          }
                          placeholder="2020"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Ano de Reforma</Label>
                        <Input
                          type="number"
                          value={formData.ano_reforma}
                          onChange={(e) => set("ano_reforma", e.target.value)}
                          placeholder="2023"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Padrão</Label>
                        <Select
                          value={formData.padrao}
                          onValueChange={(v) => set("padrao", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="popular">Popular</SelectItem>
                            <SelectItem value="medio">Médio</SelectItem>
                            <SelectItem value="alto">Alto</SelectItem>
                            <SelectItem value="luxo">Luxo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Posição da Localização</Label>
                        <Select
                          value={formData.posicao_localizacao}
                          onValueChange={(v) => set("posicao_localizacao", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="frente">Frente</SelectItem>
                            <SelectItem value="fundos">Fundos</SelectItem>
                            <SelectItem value="lateral">Lateral</SelectItem>
                            <SelectItem value="esquina">Esquina</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Situação do Imóvel</Label>
                        <Select
                          value={formData.situacao_imovel}
                          onValueChange={(v) => set("situacao_imovel", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="novo">Novo</SelectItem>
                            <SelectItem value="usado">Usado</SelectItem>
                            <SelectItem value="em_construcao">
                              Em Construção
                            </SelectItem>
                            <SelectItem value="planta">Na Planta</SelectItem>
                            <SelectItem value="reformado">Reformado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Ocupação</Label>
                        <Select
                          value={formData.ocupacao}
                          onValueChange={(v) => set("ocupacao", v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desocupado">
                              Desocupado
                            </SelectItem>
                            <SelectItem value="ocupado_proprietario">
                              Ocupado pelo proprietário
                            </SelectItem>
                            <SelectItem value="ocupado_inquilino">
                              Ocupado por inquilino
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Mobília</Label>
                      <Select
                        value={formData.mobilia}
                        onValueChange={(v) => set("mobilia", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Mobiliado">Mobiliado</SelectItem>
                          <SelectItem value="Semi-mobiliado">
                            Semi-mobiliado
                          </SelectItem>
                          <SelectItem value="Sem mobília">
                            Sem mobília
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className={togglePanelClass}>
                        <Label>Aceita Pet</Label>
                        <Switch
                          checked={formData.regra_pet}
                          onCheckedChange={(v) => set("regra_pet", v)}
                        />
                      </div>
                      <div className={togglePanelClass}>
                        <Label>Autorizado para Comercialização</Label>
                        <Switch
                          checked={formData.autorizado_comercializacao}
                          onCheckedChange={(v) =>
                            set("autorizado_comercializacao", v)
                          }
                        />
                      </div>
                      <div className={togglePanelClass}>
                        <Label>Exclusividade</Label>
                        <Switch
                          checked={formData.exclusividade}
                          onCheckedChange={(v) => set("exclusividade", v)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Controle interno */}
                <Card className="app-card">
                  <CardHeader>
                    <CardTitle className="text-[14px] font-normal">
                      Controle interno
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Zoneamento</Label>
                        <Input
                          value={formData.zoneamento}
                          onChange={(e) => set("zoneamento", e.target.value)}
                          placeholder="ZR-1, ZC-2..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Local das Chaves</Label>
                        <Input
                          value={formData.local_chaves}
                          onChange={(e) => set("local_chaves", e.target.value)}
                          placeholder="Ex: Na portaria, no escritório..."
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Comentários Internos</Label>
                      <Textarea
                        value={formData.comentarios_internos}
                        onChange={(e) =>
                          set("comentarios_internos", e.target.value)
                        }
                        placeholder="Observações internas..."
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* 5. Extras (Features/Proximities) */}
            <TabsContent value="extras">
              <div
                data-tour="property-extras-section"
                className="grid grid-cols-1 lg:grid-cols-2 gap-4"
              >
                <Card className="app-card">
                  <CardContent className="pt-6">
                    <FeatureSelector
                      title="Detalhes Extras do Imóvel"
                      options={
                        features.length > 0
                          ? features.map((f) => f.name)
                          : DEFAULT_FEATURES
                      }
                      selected={formData.detalhes_extras}
                      onChange={(selected) => set("detalhes_extras", selected)}
                      allowAdd
                      onAddNew={async (name) => {
                        await createFeature.mutateAsync(name);
                      }}
                      isLoading={loadingFeatures}
                    />
                  </CardContent>
                </Card>
                <Card className="app-card">
                  <CardContent className="pt-6">
                    <FeatureSelector
                      title="Proximidades"
                      options={
                        proximities.length > 0
                          ? proximities.map((p) => p.name)
                          : DEFAULT_PROXIMITIES
                      }
                      selected={formData.proximidades}
                      onChange={(selected) => set("proximidades", selected)}
                      allowAdd
                      onAddNew={async (name) => {
                        await createProximity.mutateAsync(name);
                      }}
                      isLoading={loadingProximities}
                    />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* 6. Valores */}
            <TabsContent value="values">
              <Card data-tour="property-values-section" className="app-card">
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Valores
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={primaryValuesGridClass}>
                    {isSale && (
                      <div className="space-y-2">
                        <Label>
                          Preço de venda (R$) <RequiredMark />
                        </Label>
                        <CurrencyInput
                          value={formData.preco}
                          onValueChange={(value) => set("preco", value)}
                          className="text-[14px] font-normal"
                        />
                      </div>
                    )}
                    {isRental && (
                      <div className="space-y-2">
                        <Label>
                          Valor de locação (R$) <RequiredMark />
                        </Label>
                        <CurrencyInput
                          value={formData.valor_locacao}
                          onValueChange={(value) => set("valor_locacao", value)}
                          className="text-[14px] font-normal"
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Condomínio (R$)</Label>
                      <div className="grid grid-cols-[minmax(0,1fr)_78px] gap-2">
                        <CurrencyInput
                          value={formData.condominio}
                          onValueChange={(value) => set("condominio", value)}
                          disabled={formData.condominio_isento}
                        />
                        <label className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-1 text-xs text-muted-foreground">
                          <Switch
                            checked={formData.condominio_isento}
                            onCheckedChange={(v) => set("condominio_isento", v)}
                          />
                          Isento
                        </label>
                      </div>
                      {selectedCondominium?.default_condominium_fee && (
                        <p className="text-xs text-muted-foreground">
                          Preenchido pelo condomínio selecionado.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>IPTU (R$)</Label>
                      <div className="grid grid-cols-[minmax(0,1fr)_78px] gap-2">
                        <CurrencyInput
                          value={formData.iptu}
                          onValueChange={(value) => set("iptu", value)}
                          disabled={formData.iptu_isento}
                        />
                        <label className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] px-1 text-xs text-muted-foreground">
                          <Switch
                            checked={formData.iptu_isento}
                            onCheckedChange={(v) => set("iptu_isento", v)}
                          />
                          Isento
                        </label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Período do IPTU</Label>
                      <Select
                        value={formData.iptu_period || "mensal"}
                        onValueChange={(v) => set("iptu_period", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mensal">Mensal</SelectItem>
                          <SelectItem value="anual">Anual</SelectItem>
                          <SelectItem value="parcelado">Parcelado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label>ITR rural (R$)</Label>
                      <CurrencyInput
                        value={formData.valor_itr}
                        onValueChange={(value) => set("valor_itr", value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Seguro incêndio (R$)</Label>
                      <CurrencyInput
                        value={formData.seguro_incendio}
                        onValueChange={(value) => set("seguro_incendio", value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Taxa de limpeza/serviço (R$)</Label>
                      <CurrencyInput
                        value={formData.taxa_de_servico}
                        onValueChange={(value) => set("taxa_de_servico", value)}
                      />
                    </div>
                    {isSale && (
                      <div className="space-y-2">
                        <Label>Valor venda avaliado (R$)</Label>
                        <CurrencyInput
                          value={formData.valor_venda_avaliado}
                          onValueChange={(value) =>
                            set("valor_venda_avaliado", value)
                          }
                        />
                      </div>
                    )}
                    {isRental && (
                      <div className="space-y-2">
                        <Label>Valor locação avaliado (R$)</Label>
                        <CurrencyInput
                          value={formData.valor_locacao_avaliado}
                          onValueChange={(value) =>
                            set("valor_locacao_avaliado", value)
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                    {supportsRentalContractTerms && (
                      <div className="space-y-2">
                        <Label>Seguro fiança (R$)</Label>
                        <CurrencyInput
                          value={formData.valor_seguro_fianca}
                          onValueChange={(value) =>
                            set("valor_seguro_fianca", value)
                          }
                        />
                      </div>
                    )}
                    {supportsRentalContractTerms && (
                      <div className="space-y-2">
                        <Label>Índice de reajuste</Label>
                        <Select
                          value={formData.rent_adjustment_index || "none"}
                          onValueChange={(v) =>
                            set("rent_adjustment_index", v === "none" ? "" : v)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Não informado</SelectItem>
                            {RENT_ADJUSTMENT_INDEXES.map((index) => (
                              <SelectItem key={index} value={index}>
                                {index}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {supportsSaleTerms && (
                    <div className="app-card-soft border-0 p-4">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,.75fr)_minmax(180px,.55fr)_minmax(180px,.55fr)]">
                        <div className="space-y-2">
                          <Label>Financiável</Label>
                          <Select
                            value={
                              formData.financing_mode ||
                              (formData.aceita_financiamento ? "sim" : "nao")
                            }
                            onValueChange={(v) => {
                              set("financing_mode", v);
                              set("aceita_financiamento", v !== "nao");
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sim">Sim</SelectItem>
                              <SelectItem value="nao">Não</SelectItem>
                              <SelectItem value="mcmv">
                                Minha Casa Minha Vida
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className={togglePanelClass}>
                          <Label>Usou FGTS nos últimos 3 anos?</Label>
                          <Switch
                            checked={formData.usou_fgts}
                            onCheckedChange={(v) => set("usou_fgts", v)}
                          />
                        </div>
                        <div className={togglePanelClass}>
                          <Label>Aceita permuta</Label>
                          <Switch
                            checked={formData.aceita_permuta}
                            onCheckedChange={(v) => set("aceita_permuta", v)}
                          />
                        </div>
                      </div>

                      {(formData.financing_mode !== "nao" ||
                        formData.aceita_permuta) && (
                        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                          {formData.financing_mode !== "nao" && (
                            <div className="space-y-2">
                              <Label>Detalhes do financiamento</Label>
                              <Textarea
                                value={formData.financing_details}
                                onChange={(e) =>
                                  set("financing_details", e.target.value)
                                }
                                placeholder="Ex: aceita carta de crédito, bancos preferenciais, MCMV, restrições..."
                                rows={3}
                              />
                            </div>
                          )}
                          {formData.aceita_permuta && (
                            <div className="space-y-2">
                              <Label>Recebe como permuta</Label>
                              <Textarea
                                value={formData.exchange_details}
                                onChange={(e) =>
                                  set("exchange_details", e.target.value)
                                }
                                placeholder="Ex: aceita imóvel menor, veículo, lote, região de interesse..."
                                rows={3}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* 7. Fotos / Mídia */}
            <TabsContent value="media">
              <Card data-tour="property-media-section" className="app-card">
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Fotos e Mídia
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ImageUploader
                    images={formData.fotos}
                    mainImage={formData.imagem_principal}
                    onImagesChange={handleImagesChange}
                    hiddenSiteImages={formData.hidden_site_image_urls}
                    onHiddenSiteImagesChange={(images) =>
                      set("hidden_site_image_urls", images)
                    }
                    organizationId={activeOrganizationId}
                    propertyId={property?.id}
                  />
                  <Separator />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Link do Vídeo (YouTube)</Label>
                      <Input
                        value={formData.video_imovel}
                        onChange={(e) => set("video_imovel", e.target.value)}
                        placeholder="https://youtube.com/watch?v=..."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tour Virtual (URL)</Label>
                      <Input
                        value={formData.tour_virtual}
                        onChange={(e) => set("tour_virtual", e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição interna do imóvel</Label>
                    <Textarea
                      value={formData.descricao}
                      onChange={(e) => set("descricao", e.target.value)}
                      placeholder="Observações e descrição usadas dentro do CRM..."
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use este campo para registrar detalhes internos da equipe.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição pública no site</Label>
                    <Textarea
                      value={formData.descricao_site}
                      onChange={(e) => set("descricao_site", e.target.value)}
                      placeholder="Texto comercial que será exibido no site público..."
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground">
                      Use uma descrição mais comercial, sem informações
                      confidenciais.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 8. Publicação */}
            <TabsContent value="publication">
              <Card
                data-tour="property-publication-section"
                className="app-card"
              >
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Publicação na Web
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div
                      data-testid="property-publication-guidance"
                      className="flex flex-col gap-3 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between lg:col-span-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                          {formData.anunciar ? (
                            <Globe className="h-4 w-4" />
                          ) : (
                            <Lock className="h-4 w-4" />
                          )}
                        </span>
                        <div>
                          <Label>Publicação centralizada na Ficha 360</Label>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {isEditing
                              ? `Este imóvel está ${formData.anunciar ? "publicado" : "fora do site"}. Use a Central de Publicação para validar requisitos, conferir a prévia e alterar esse estado.`
                              : "O novo imóvel será salvo fora do site. Depois do cadastro, publique com segurança pela Central de Publicação da Ficha 360."}
                          </p>
                        </div>
                      </div>
                      {isEditing && propertyId && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() =>
                            router.push(
                              `/properties/${propertyId}?tab=publication`,
                            )
                          }
                        >
                          <Globe className="mr-2 h-4 w-4" />
                          Abrir Central
                        </Button>
                      )}
                    </div>
                    <div className={togglePanelClass}>
                      <Label htmlFor="property-highlight-switch">
                        Imóvel em Destaque
                      </Label>
                      <Switch
                        id="property-highlight-switch"
                        checked={formData.destaque}
                        onCheckedChange={(v) => set("destaque", v)}
                      />
                    </div>
                    <div className={togglePanelClass}>
                      <Label htmlFor="property-super-highlight-switch">
                        Super Destaque
                      </Label>
                      <Switch
                        id="property-super-highlight-switch"
                        checked={formData.super_destaque}
                        onCheckedChange={(v) => set("super_destaque", v)}
                      />
                    </div>
                    <div className={togglePanelClass}>
                      <Label htmlFor="property-sign-switch">
                        Placa no Local
                      </Label>
                      <Switch
                        id="property-sign-switch"
                        checked={formData.placa_no_local}
                        onCheckedChange={(v) => set("placa_no_local", v)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 9. Comissões */}
            <TabsContent value="commissions">
              <Card
                data-tour="property-commissions-section"
                className="app-card"
              >
                <CardHeader>
                  <CardTitle className="text-[14px] font-normal">
                    Comissões e Condições
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo de Comissão</Label>
                      <Select
                        value={formData.tipo_comissao}
                        onValueChange={(v) => set("tipo_comissao", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentual">Percentual</SelectItem>
                          <SelectItem value="valor_fixo">Valor Fixo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Corretor</Label>
                      <Select
                        value={formData.corretor_id}
                        onValueChange={(v) => set("corretor_id", v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Comissão Venda (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.comissao_venda}
                        onChange={(e) => set("comissao_venda", e.target.value)}
                        placeholder="5"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Comissão Locação (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={formData.comissao_locacao}
                        onChange={(e) =>
                          set("comissao_locacao", e.target.value)
                        }
                        placeholder="100"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Data de Início</Label>
                      <Input
                        type="date"
                        value={formData.data_inicio_comissao}
                        onChange={(e) =>
                          set("data_inicio_comissao", e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Condição Comercial</Label>
                    <Textarea
                      value={formData.condicao_comercial}
                      onChange={(e) =>
                        set("condicao_comercial", e.target.value)
                      }
                      placeholder="Condições especiais..."
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 10. Confidencial */}
            <TabsContent value="confidential">
              <Card
                data-tour="property-confidential-section"
                className="app-card"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
                    <Lock className="h-4 w-4" /> Dados Confidenciais
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Código IPTU</Label>
                      <Input
                        value={formData.codigo_iptu}
                        onChange={(e) => set("codigo_iptu", e.target.value)}
                        placeholder="Código IPTU"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Número da Matrícula</Label>
                      <Input
                        value={formData.numero_matricula}
                        onChange={(e) =>
                          set("numero_matricula", e.target.value)
                        }
                        placeholder="Matrícula"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Código da Rede de Eletricidade</Label>
                      <Input
                        value={formData.codigo_eletricidade}
                        onChange={(e) =>
                          set("codigo_eletricidade", e.target.value)
                        }
                        placeholder="Código"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Código da Rede de Água</Label>
                      <Input
                        value={formData.codigo_agua}
                        onChange={(e) => set("codigo_agua", e.target.value)}
                        placeholder="Código"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Status/Descritivo</Label>
                      <Input
                        value={formData.status_descritivo}
                        onChange={(e) =>
                          set("status_descritivo", e.target.value)
                        }
                        placeholder="Descrição"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Aprovação Órgão Ambiental</Label>
                      <Input
                        value={formData.aprovacao_ambiental}
                        onChange={(e) =>
                          set("aprovacao_ambiental", e.target.value)
                        }
                        placeholder="Detalhes"
                      />
                    </div>
                  </div>
                  <div className={togglePanelClass}>
                    <Label>Projeto Aprovado</Label>
                    <Switch
                      checked={formData.projeto_aprovado}
                      onCheckedChange={(v) => set("projeto_aprovado", v)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Observações de Documentação</Label>
                    <Textarea
                      value={formData.observacoes_documentacao}
                      onChange={(e) =>
                        set("observacoes_documentacao", e.target.value)
                      }
                      placeholder="Observações sobre documentação..."
                      rows={4}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </form>
    </AppLayout>
  );
}
