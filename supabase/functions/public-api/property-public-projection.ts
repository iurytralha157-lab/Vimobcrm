export type JsonRecord = Record<string, unknown>;

export type PublicPropertyPublication = {
  id: string;
  property_id: string;
  desired_state: unknown;
  published_version: unknown;
};

export type PublicPropertyPublicationContext = {
  publication: PublicPropertyPublication | null;
  snapshot: JsonRecord | null;
  ambiguous?: boolean;
};

export type PublicPropertyFilters = {
  city?: string | null;
  neighborhood?: string | null;
  type?: string | null;
  purpose?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  bedrooms?: number | null;
};

const PUBLIC_PROPERTY_STATUSES = new Set(["active", "ativo"]);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function photoURL(value: unknown) {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  return record ? firstText(record.url, record.src, record.publicUrl) : "";
}

function publicPhotoURLs(property: JsonRecord, allowCanonicalRelative = false) {
  const hidden = new Set(
    stringArray(asRecord(property.metadata)?.hidden_site_image_urls),
  );
  const candidates = [
    property.imagem_principal,
    ...(Array.isArray(property.image_urls) ? property.image_urls : []),
    ...(Array.isArray(property.fotos) ? property.fotos : []),
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const url = photoURL(candidate);
    const safeCanonicalRelative = allowCanonicalRelative &&
      /^\/v1\/public\/property-publications\/[0-9a-f-]+\/versions\/[1-9]\d*\/assets\/[0-9a-f-]+$/i.test(url);
    if ((!/^https?:\/\//i.test(url) && !safeCanonicalRelative) || hidden.has(url) || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

export function normalizePublicAddressVisibility(value: unknown) {
  switch (text(value).toLowerCase()) {
    case "completo":
    case "complete":
    case "full":
      return "completo";
    case "minimo":
    case "mínimo":
    case "minimum":
    case "city":
    case "cidade":
      return "minimo";
    default:
      return "parcial";
  }
}

export function extractPublishedPropertySnapshot(payload: unknown) {
  const root = asRecord(payload);
  return asRecord(root?.property);
}

/**
 * Mirrors the Go public-site boundary. Once a site/default publication row
 * exists, its desired state and immutable published version are authoritative;
 * the compatibility boolean is considered only while no canonical row exists.
 */
export function publicPropertyIsEligible(
  property: JsonRecord | null,
  context: PublicPropertyPublicationContext,
) {
  if (!property || !PUBLIC_PROPERTY_STATUSES.has(text(property.status).toLowerCase())) {
    return false;
  }
  if (context.ambiguous) return false;

  if (context.publication) {
    const publishedVersion = finiteNumber(context.publication.published_version);
    return text(context.publication.id) !== "" &&
      text(context.publication.property_id) === text(property.id) &&
      context.publication.desired_state === "published" &&
      publishedVersion !== null &&
      Number.isInteger(publishedVersion) &&
      publishedVersion > 0 &&
      context.snapshot !== null &&
      text(context.snapshot.id) === text(property.id);
  }

  return property.published_on_site === true;
}

function legacyPublicSource(property: JsonRecord): JsonRecord {
  const photos = publicPhotoURLs(property);
  const visibility = normalizePublicAddressVisibility(
    firstText(property.address_visibility, property.public_address_visibility),
  );

  return {
    id: property.id,
    codigo: property.code,
    titulo: property.title,
    // `descricao` can contain internal copy. The public Go projection uses the
    // dedicated site description for compatibility rows.
    descricao: property.descricao_site,
    tipo_imovel: firstText(property.tipo, property.tipo_de_imovel),
    finalidade: firstText(property.finalidade, property.tipo_de_negocio),
    valor_venda: property.preco,
    valor_aluguel: property.valor_locacao,
    valor_condominio: property.condominio,
    iptu: property.iptu,
    taxa_de_servico: property.taxa_de_servico,
    valor_itr: property.valor_itr,
    seguro_incendio: property.seguro_incendio,
    quartos: property.quartos,
    suites: property.suites,
    banheiros: property.banheiros,
    vagas: property.vagas,
    area_total: property.area_total,
    area_construida: property.area_util,
    andar: property.andar,
    public_address_visibility: visibility,
    bairro: visibility === "minimo" ? null : property.bairro,
    cidade: property.cidade,
    estado: property.uf,
    pais: visibility === "completo" ? firstText(property.pais) || "Brasil" : null,
    endereco: visibility === "completo" ? property.endereco : null,
    numero: visibility === "completo" ? property.numero : null,
    complemento: visibility === "completo" ? property.complemento : null,
    cep: visibility === "completo" ? property.cep : null,
    latitude: visibility === "completo" ? property.latitude : null,
    longitude: visibility === "completo" ? property.longitude : null,
    imagem_principal: photos[0] ?? null,
    fotos: photos,
    detalhes_extras: stringArray(property.detalhes_extras),
    proximidades: stringArray(property.proximidades),
    video_imovel: property.video_imovel,
    tour_virtual: property.tour_virtual,
    aceita_financiamento: property.aceita_financiamento,
    aceita_permuta: property.aceita_permuta,
    usou_fgts: property.usou_fgts,
    exclusividade: property.exclusividade,
    destaque: property.is_featured ?? property.destaque,
    status: property.status,
    mobiliado: property.mobiliado ?? property.mobilia,
  };
}

function safeSnapshotSource(snapshot: JsonRecord): JsonRecord {
  const visibility = normalizePublicAddressVisibility(snapshot.public_address_visibility);
  const photos = publicPhotoURLs({
    imagem_principal: snapshot.imagem_principal,
    fotos: snapshot.fotos,
  }, true);

  return {
    id: snapshot.id,
    codigo: snapshot.codigo,
    titulo: snapshot.titulo,
    descricao: snapshot.descricao,
    tipo_imovel: snapshot.tipo_imovel,
    finalidade: snapshot.finalidade,
    valor_venda: snapshot.valor_venda,
    valor_aluguel: snapshot.valor_aluguel,
    valor_condominio: snapshot.valor_condominio,
    iptu: snapshot.iptu,
    taxa_de_servico: snapshot.taxa_de_servico,
    valor_itr: snapshot.valor_itr,
    seguro_incendio: snapshot.seguro_incendio,
    quartos: snapshot.quartos,
    suites: snapshot.suites,
    banheiros: snapshot.banheiros,
    vagas: snapshot.vagas,
    area_total: snapshot.area_total,
    area_construida: snapshot.area_construida,
    andar: snapshot.andar,
    public_address_visibility: visibility,
    bairro: visibility === "minimo" ? null : snapshot.bairro,
    cidade: snapshot.cidade,
    estado: snapshot.estado,
    pais: visibility === "completo" ? snapshot.pais : null,
    endereco: visibility === "completo" ? snapshot.endereco : null,
    numero: visibility === "completo" ? snapshot.numero : null,
    complemento: visibility === "completo" ? snapshot.complemento : null,
    cep: visibility === "completo" ? snapshot.cep : null,
    latitude: visibility === "completo" ? snapshot.latitude : null,
    longitude: visibility === "completo" ? snapshot.longitude : null,
    imagem_principal: photos[0] ?? null,
    fotos: photos,
    detalhes_extras: stringArray(snapshot.detalhes_extras),
    proximidades: stringArray(snapshot.proximidades),
    video_imovel: snapshot.video_imovel,
    tour_virtual: snapshot.tour_virtual,
    aceita_financiamento: snapshot.aceita_financiamento,
    aceita_permuta: snapshot.aceita_permuta,
    usou_fgts: snapshot.usou_fgts,
    exclusividade: snapshot.exclusividade,
    destaque: snapshot.destaque,
    status: snapshot.status,
    mobiliado: snapshot.mobiliado,
  };
}

/** Converts the Portuguese public-site projection to the legacy public API. */
export function projectPublicProperty(property: JsonRecord, snapshot: JsonRecord | null) {
  const source = snapshot ? safeSnapshotSource(snapshot) : legacyPublicSource(property);
  const visibility = normalizePublicAddressVisibility(source.public_address_visibility);
  const exactAddress = visibility === "completo";

  return {
    id: source.id ?? property.id,
    code: source.codigo,
    title: source.titulo,
    description: source.descricao,
    description_site: source.descricao,
    type: source.tipo_imovel,
    purpose: source.finalidade,
    finalidade: source.finalidade,
    status: source.status,
    featured: booleanValue(source.destaque),
    address: {
      visibility,
      street: exactAddress ? source.endereco : null,
      number: exactAddress ? source.numero : null,
      complement: exactAddress ? source.complemento : null,
      neighborhood: visibility === "minimo" ? null : source.bairro,
      city: source.cidade,
      state: source.estado,
      country: exactAddress ? source.pais : null,
      zipcode: exactAddress ? source.cep : null,
      latitude: exactAddress ? finiteNumber(source.latitude) : null,
      longitude: exactAddress ? finiteNumber(source.longitude) : null,
    },
    pricing: {
      sale_price: finiteNumber(source.valor_venda),
      rental_price: finiteNumber(source.valor_aluguel),
      condominium_fee: finiteNumber(source.valor_condominio),
      iptu: finiteNumber(source.iptu),
      insurance: finiteNumber(source.seguro_incendio),
      service_fee: finiteNumber(source.taxa_de_servico),
    },
    rooms: {
      bedrooms: finiteNumber(source.quartos),
      suites: finiteNumber(source.suites),
      bathrooms: finiteNumber(source.banheiros),
      parking: finiteNumber(source.vagas),
    },
    area: {
      useful: finiteNumber(source.area_construida),
      total: finiteNumber(source.area_total),
    },
    floor: finiteNumber(source.andar),
    furnished: source.mobiliado,
    main_image: source.imagem_principal,
    images: stringArray(source.fotos),
    video: source.video_imovel,
    virtual_tour: source.tour_virtual,
    extra_details: stringArray(source.detalhes_extras),
    nearby: stringArray(source.proximidades),
    created_at: property.created_at,
    updated_at: property.updated_at,
  };
}

function includesNormalized(value: unknown, expected: string | null | undefined) {
  if (!expected) return true;
  return text(value).toLocaleLowerCase("pt-BR").includes(
    expected.trim().toLocaleLowerCase("pt-BR"),
  );
}

function equalsNormalized(value: unknown, expected: string | null | undefined) {
  if (!expected) return true;
  return text(value).toLocaleLowerCase("pt-BR") ===
    expected.trim().toLocaleLowerCase("pt-BR");
}

function normalizePurpose(value: unknown) {
  const normalized = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (["venda", "sale"].includes(normalized)) return "sale";
  if (["locacao", "locacao anual", "aluguel", "rent", "rental"].includes(normalized)) return "rent";
  if (["temporada", "season", "seasonal"].includes(normalized)) return "seasonal";
  if (["rental catalog", "locacao e temporada", "aluguel e temporada"].includes(normalized)) {
    return "rental_catalog";
  }
  if (
    [
      "venda locacao", "venda e locacao", "venda aluguel", "venda e aluguel",
      "sale rent", "sale and rent",
    ].includes(normalized)
  ) return "sale_rent";
  return normalized;
}

function purposeMatches(value: unknown, expected: string | null | undefined) {
  if (!expected) return true;
  const actual = normalizePurpose(value);
  switch (normalizePurpose(expected)) {
    case "sale":
      return actual === "sale" || actual === "sale_rent";
    case "rent":
      return actual === "rent" || actual === "sale_rent";
    case "seasonal":
      return actual === "seasonal";
    case "rental_catalog":
      return actual === "rent" || actual === "seasonal" || actual === "sale_rent";
    default:
      return actual === normalizePurpose(expected);
  }
}

function pricesForFilter(
  projection: ReturnType<typeof projectPublicProperty>,
  purpose: string | null | undefined,
) {
  const filterPurpose = normalizePurpose(purpose);
  const propertyPurpose = normalizePurpose(projection.purpose);
  if (filterPurpose === "sale") return [projection.pricing.sale_price];
  if (["rent", "seasonal", "rental_catalog"].includes(filterPurpose)) {
    return [projection.pricing.rental_price];
  }
  if (filterPurpose === "sale_rent") {
    return [projection.pricing.sale_price, projection.pricing.rental_price];
  }
  if (propertyPurpose === "sale") return [projection.pricing.sale_price];
  if (["rent", "seasonal"].includes(propertyPurpose)) return [projection.pricing.rental_price];
  return [projection.pricing.sale_price, projection.pricing.rental_price];
}

export function publicPropertyMatchesFilters(
  projection: ReturnType<typeof projectPublicProperty>,
  filters: PublicPropertyFilters,
) {
  if (!includesNormalized(projection.address.city, filters.city)) return false;
  if (!includesNormalized(projection.address.neighborhood, filters.neighborhood)) return false;
  if (!equalsNormalized(projection.type, filters.type)) return false;
  if (!purposeMatches(projection.purpose, filters.purpose)) return false;

  if (
    filters.bedrooms !== null && filters.bedrooms !== undefined &&
    (projection.rooms.bedrooms ?? 0) < filters.bedrooms
  ) return false;
  const hasPriceFilter = filters.minPrice !== null && filters.minPrice !== undefined ||
    filters.maxPrice !== null && filters.maxPrice !== undefined;
  if (hasPriceFilter) {
    const matchesPrice = pricesForFilter(projection, filters.purpose).some((price) =>
      price !== null &&
      (filters.minPrice === null || filters.minPrice === undefined || price >= filters.minPrice) &&
      (filters.maxPrice === null || filters.maxPrice === undefined || price <= filters.maxPrice)
    );
    if (!matchesPrice) return false;
  }

  return true;
}
