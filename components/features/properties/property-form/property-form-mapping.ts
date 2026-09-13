import type { Property } from "@/hooks/use-properties";
import { cleanPropertyDescription } from "@/lib/property-description";
import { getPropertyMetadataString as metadataString } from "@/lib/property-display-utils";
import {
  normalize,
  normalizePropertyStatus,
  type PropertyFormData,
} from "./property-form-model";

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

function getManagedTerms(property: Property) {
  const terms = property.managed_terms;
  return terms && typeof terms === "object" ? terms : null;
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

function metadataBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

export function propertyToFormData(p: Property): PropertyFormData {
  const metadata = getPropertyMetadata(p);
  const managedTerms = getManagedTerms(p);
  const condominiumExempt =
    managedTerms?.condominium_exempt ??
    metadataBoolean(metadata.condominio_isento);
  const propertyTaxExempt =
    (managedTerms?.property_tax_exempt ??
      metadataBoolean(metadata.iptu_isento)) ||
    normalize(p.tipo_de_negocio || "") === "temporada";
  const propertyType =
    p.tipo_de_imovel || (p as PropertyWithCanonicalType).tipo || "";
  return {
    title: p.title || "",
    tipo_de_imovel: propertyType,
    tipo_de_negocio: p.tipo_de_negocio || "Venda",
    status: normalizePropertyStatus(p.status),
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
    condominio: condominiumExempt ? "" : p.condominio?.toString() || "",
    iptu: propertyTaxExempt ? "" : p.iptu?.toString() || "",
    seguro_incendio: p.seguro_incendio?.toString() || "",
    taxa_de_servico: p.taxa_de_servico?.toString() || "",
    condominio_isento: condominiumExempt,
    iptu_isento: propertyTaxExempt,
    iptu_period: metadataString(metadata.iptu_period) || "mensal",
    rent_adjustment_index: metadataString(metadata.rent_adjustment_index),
    financing_mode:
      managedTerms?.financing_mode ||
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
    finalidade: p.finalidade || "",
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
