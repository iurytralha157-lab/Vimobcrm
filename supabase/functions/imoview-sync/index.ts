import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import { loadCanonicalPropertyLocationResolver } from "../_shared/property-import-location.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const imoviewBaseUrl = "https://api.imoview.com.br";
const listEndpoint = `${imoviewBaseUrl}/Imovel/RetornarImoveisDisponiveis`;
const requestTimeoutMs = 20_000;
const detailTimeoutMs = 8_000;
const maxRuntimeMs = 140_000;
const detailConcurrency = 6;
const propertyPhotoLimit = 20;
const syncLeaseMs = 5 * 60 * 1_000;
const propertyMediaCapacityError = "property_media_capacity_exhausted_append_only";

type JsonRecord = Record<string, unknown>;
type IntegrationRecord = {
  api_key?: unknown;
  is_active?: unknown;
  status?: unknown;
  updated_at?: unknown;
};

function jsonResponse(body: JsonRecord, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = requestTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, redirect: "error", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Imoview request timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseBody(req: Request): Promise<JsonRecord | null> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : null;
  } catch {
    return null;
  }
}

async function authorizeRequest(
  req: Request,
  supabase: SupabaseClient,
  serviceRoleKey: string,
  organizationId: string,
): Promise<Response | null> {
  const authorization = req.headers.get("Authorization")?.trim() ?? "";
  if (authorization && await constantTimeEqual(authorization, `Bearer ${serviceRoleKey}`)) {
    return null;
  }

  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return jsonResponse({ error: "authentication_required" }, 401);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return jsonResponse({ error: "invalid_session" }, 401);

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Imoview user profile lookup failed:", profileError);
    return jsonResponse({ error: "authorization_failed" }, 500);
  }
  if (!profile || profile.is_active === false) {
    return jsonResponse({ error: "active_user_required" }, 403);
  }
  if (profile.role === "super_admin") return null;

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", authData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (membershipError) {
    console.error("Imoview membership lookup failed:", membershipError);
    return jsonResponse({ error: "authorization_failed" }, 500);
  }
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return jsonResponse({ error: "organization_admin_required" }, 403);
  }
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function firstValue(record: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function asText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeStatusToken(value: unknown): string {
  return asText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeImportedPropertyStatus(value: unknown, availableByEndpoint: boolean): string {
  const status = normalizeStatusToken(value);
  if (!status) return availableByEndpoint ? "ativo" : "inativo";
  if (status.includes("vendid") || status === "sold") return "vendido";
  if (
    status.includes("locad") ||
    status.includes("alugad") ||
    status === "rented" ||
    status === "leased"
  ) return "alugado";
  if (status.includes("reserv") || status === "reserved") return "reservado";
  if (status.includes("arquiv") || status === "archived") return "arquivado";
  if (status.includes("rascunh") || status === "draft") return "rascunho";
  if (
    status.includes("inativ") ||
    status.includes("suspend") ||
    status.includes("indispon") ||
    status.includes("bloque") ||
    status.includes("desativ") ||
    status.includes("nao ativo")
  ) return "inativo";
  if (
    status === "ativo" ||
    status === "active" ||
    status === "available" ||
    status === "disponivel" ||
    status === "vago" ||
    status === "true"
  ) return "ativo";
  return "inativo";
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = asText(value).replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") && raw.includes(".")
    ? raw.lastIndexOf(",") > raw.lastIndexOf(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "")
    : raw.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const parsed = Number.parseInt(asText(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function addPhoto(value: unknown, photos: string[], seen: Set<string>) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (
    photos.length >= propertyPhotoLimit ||
    !/^https:\/\//i.test(trimmed) ||
    seen.has(trimmed)
  ) return;
  seen.add(trimmed);
  photos.push(trimmed);
}

function normalizeImportedPhotos(mainImage: unknown, candidates: unknown[]) {
  const photos: string[] = [];
  const seen = new Set<string>();
  addPhoto(mainImage, photos, seen);
  for (const candidate of candidates) addPhoto(candidate, photos, seen);
  return photos;
}

async function reconcileCanonicalPropertyPhotos(
  supabase: SupabaseClient,
  organizationId: string,
  propertyId: string,
  photos: string[],
  galleryComplete: boolean,
): Promise<string | null> {
  const { error } = await supabase.rpc("reconcile_imported_property_photos", {
    p_organization_id: organizationId,
    p_property_id: propertyId,
    p_provider: "imoview",
    p_photo_urls: photos,
    p_primary_url: photos[0] ?? null,
    p_gallery_complete: galleryComplete,
  });
  if (error) {
    console.error("Imoview canonical photo reconciliation failed:", error.code ?? "rpc_failed");
    return error.code === "23514" && error.message.includes(propertyMediaCapacityError)
      ? propertyMediaCapacityError
      : "property_media_reconciliation_failed";
  }
  return null;
}

function extractPhotos(value: unknown): string[] {
  const photos: string[] = [];
  const seen = new Set<string>();
  const urlKey = /^(url|urlfoto|foto|src|link|original|grande|media|urlarquivo|caminho|urlimagem)$/i;
  const collectionKey = /(foto|imagem|galeria|photo|image|midia|arquivo)/i;

  const visit = (current: unknown, depth: number, eligible: boolean) => {
    if (depth > 4 || current === null || current === undefined) return;
    if (typeof current === "string") {
      if (eligible) addPhoto(current, photos, seen);
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current.slice(0, 200)) visit(item, depth + 1, eligible);
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      const childEligible = eligible || urlKey.test(key) || collectionKey.test(key);
      visit(child, depth + 1, childEligible);
    }
  };
  visit(value, 0, false);
  return photos;
}

function extractExplicitPhotoGallery(record: JsonRecord): {
  photos: string[];
  galleryComplete: boolean;
} {
  const collectionKeys = [
    "fotos", "Fotos", "galeria", "Galeria", "fotosImovel", "FotosImovel",
    "imagens", "Imagens",
  ];
  const collectionKey = collectionKeys.find((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  );
  if (!collectionKey) {
    return { photos: extractPhotos(record), galleryComplete: false };
  }

  const collection = record[collectionKey];
  if (!Array.isArray(collection) || collection.length > propertyPhotoLimit) {
    return { photos: extractPhotos(record), galleryComplete: false };
  }

  const photos: string[] = [];
  const seen = new Set<string>();
  let validEntries = 0;
  for (const entry of collection) {
    const entryRecord = asRecord(entry);
    const candidate = typeof entry === "string"
      ? entry
      : entryRecord
        ? firstValue(entryRecord, [
          "url", "Url", "URL", "urlFoto", "UrlFoto", "foto", "Foto",
          "original", "Original", "grande", "Grande", "src", "Src",
        ])
        : null;
    const before = photos.length;
    addPhoto(candidate, photos, seen);
    if (photos.length === before + 1) validEntries += 1;
  }
  return {
    photos,
    galleryComplete: validEntries === collection.length && photos.length === collection.length,
  };
}

function extractMainImage(record: JsonRecord): string {
  const value = firstValue(record, [
    "fotoPrincipal", "FotoPrincipal", "imagemPrincipal", "ImagemPrincipal",
    "foto_principal", "imagem_principal", "mainImage", "MainImage",
    "thumbnail", "Thumbnail", "capa", "Capa", "urlFotoPrincipal", "UrlFotoPrincipal",
  ]);
  return typeof value === "string" && /^https:\/\//i.test(value.trim()) ? value.trim() : "";
}

function extractItems(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((item): item is JsonRecord => !!item);
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["lista", "Lista", "imoveis", "Imoveis", "data", "Data"]) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).map(asRecord).filter((item): item is JsonRecord => !!item);
    }
  }
  return Object.values(record).map(asRecord).filter((item): item is JsonRecord => {
    if (!item) return false;
    return !!firstValue(item, ["codigo", "codigoImovel", "Codigo", "CodigoImovel"]);
  });
}

async function parallelMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function fetchDetails(
  apiKey: string,
  code: string,
): Promise<{ record: JsonRecord | null; photos: string[]; galleryComplete: boolean }> {
  try {
    const endpoint = `${imoviewBaseUrl}/Imovel/RetornarDetalhesImovelDisponivel?codigoImovel=${encodeURIComponent(code)}`;
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", chave: apiKey },
    }, detailTimeoutMs);
    if (!response.ok) {
      await response.text();
      return { record: null, photos: [], galleryComplete: false };
    }
    const record = asRecord(await response.json());
    const returnedCode = record
      ? asText(firstValue(record, ["codigo", "codigoImovel", "Codigo", "CodigoImovel", "referencia"]))
      : "";
    if (!record || !returnedCode || returnedCode !== code) {
      return { record: null, photos: [], galleryComplete: false };
    }
    const gallery = extractExplicitPhotoGallery(record);
    const mainImage = extractMainImage(record);
    return {
      record,
      photos: gallery.photos,
      galleryComplete: gallery.galleryComplete && (!mainImage || gallery.photos.includes(mainImage)),
    };
  } catch {
    return { record: null, photos: [], galleryComplete: false };
  }
}

async function testConnection(apiKey: string) {
  const response = await fetchWithTimeout(listEndpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", chave: apiKey },
    body: JSON.stringify({ numeroPagina: 1, numeroRegistros: 1 }),
  });
  if (!response.ok) {
    await response.text();
    return { success: false, error: `API returned ${response.status}` };
  }
  await response.text();
  return { success: true, message: "Conexão válida" };
}

async function loadIntegration(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ data: IntegrationRecord | null; error: unknown }> {
  const serviceResult = await supabase
    .from("imoview_integrations_service")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!serviceResult.error && serviceResult.data) {
    return { data: serviceResult.data as IntegrationRecord, error: null };
  }
  const legacyResult = await supabase
    .from("imoview_integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    data: legacyResult.data as IntegrationRecord | null,
    error: legacyResult.error ?? serviceResult.error,
  };
}

async function claimSyncLease(
  supabase: SupabaseClient,
  organizationId: string,
  integration: IntegrationRecord,
): Promise<{ token: string | null; error: string | null }> {
  const currentStatus = asText(integration.status) || "connected";
  const currentUpdatedAt = asText(integration.updated_at);
  if (currentStatus === "syncing") {
    const updatedAtMs = Date.parse(currentUpdatedAt);
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs < syncLeaseMs) {
      return { token: null, error: "sync_already_running" };
    }
  }

  let claim = supabase
    .from("imoview_integrations")
    .update({
      status: "syncing",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("status", currentStatus);
  claim = currentUpdatedAt
    ? claim.eq("updated_at", currentUpdatedAt)
    : claim.is("updated_at", null);
  const { data, error } = await claim.select("updated_at").maybeSingle();
  if (error) return { token: null, error: "sync_lease_claim_failed" };
  const token = asText(data?.updated_at);
  return token
    ? { token, error: null }
    : { token: null, error: "sync_lease_changed" };
}

async function recordSyncResult(
  supabase: SupabaseClient,
  organizationId: string,
  synced: number,
  skipped: number,
  deactivated: number,
  errors: string[],
  runToken: string,
): Promise<boolean> {
  const completedAt = new Date().toISOString();
  const common = {
    last_sync_at: completedAt,
    total_synced: synced,
    sync_log: { last_run: completedAt, synced, skipped, deactivated, errors: errors.slice(0, 20) },
    updated_at: completedAt,
  };
  const { data: extendedRows, error: extendedError } = await supabase
    .from("imoview_integrations")
    .update({
      ...common,
      status: errors.length === 0 ? "connected" : "error",
      last_error: errors.length === 0 ? null : errors[0].slice(0, 2_000),
    })
    .eq("organization_id", organizationId)
    .eq("status", "syncing")
    .eq("updated_at", runToken)
    .select("id");
  if (!extendedError) return extendedRows?.length === 1;

  const { data: fallbackRows, error: fallbackError } = await supabase
    .from("imoview_integrations")
    .update({
      ...common,
      status: errors.length === 0 ? "connected" : "error",
    })
    .eq("organization_id", organizationId)
    .eq("status", "syncing")
    .eq("updated_at", runToken)
    .select("id");
  if (fallbackError) console.error("Imoview sync status update failed:", fallbackError);
  return !fallbackError && fallbackRows?.length === 1;
}

async function persistImoviewProperty(
  supabase: SupabaseClient,
  organizationId: string,
  sourceCode: string,
  propertyData: Record<string, unknown>,
): Promise<{ id: string | null; error: string | null }> {
  const loadExisting = () => supabase
    .from("properties")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("imoview_codigo", sourceCode)
    .maybeSingle();

  const updateExisting = async (propertyId: string) => {
    const { data, error } = await supabase
      .from("properties")
      .update(propertyData)
      .eq("organization_id", organizationId)
      .eq("id", propertyId)
      .eq("imoview_codigo", sourceCode)
      .select("id")
      .maybeSingle();
    return error || !data?.id
      ? { id: null, error: "property_update_failed" }
      : { id: data.id as string, error: null };
  };

  const { data: existing, error: lookupError } = await loadExisting();
  if (lookupError) return { id: null, error: "property_lookup_failed" };
  if (typeof existing?.id === "string") return updateExisting(existing.id);

  const { data: inserted, error: insertError } = await supabase
    .from("properties")
    .insert([propertyData])
    .select("id")
    .maybeSingle();
  if (!insertError && typeof inserted?.id === "string") {
    return { id: inserted.id, error: null };
  }
  if (insertError?.code !== "23505") {
    return { id: null, error: "property_insert_failed" };
  }

  // The provider key is protected by a partial unique index rather than a
  // named constraint, so PostgREST upsert conflict inference is not reliable.
  // A concurrent insert is resolved by re-reading the tenant/provider key and
  // applying the same scoped update deterministically.
  const { data: raced, error: rereadError } = await loadExisting();
  if (rereadError || typeof raced?.id !== "string") {
    return { id: null, error: "property_insert_conflict_unresolved" };
  }
  return updateExisting(raced.id);
}

async function syncProperties(
  supabase: SupabaseClient,
  apiKey: string,
  organizationId: string,
) {
  let page = 1;
  const perPage = 50;
  let totalSynced = 0;
  let totalSkipped = 0;
  // RetornarImoveisDisponiveis does not provide a locally verified total or
  // continuation cursor. Missing rows are therefore never deactivated.
  const totalDeactivated = 0;
  const errors: string[] = [];
  const startedAt = Date.now();
  let locationResolver: Awaited<ReturnType<typeof loadCanonicalPropertyLocationResolver>> | null = null;

  while (Date.now() - startedAt < maxRuntimeMs) {
    let response: Response;
    try {
      response = await fetchWithTimeout(listEndpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", chave: apiKey },
        body: JSON.stringify({ numeroPagina: page, numeroRegistros: perPage }),
      });
    } catch (error) {
      errors.push(`Fetch error page ${page}: ${(error as Error).message}`);
      break;
    }
    if (!response.ok) {
      await response.text();
      errors.push(`API error page ${page}: ${response.status}`);
      break;
    }

    let items: JsonRecord[];
    try {
      items = extractItems(await response.json());
    } catch {
      errors.push(`Invalid JSON on page ${page}`);
      break;
    }
    if (items.length === 0) {
      break;
    }

    const details = await parallelMap(items, async (item) => {
      const code = asText(firstValue(item, ["codigo", "codigoImovel", "Codigo", "CodigoImovel", "referencia"]));
      return code
        ? await fetchDetails(apiKey, code)
        : { record: null, photos: [], galleryComplete: false };
    }, detailConcurrency);

    if (!locationResolver) {
      try {
        locationResolver = await loadCanonicalPropertyLocationResolver(
          supabase,
          organizationId,
        );
      } catch {
        errors.push(`Location catalog load failed on page ${page}`);
        break;
      }
    }

    for (let index = 0; index < items.length; index += 1) {
      if (Date.now() - startedAt >= maxRuntimeMs) {
        break;
      }
      const item = items[index];
      const detailResult = details[index];
      const detail = detailResult.record;
      const code = asText(firstValue(item, ["codigo", "codigoImovel", "Codigo", "CodigoImovel", "referencia"]));
      if (!code) {
        totalSkipped += 1;
        continue;
      }
      try {
        const listingPhotos = extractPhotos(item);
        let photoCandidates = detailResult.photos;
        if (!detailResult.galleryComplete && listingPhotos.length > photoCandidates.length) {
          photoCandidates = listingPhotos;
        }
        const photos = normalizeImportedPhotos(
          (detail && extractMainImage(detail)) || extractMainImage(item),
          photoCandidates,
        );
        const finalidade = asText(firstValue(item, ["finalidade", "destinacao"])).toLowerCase();
        const hasSale = finalidade.includes("venda");
        const hasRent = finalidade.includes("locac") || finalidade.includes("alugu");
        const businessType = hasSale && hasRent ? "venda_locacao" : hasRent ? "locacao" : "venda";
        const salePrice = parseNumber(firstValue(item, ["valorVenda", "valor_venda", "valor"]));
        const rentPrice = parseNumber(firstValue(item, ["valorAluguel", "valor_aluguel"]));
        const price = businessType === "locacao" ? rentPrice ?? salePrice : salePrice ?? rentPrice;
        const propertyType = asText(firstValue(item, ["tipoImovel", "tipo"])) || "Outro";
        const publicDescription = firstValue(item, ["descricao", "observacao"]);
        const sourceStatus = firstValue(detail ?? {}, [
          "status", "Status", "situacao", "Situacao", "statusImovel", "situacaoImovel", "disponivel",
        ]) ?? firstValue(item, [
          "status", "Status", "situacao", "Situacao", "statusImovel", "situacaoImovel", "disponivel",
        ]);
        const sourceCity = item.cidade ?? null;
        const sourceState = firstValue(item, ["uf", "estado"]);
        const sourceNeighborhood = item.bairro ?? null;
        const canonicalLocation = locationResolver.resolve({
          city: sourceCity,
          state: sourceState,
          neighborhood: sourceNeighborhood,
        });

        const propertyData = {
          organization_id: organizationId,
          imoview_codigo: code,
          title: asText(firstValue(item, ["titulo", "tituloSite", "tipoImovel"])) || `Imóvel ${code}`,
          tipo: propertyType,
          tipo_de_imovel: propertyType,
          finalidade: businessType,
          tipo_de_negocio: businessType,
          // RetornarImoveisDisponiveis is an availability endpoint, so a
          // missing status is active. An explicit unknown/terminal status is
          // never promoted to active.
          status: normalizeImportedPropertyStatus(sourceStatus, true),
          endereco: firstValue(item, ["endereco", "logradouro"]),
          numero: asText(item.numero) || null,
          complemento: item.complemento ?? null,
          bairro: sourceNeighborhood,
          cidade: sourceCity,
          uf: sourceState,
          ...canonicalLocation,
          cep: item.cep ?? null,
          quartos: parseInteger(firstValue(item, ["quartos", "dormitorios"])),
          suites: parseInteger(item.suites),
          banheiros: parseInteger(item.banheiros),
          vagas: parseInteger(firstValue(item, ["vagas", "garagem"])),
          area_util: parseNumber(firstValue(item, ["areaUtil", "area_util"])),
          area_total: parseNumber(firstValue(item, ["areaTotal", "area_total"])),
          preco: price,
          valor_locacao: rentPrice,
          condominio: parseNumber(item.condominio),
          iptu: parseNumber(item.iptu),
          descricao: publicDescription,
          descricao_site: publicDescription,
          latitude: parseNumber(item.latitude),
          longitude: parseNumber(item.longitude),
          exclusividade: asText(firstValue(item, ["exclusividade", "exclusivo"])).toLowerCase() === "sim",
        };

        // Media is deliberately excluded from the property write. The RPC
        // below reconciles canonical assets and compatibility columns under a
        // single property lock, so a failure preserves the previous gallery.
        const persistedProperty = await persistImoviewProperty(
          supabase,
          organizationId,
          code,
          propertyData,
        );
        if (!persistedProperty.id) {
          errors.push(`Property write error for ${code}: ${persistedProperty.error ?? "unknown"}`);
        } else {
          const mediaError = await reconcileCanonicalPropertyPhotos(
            supabase,
            organizationId,
            persistedProperty.id,
            photos,
            detailResult.galleryComplete,
          );
          if (mediaError) {
            errors.push(`Media reconciliation error for ${code}: ${mediaError}`);
          } else {
            totalSynced += 1;
          }
        }
      } catch (error) {
        errors.push(`Process error ${code}: ${(error as Error).message}`);
      }
    }

    if (items.length < perPage) {
      break;
    }
    page += 1;
  }

  if (Date.now() - startedAt >= maxRuntimeMs) {
    errors.push(`Runtime limit reached after page ${page}`);
  }
  return { totalSynced, totalSkipped, totalDeactivated, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const body = await parseBody(req);
  if (!body) return jsonResponse({ error: "invalid_json_body" }, 400);
  const action = typeof body.action === "string" ? body.action : "";
  const organizationId = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
  if (!organizationId) return jsonResponse({ error: "organization_id_required" }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    return jsonResponse({ error: "invalid_organization_id" }, 400);
  }
  if (action !== "test" && action !== "sync") return jsonResponse({ error: "invalid_action" }, 400);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const unauthorized = await authorizeRequest(req, supabase, serviceRoleKey, organizationId);
    if (unauthorized) return unauthorized;

    const { data: integration, error } = await loadIntegration(supabase, organizationId);
    if (error || !integration) return jsonResponse({ error: "integration_not_configured" }, 404);
    const apiKey = typeof integration.api_key === "string" ? integration.api_key.trim() : "";
    if (!apiKey) return jsonResponse({ error: "invalid_imoview_api_key" }, 422);
    if (integration.is_active === false || integration.status === "disabled") {
      return jsonResponse({ error: "integration_disabled" }, 409);
    }

    if (action === "test") {
      try {
        return jsonResponse(await testConnection(apiKey), 200);
      } catch (error) {
        return jsonResponse({ success: false, error: (error as Error).message }, 200);
      }
    }

    const lease = await claimSyncLease(supabase, organizationId, integration);
    if (!lease.token) {
      return jsonResponse(
        { error: lease.error ?? "sync_lease_claim_failed" },
        lease.error === "sync_lease_claim_failed" ? 500 : 409,
      );
    }

    const { totalSynced, totalSkipped, totalDeactivated, errors } = await syncProperties(
      supabase,
      apiKey,
      organizationId,
    );
    if (!(await recordSyncResult(
      supabase,
      organizationId,
      totalSynced,
      totalSkipped,
      totalDeactivated,
      errors,
      lease.token,
    ))) {
      return jsonResponse({ error: "sync_status_update_failed" }, 500);
    }
    return jsonResponse({
      success: errors.length === 0,
      synced: totalSynced,
      skipped: totalSkipped,
      deactivated: totalDeactivated,
      errors: errors.slice(0, 10),
    }, 200);
  } catch (error) {
    console.error("Imoview sync fatal error:", (error as Error).message);
    return jsonResponse({ error: "imoview_sync_failed" }, 500);
  }
});
