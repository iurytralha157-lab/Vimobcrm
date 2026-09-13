import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";
import { loadCanonicalPropertyLocationResolver } from "../_shared/property-import-location.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const externalRequestTimeoutMs = 20_000;
const photoRequestTimeoutMs = 8_000;
const propertyPhotoLimit = 20;
const propertyCodeClaimAttempts = 64;
const syncLeaseMs = 5 * 60 * 1_000;
const propertyMediaCapacityError = "property_media_capacity_exhausted_append_only";
const vistaManagedHost = "vistahost.com.br";
// Server-side only: comma-separated exact hosts or explicit `*.example.com`
// suffixes. Full DNS-to-socket pinning still belongs at the egress proxy; the
// Edge runtime fetch API does not expose the connected peer address.
const vistaAdditionalHostsEnv = "VISTA_ALLOWED_API_HOSTS";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVistaProperty(value: unknown): value is UnknownRecord {
  return isRecord(value) && Boolean(value.Codigo);
}

function normalizeStatusToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeImportedPropertyStatus(value: unknown): string {
  const status = normalizeStatusToken(value);
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
    status === "vago"
  ) return "ativo";
  return "inativo";
}

function jsonResponse(body: Record<string, unknown>, status: number) {
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
  timeoutMs = externalRequestTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, redirect: "error", signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new Error(`Vista request timed out after ${timeoutMs} ms`);
    }
    // The Vista API key is carried in the query string. Do not persist or
    // return a runtime fetch error that may echo the full credentialed URL.
    throw new Error("Vista request failed");
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseIPv6(raw: string): number[] | null {
  const address = raw.split("%")[0].toLowerCase();
  if (address.split("::").length > 2) return null;
  const [headRaw, tailRaw] = address.includes("::") ? address.split("::") : [address, ""];
  const parseParts = (value: string): number[] | null => {
    if (!value) return [];
    const output: number[] = [];
    for (const part of value.split(":")) {
      if (part.includes(".")) {
        const bytes = part.split(".").map(Number);
        if (bytes.length !== 4 || bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
          return null;
        }
        output.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        output.push(Number.parseInt(part, 16));
      }
    }
    return output;
  };
  const head = parseParts(headRaw);
  const tail = parseParts(tailRaw);
  if (!head || !tail) return null;
  if (!address.includes("::")) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

function isPrivateIP(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes(":")) {
    const hextets = parseIPv6(normalized);
    if (!hextets) return true;
    const allZero = hextets.every((value) => value === 0);
    const loopback = hextets.slice(0, 7).every((value) => value === 0) && hextets[7] === 1;
    const mapped = hextets.slice(0, 5).every((value) => value === 0) && hextets[5] === 0xffff;
    if (mapped) {
      const high = hextets[6];
      const low = hextets[7];
      return isPrivateIP(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return allZero || loopback ||
      (hextets[0] & 0xfe00) === 0xfc00 ||
      (hextets[0] & 0xff00) === 0xfe00 ||
      (hextets[0] & 0xff00) === 0xff00 ||
      (hextets[0] === 0x2001 && hextets[1] === 0x0db8) ||
      (hextets[0] === 0x0064 && hextets[1] === 0xff9b) ||
      (hextets[0] === 0x0100 && hextets[1] === 0);
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 192 && (parts[1] === 168 || parts[1] === 0 || parts[1] === 2)) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51 && parts[2] === 100)) ||
    (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) ||
    parts[0] >= 224;
}

function isValidPublicHostname(value: string): boolean {
  return value.length <= 253 &&
    value.includes(".") &&
    !value.includes(":") &&
    !/^\d+(?:\.\d+){3}$/.test(value) &&
    value.split(".").every((label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
}

function configuredVistaHostRules(): string[] {
  return (Deno.env.get(vistaAdditionalHostsEnv) ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/\.$/, ""))
    .filter((entry) => {
      const hostname = entry.startsWith("*.") ? entry.slice(2) : entry;
      if (entry.includes("*") && !(entry.startsWith("*.") && !hostname.includes("*"))) {
        return false;
      }
      return isValidPublicHostname(hostname);
    });
}

function isAllowedVistaApiHost(host: string): boolean {
  if (host === vistaManagedHost || host.endsWith(`.${vistaManagedHost}`)) return true;
  return configuredVistaHostRules().some((rule) => {
    if (!rule.startsWith("*.")) return host === rule;
    const suffix = rule.slice(2);
    return host.endsWith(`.${suffix}`);
  });
}

async function normalizeVistaApiUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error("invalid_vista_api_url");
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    throw new Error("invalid_vista_api_url");
  }

  const host = target.hostname.toLowerCase();
  if (target.username || target.password || !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("unsafe_vista_api_url");
  }
  if (!isAllowedVistaApiHost(host)) {
    throw new Error("unapproved_vista_api_host");
  }
  if (target.protocol === "http:" && (host === "vistahost.com.br" || host.endsWith(".vistahost.com.br"))) {
    target.protocol = "https:";
  }
  if (target.protocol !== "https:" || target.port && target.port !== "443") {
    throw new Error("unsafe_vista_api_url");
  }
  if ((/^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) && isPrivateIP(host)) {
    throw new Error("unsafe_vista_api_target");
  }

  const addresses = new Set<string>();
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      for (const address of await Deno.resolveDns(host, recordType)) addresses.add(address);
    } catch {
      // A valid host can legitimately have only one address family.
    }
  }
  if (addresses.size === 0 || [...addresses].some(isPrivateIP)) {
    throw new Error("unsafe_vista_api_target");
  }

  target.search = "";
  target.hash = "";
  return target.toString().replace(/\/+$/, "");
}

async function authorizeVistaRequest(
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
  if (authError || !authData.user) {
    return jsonResponse({ error: "invalid_session" }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Vista user profile lookup failed:", profileError);
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
    console.error("Vista membership lookup failed:", membershipError);
    return jsonResponse({ error: "authorization_failed" }, 500);
  }
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return jsonResponse({ error: "organization_admin_required" }, 403);
  }
  return null;
}

function getCategoryPrefix(categoria: string): string {
  const cat = (categoria || "").toLowerCase();
  if (cat.includes("casa") || cat.includes("sobrado")) return "CA";
  if (cat.includes("cobertura")) return "CB";
  if (cat.includes("comercial") || cat.includes("sala") || cat.includes("loja") || cat.includes("galpao") || cat.includes("galpão")) return "CO";
  if (cat.includes("terreno") || cat.includes("lote")) return "TE";
  return "AP";
}

async function generateCode(supabase: SupabaseClient, organizationId: string, prefix: string): Promise<string> {
  const normalizedPrefix = prefix.trim().toUpperCase();

  for (let attempt = 0; attempt < propertyCodeClaimAttempts; attempt += 1) {
    const { data: sequence, error: sequenceError } = await supabase
      .from("property_sequences")
      .select("id, prefix, last_number")
      .eq("organization_id", organizationId)
      .ilike("prefix", normalizedPrefix)
      .maybeSingle();
    if (sequenceError) throw sequenceError;

    if (!sequence) {
      const { error: insertError } = await supabase
        .from("property_sequences")
        .insert({
          organization_id: organizationId,
          prefix: normalizedPrefix,
          last_number: 0,
        });
      if (insertError && insertError.code !== "23505") throw insertError;
      continue;
    }

    const currentNumber = Number(sequence.last_number) || 0;
    const nextNumber = currentNumber + 1;
    let claim = supabase
      .from("property_sequences")
      .update({ last_number: nextNumber })
      .eq("id", sequence.id)
      .eq("organization_id", organizationId)
      .eq("prefix", sequence.prefix);
    claim = sequence.last_number === null
      ? claim.is("last_number", null)
      : claim.eq("last_number", sequence.last_number);
    const { data: claimed, error: claimError } = await claim
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    const code = `${normalizedPrefix}${String(nextNumber).padStart(4, "0")}`;
    const { data: existing, error: existingError } = await supabase
      .from("properties")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("code", code)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return code;
  }

  throw new Error("property_code_generation_conflict");
}

async function testConnection(apiUrl: string, apiKey: string) {
  const pesquisa = {
    fields: ["Codigo"],
    paginacao: { pagina: 1, quantidade: 1 },
  };
  const searchParams = new URLSearchParams();
  searchParams.append("key", apiKey);
  searchParams.append("pesquisa", JSON.stringify(pesquisa));

  const res = await fetchWithTimeout(`${apiUrl}/imoveis/listar?${searchParams.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `API returned ${res.status}: ${text}` };
  }
  const data = await res.json();
  return { success: true, message: "Conexão válida", sample: data };
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").split("?")[0];
}

function parseMobilia(value: unknown): string | null {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (v === "sim" || v === "mobiliado" || v === "completo") return "Mobiliado";
  if (v.includes("semi") || v === "parcial" || v === "parcialmente") return "Semi-mobiliado";
  if (v === "nao" || v === "não" || v === "nenhum" || v === "sem") return "Sem mobília";
  return null;
}

function extractPhotosFromPayload(payload: unknown): {
  photos: string[];
  galleryComplete: boolean;
} {
  const seen = new Set<string>();
  const photos: string[] = [];
  const record = isRecord(payload) ? payload : {};

  const pushPhoto = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (photos.length >= propertyPhotoLimit || !/^https:\/\//i.test(trimmed)) return null;
    const key = normalizeUrl(trimmed);
    if (seen.has(key)) return key;
    seen.add(key);
    photos.push(trimmed);
    return key;
  };

  const featuredKey = pushPhoto(record.FotoDestaque) ?? pushPhoto(record.FotoDestaquePequena);
  const collectionKey = ["Foto", "fotos", "Fotos"].find((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  );
  if (!collectionKey) return { photos, galleryComplete: false };

  const fotosData = record[collectionKey];
  const collectionIsExplicit = Array.isArray(fotosData) && fotosData.length <= propertyPhotoLimit;
  const entries = Array.isArray(fotosData)
    ? fotosData.slice(0, propertyPhotoLimit)
    : isRecord(fotosData)
      ? Object.values(fotosData).slice(0, propertyPhotoLimit)
      : [];
  const entryKeys = new Set<string>();
  let validEntries = 0;

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const key = pushPhoto(entry.Foto) ?? pushPhoto(entry.FotoPequena);
    if (!key || entryKeys.has(key)) continue;
    entryKeys.add(key);
    validEntries += 1;
  }
  return {
    photos,
    galleryComplete: collectionIsExplicit &&
      validEntries === entries.length &&
      entryKeys.size === entries.length &&
      (!featuredKey || entryKeys.has(featuredKey)),
  };
}

function normalizeImportedPhotos(candidates: unknown[]) {
  const seen = new Set<string>();
  const photos: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    const key = normalizeUrl(trimmed);
    if (!/^https:\/\//i.test(trimmed) || seen.has(key)) continue;
    seen.add(key);
    photos.push(trimmed);
    if (photos.length >= propertyPhotoLimit) break;
  }
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
    p_provider: "vista",
    p_photo_urls: photos,
    p_primary_url: photos[0] ?? null,
    p_gallery_complete: galleryComplete,
  });
  if (error) {
    console.error("Vista canonical photo reconciliation failed:", error.code ?? "rpc_failed");
    return error.code === "23514" && error.message.includes(propertyMediaCapacityError)
      ? propertyMediaCapacityError
      : "property_media_reconciliation_failed";
  }
  return null;
}

async function claimSyncLease(
  supabase: SupabaseClient,
  organizationId: string,
  integration: UnknownRecord,
): Promise<{ token: string | null; error: string | null }> {
  const currentStatus = String(integration.status ?? "").trim() || "connected";
  const currentUpdatedAt = String(integration.updated_at ?? "").trim();
  if (currentStatus === "syncing") {
    const updatedAtMs = Date.parse(currentUpdatedAt);
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs < syncLeaseMs) {
      return { token: null, error: "sync_already_running" };
    }
  }

  let claim = supabase
    .from("vista_integrations")
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
  const token = String(data?.updated_at ?? "").trim();
  return token
    ? { token, error: null }
    : { token: null, error: "sync_lease_changed" };
}

async function fetchPropertyPhotos(
  apiUrl: string,
  apiKey: string,
  codigo: string,
  fallbackMainImage?: string | null,
): Promise<{ photos: string[]; galleryComplete: boolean }> {
  const fallbackPhotos = typeof fallbackMainImage === "string" && fallbackMainImage.startsWith("http")
    ? [fallbackMainImage]
    : [];

  try {
    const pesquisa = {
      fields: [
        "Codigo", "FotoDestaque",
        { Foto: ["Foto", "FotoPequena", "Destaque", "Tipo", "Descricao"] },
      ],
    };
    const searchParams = new URLSearchParams();
    searchParams.append("key", apiKey);
    searchParams.append("pesquisa", JSON.stringify(pesquisa));
    searchParams.append("imovel", codigo);

    const res = await fetchWithTimeout(`${apiUrl}/imoveis/detalhes?${searchParams.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    }, photoRequestTimeoutMs);

    if (!res.ok) {
      await res.text();
      return { photos: fallbackPhotos, galleryComplete: false };
    }

    const data = await res.json();
    const payload = Array.isArray(data) ? data[0] : data;
    if (!isRecord(payload)) {
      return { photos: fallbackPhotos, galleryComplete: false };
    }
    const returnedCode = String(payload.Codigo ?? payload.codigo ?? "").trim();
    if (!returnedCode || returnedCode !== codigo) {
      return { photos: fallbackPhotos, galleryComplete: false };
    }
    const gallery = extractPhotosFromPayload(payload);
    return {
      photos: gallery.photos.length > 0 ? gallery.photos : fallbackPhotos,
      galleryComplete: gallery.galleryComplete,
    };
  } catch {
    return { photos: fallbackPhotos, galleryComplete: false };
  }
}

// Parallel execution with concurrency limit
async function parallelMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function syncProperties(
  supabase: SupabaseClient,
  apiUrl: string,
  apiKey: string,
  organizationId: string,
  importInactive: boolean,
) {
  const fields = [
    "Codigo", "Categoria", "Status", "Finalidade",
    "ValorVenda", "ValorLocacao", "Dormitorios", "Suites",
    "BanheiroSocialQtd", "Vagas", "AreaPrivativa", "AreaTotal",
    "Endereco", "Numero", "Complemento", "Bairro", "Cidade", "UF", "CEP",
    "DescricaoWeb", "FotoDestaque",
    "Latitude", "Longitude",
    "ValorCondominio", "ValorIptu", "AnoConstrucao", "TituloSite",
    "Mobiliado", "AceitaPermuta",
  ];

  let page = 1;
  const perPage = 50;
  let totalSynced = 0;
  let totalSkipped = 0;
  // Vista's current response contract has no locally verified authoritative
  // total/cursor. Missing rows are therefore never inferred as inactive.
  const totalDeactivated = 0;
  let hasMore = true;
  const errors: string[] = [];
  const startTime = Date.now();
  const MAX_RUNTIME_MS = 140_000; // 140s safety margin (Supabase Pro = 150s)
  let locationResolver: Awaited<ReturnType<typeof loadCanonicalPropertyLocationResolver>> | null = null;

  while (hasMore) {
    // Time guard - stop before timeout
    if (Date.now() - startTime > MAX_RUNTIME_MS) {
      console.log(`Time limit reached at page ${page}. Synced ${totalSynced} so far.`);
      errors.push(`Timeout: processou até página ${page - 1}. Sincronize novamente para continuar.`);
      break;
    }

    const pesquisa = {
      fields,
      paginacao: { pagina: page, quantidade: perPage },
    };

    const searchParams = new URLSearchParams();
    searchParams.append("key", apiKey);
    searchParams.append("pesquisa", JSON.stringify(pesquisa));
    searchParams.append("showtotal", "1");
    if (importInactive) {
      searchParams.append("showSuspended", "1");
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(`${apiUrl}/imoveis/listar?${searchParams.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch (e) {
      errors.push(`Fetch error page ${page}: ${(e as Error).message}`);
      break;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Vista API error page ${page}: ${res.status} - ${errText}`);
      errors.push(`API error page ${page}: ${res.status}`);
      break;
    }

    const data: unknown = await res.json();
    const items = isRecord(data) ? Object.values(data).filter(isVistaProperty) : [];

    console.log(`Page ${page}: ${items.length} items found`);

    if (items.length === 0) {
      hasMore = false;
      break;
    }

    // Check existing properties in batch
    const codigos = items.map((item) => String(item.Codigo));
    const { data: existingProps, error: existingPropsError } = await supabase
      .from("properties")
      .select("id, vista_codigo")
      .eq("organization_id", organizationId)
      .in("vista_codigo", codigos);
    if (existingPropsError) {
      errors.push(`Existing property lookup failed on page ${page}`);
      break;
    }

    const existingMap = new Map<string, string>();
    if (existingProps) {
      for (const p of existingProps) {
        existingMap.set(p.vista_codigo, p.id);
      }
    }

    // When inactive imports are disabled, terminal rows are still processed if
    // they were imported before. This preserves sold/rented/inactive state
    // transitions without creating a new inactive inventory.
    const importItems = items.filter((item) => {
      const codigo = String(item.Codigo);
      const status = normalizeImportedPropertyStatus(item.Status);
      if (!importInactive && status !== "ativo" && !existingMap.has(codigo)) {
        totalSkipped++;
        return false;
      }
      return true;
    });

    // Fetch photos in parallel (10 concurrent requests)
    const photosResults = await parallelMap(
      importItems,
      (item) => fetchPropertyPhotos(
        apiUrl,
        apiKey,
        String(item.Codigo),
        typeof item.FotoDestaque === "string" ? item.FotoDestaque : null,
      ),
      10
    );

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

    // Process items
    for (let i = 0; i < importItems.length; i++) {
      const item = importItems[i];
      try {
        const codigo = String(item.Codigo);
        const photoResult = photosResults[i];
        const allPhotos = normalizeImportedPhotos(photoResult.photos);
        const valorVenda = parseFloat(String(item.ValorVenda || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || null;
        const valorLocacao = parseFloat(String(item.ValorLocacao || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || null;

        let tipoNegocio = "venda";
        const finalidade = String(item.Finalidade || "").toLowerCase();
        const hasVenda = finalidade.includes("venda") || !!valorVenda;
        const hasLocacao = finalidade.includes("locac") || finalidade.includes("alugu") || !!valorLocacao;

        if (hasVenda && hasLocacao) {
          tipoNegocio = "venda_locacao";
        } else if (hasLocacao) {
          tipoNegocio = "locacao";
        }

        const preco = valorVenda || valorLocacao;
        const status = normalizeImportedPropertyStatus(item.Status);

        const categoria = String(item.Categoria || "Apartamento");
        const existingId = existingMap.get(codigo);
        const publicDescription = item.DescricaoWeb || null;
        const sourceCity = item.Cidade || null;
        const sourceState = item.UF || null;
        const sourceNeighborhood = item.Bairro || null;
        const canonicalLocation = locationResolver.resolve({
          city: sourceCity,
          state: sourceState,
          neighborhood: sourceNeighborhood,
        });

        const propertyData: Record<string, unknown> = {
          organization_id: organizationId,
          vista_codigo: codigo,
          title: item.TituloSite || item.Categoria || `Imóvel ${codigo}`,
          tipo: categoria,
          tipo_de_imovel: categoria,
          finalidade: tipoNegocio,
          tipo_de_negocio: tipoNegocio,
          status,
          endereco: item.Endereco || null,
          numero: item.Numero || null,
          complemento: item.Complemento || null,
          bairro: sourceNeighborhood,
          cidade: sourceCity,
          uf: sourceState,
          ...canonicalLocation,
          cep: item.CEP || null,
          quartos: parseInt(String(item.Dormitorios || "")) || null,
          suites: parseInt(String(item.Suites || "")) || null,
          banheiros: parseInt(String(item.BanheiroSocialQtd || "")) || null,
          vagas: parseInt(String(item.Vagas || "")) || null,
          area_util: parseFloat(String(item.AreaPrivativa || "")) || null,
          area_total: parseFloat(String(item.AreaTotal || "")) || null,
          preco,
          valor_locacao: valorLocacao,
          condominio: parseFloat(String(item.ValorCondominio || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || null,
          iptu: parseFloat(String(item.ValorIptu || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || null,
          ano_construcao: parseInt(String(item.AnoConstrucao || "")) || null,
          descricao: publicDescription,
          descricao_site: publicDescription,
          latitude: parseFloat(String(item.Latitude || "")) || null,
          longitude: parseFloat(String(item.Longitude || "")) || null,
          mobilia: parseMobilia(item.Mobiliado),
          seguro_incendio: null,
          exclusividade: String(item.Exclusividade || item.ExclusividadeVenda || "").toLowerCase() === "sim" ? true : false,
        };

        let persistedPropertyId: string | null = null;
        let upsertError: { message: string } | null = null;
        if (existingId) {
          const { data, error } = await supabase
            .from("properties")
            .update(propertyData)
            .eq("id", existingId)
            .eq("organization_id", organizationId)
            .select("id")
            .maybeSingle();
          upsertError = error;
          persistedPropertyId = typeof data?.id === "string" ? data.id : null;
        } else {
          const prefix = getCategoryPrefix(categoria);
          const code = await generateCode(supabase, organizationId, prefix);
          propertyData.code = code;
          const { data, error } = await supabase
            .from("properties")
            .insert([propertyData])
            .select("id")
            .maybeSingle();
          upsertError = error;
          persistedPropertyId = typeof data?.id === "string" ? data.id : null;
        }

        if (upsertError) {
          errors.push(`DB error ${codigo}: ${upsertError.message}`);
        } else if (!persistedPropertyId) {
          errors.push(`DB error ${codigo}: property_not_returned`);
        } else {
          const mediaError = await reconcileCanonicalPropertyPhotos(
            supabase,
            organizationId,
            persistedPropertyId,
            allPhotos,
            photoResult.galleryComplete,
          );
          if (mediaError) {
            errors.push(`Media reconciliation error for ${codigo}: ${mediaError}`);
          } else {
            totalSynced++;
          }
        }
      } catch (e) {
        errors.push(`Process error: ${(e as Error).message}`);
      }
    }

    if (items.length < perPage) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return { totalSynced, totalSkipped, totalDeactivated, errors };
}

async function recordSyncResult(
  supabase: SupabaseClient,
  organizationId: string,
  synced: number,
  skipped: number,
  deactivated: number,
  errors: string[],
  runToken?: string | null,
): Promise<boolean> {
  const completedAt = new Date().toISOString();
  let update = supabase
    .from("vista_integrations")
    .update({
      last_sync_at: completedAt,
      total_synced: synced,
      status: errors.length === 0 ? "connected" : "error",
      last_error: errors.length === 0 ? null : errors[0].slice(0, 2_000),
      sync_log: {
        last_run: completedAt,
        synced,
        skipped,
        deactivated,
        errors: errors.slice(0, 20),
      },
      updated_at: completedAt,
    })
    .eq("organization_id", organizationId);
  if (runToken) {
    update = update
      .eq("status", "syncing")
      .eq("updated_at", runToken);
  }
  const { data, error } = await update.select("id");
  if (error) console.error("Vista sync status update failed:", error);
  return !error && data?.length === 1;
}

async function loadVistaIntegration(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ data: Record<string, unknown> | null; error: unknown }> {
  const serviceResult = await supabase
    .from("vista_integrations_service")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!serviceResult.error && serviceResult.data) {
    return { data: serviceResult.data as Record<string, unknown>, error: null };
  }

  // Compatibility path for environments where the Vault migration has not
  // been applied yet. After migration, the raw api_key column is always null.
  const legacyResult = await supabase
    .from("vista_integrations")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return {
    data: legacyResult.data as Record<string, unknown> | null,
    error: legacyResult.error ?? serviceResult.error,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: Record<string, unknown>;
    try {
      const parsedBody: unknown = await req.json();
      if (
        parsedBody === null ||
        typeof parsedBody !== "object" ||
        Array.isArray(parsedBody)
      ) {
        return jsonResponse({ error: "invalid_json_body" }, 400);
      }
      body = parsedBody as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "invalid_json_body" }, 400);
    }
    const action = typeof body.action === "string" ? body.action : "";
    const organizationId = typeof body.organization_id === "string"
      ? body.organization_id.trim()
      : "";

    if (!organizationId) {
      return jsonResponse({ error: "organization_id_required" }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
      return jsonResponse({ error: "invalid_organization_id" }, 400);
    }
    if (action !== "test" && action !== "sync") {
      return jsonResponse({ error: "invalid_action" }, 400);
    }

    const unauthorized = await authorizeVistaRequest(
      req,
      supabase,
      serviceRoleKey,
      organizationId,
    );
    if (unauthorized) return unauthorized;

    const { data: integration, error: intError } = await loadVistaIntegration(
      supabase,
      organizationId,
    );

    if (intError || !integration) {
      return jsonResponse({ error: "integration_not_configured" }, 404);
    }
    if (integration.is_active === false || integration.status === "disabled") {
      return jsonResponse({ error: "integration_disabled" }, 409);
    }

    let apiUrl: string;
    const apiKey = typeof integration.api_key === "string" ? integration.api_key.trim() : "";
    try {
      apiUrl = await normalizeVistaApiUrl(
        typeof integration.api_url === "string" ? integration.api_url : "",
      );
      if (!apiKey) throw new Error("invalid_vista_api_key");
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_vista_configuration";
      if (action === "sync") {
        await recordSyncResult(supabase, organizationId, 0, 0, 0, [message]);
        return jsonResponse({ success: false, synced: 0, skipped: 0, errors: [message] }, 422);
      }
      return jsonResponse({ success: false, error: message }, 200);
    }

    if (action === "test") {
      try {
        const result = await testConnection(apiUrl, apiKey);
        return jsonResponse(result, 200);
      } catch (e) {
        return jsonResponse({
          success: false,
          error: `Connection failed: ${(e as Error).message}`,
        }, 200);
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
      apiUrl,
      apiKey,
      organizationId,
      !!integration.import_inactive,
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
  } catch (e) {
    console.error("Vista sync fatal error:", (e as Error).message);
    return jsonResponse({ error: "vista_sync_failed" }, 500);
  }
});
