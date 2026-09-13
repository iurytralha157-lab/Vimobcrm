import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  enforceRateLimit,
  type RateLimitResult,
} from "../_shared/rate-limit.ts";
import {
  extractPublishedPropertySnapshot,
  type JsonRecord,
  projectPublicProperty,
  type PublicPropertyFilters,
  publicPropertyIsEligible,
  publicPropertyMatchesFilters,
  type PublicPropertyPublication,
  type PublicPropertyPublicationContext,
} from "./property-public-projection.ts";
import { publicAPIBillingHasAccess } from "./public-api-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key, x-request-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });

function publicAPIRateLimitResponse(result: RateLimitResult) {
  if (result.error !== null) {
    return json({
      error: "Unable to complete the public API request.",
      code: "public_api_failed",
    }, 500);
  }
  if (!result.response) return null;

  const headers = new Headers(result.response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify({
    error: "Public API request rate limit exceeded.",
    code: "api_rate_limited",
  }), { status: result.response.status, headers });
}

function isLegacyLeadWrite(request: Request) {
  if (request.method !== "POST") return false;

  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  return pathname === "/leads" || pathname.endsWith("/public-api/leads");
}

function legacyLeadWriteGoneResponse() {
  return new Response(
    JSON.stringify({
      success: false,
      code: "public_api_lead_write_gone",
      error: "Esta rota de criacao de leads nao esta mais disponivel.",
      replacement: "/v1/public/api/leads",
    }),
    {
      status: 410,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

const PUBLIC_PROPERTY_STATUSES = ["active", "ativo"];
const PROPERTY_BATCH_SIZE = 200;
const API_KEY_USAGE_TOUCH_INTERVAL_MS = 60_000;
const PUBLIC_PROPERTY_COLUMNS = [
  "id", "code", "title", "descricao_site", "tipo", "tipo_de_imovel",
  "finalidade", "tipo_de_negocio", "status", "published_on_site",
  "is_featured", "destaque", "preco", "valor_locacao", "condominio",
  "iptu", "taxa_de_servico", "valor_itr", "seguro_incendio", "quartos",
  "suites", "banheiros", "vagas", "area_total", "area_util", "andar",
  "address_visibility", "public_address_visibility", "bairro", "cidade",
  "uf", "pais", "endereco", "numero", "complemento", "cep", "latitude",
  "longitude", "imagem_principal", "image_urls", "fotos", "metadata",
  "detalhes_extras", "proximidades", "video_imovel", "tour_virtual",
  "aceita_financiamento", "aceita_permuta", "usou_fgts", "exclusividade",
  "mobiliado", "mobilia", "created_at", "updated_at",
].join(",");

const PROPERTY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function loadPublicationContexts(
  supabase: SupabaseClient,
  organizationId: string,
  propertyIds: string[],
) {
  const contexts = new Map<string, PublicPropertyPublicationContext>();
  for (const propertyId of propertyIds) {
    contexts.set(propertyId, { publication: null, snapshot: null });
  }
  if (propertyIds.length === 0) return contexts;

  const publications: PublicPropertyPublication[] = [];
  for (const propertyIdChunk of chunks(propertyIds, 100)) {
    const { data, error } = await supabase
      .from("property_channel_publications")
      .select("id, property_id, desired_state, published_version")
      .eq("organization_id", organizationId)
      .eq("channel", "site")
      .eq("channel_account_key", "default")
      .in("property_id", propertyIdChunk);
    if (error) throw error;
    publications.push(...(data ?? []));
  }

  const ambiguousPropertyIds = new Set<string>();
  const publicationById = new Map<string, PublicPropertyPublication>();
  const publicationIdsByVersion = new Map<number, string[]>();
  for (const publication of publications) {
    const propertyId = typeof publication.property_id === "string"
      ? publication.property_id
      : "";
    const publicationId = typeof publication.id === "string" ? publication.id : "";
    if (!contexts.has(propertyId)) continue;
    if (!propertyId || !publicationId || contexts.get(propertyId)?.publication) {
      ambiguousPropertyIds.add(propertyId);
      continue;
    }
    const duplicatePublication = publicationById.get(publicationId);
    if (duplicatePublication) {
      ambiguousPropertyIds.add(propertyId);
      ambiguousPropertyIds.add(duplicatePublication.property_id);
      publicationById.delete(publicationId);
      continue;
    }
    contexts.set(propertyId, { publication, snapshot: null, ambiguous: false });
    publicationById.set(publicationId, publication);
  }

  for (const publication of publicationById.values()) {
    if (ambiguousPropertyIds.has(publication.property_id)) continue;
    const publishedVersion = Number(publication.published_version);
    if (
      publication.desired_state !== "published" ||
      !Number.isInteger(publishedVersion) || publishedVersion <= 0
    ) continue;
    const ids = publicationIdsByVersion.get(publishedVersion) ?? [];
    ids.push(publication.id);
    publicationIdsByVersion.set(publishedVersion, ids);
  }

  const seenVersionPublicationIds = new Set<string>();
  for (const [version, publicationIds] of publicationIdsByVersion) {
    for (const publicationIdChunk of chunks(publicationIds, 100)) {
      const { data, error } = await supabase
        .from("property_channel_publication_versions")
        .select("publication_id, property_id, payload")
        .eq("organization_id", organizationId)
        .eq("channel", "site")
        .eq("channel_account_key", "default")
        .eq("version", version)
        .in("publication_id", publicationIdChunk);
      if (error) throw error;

      for (const row of data ?? []) {
        const publicationId = typeof row.publication_id === "string" ? row.publication_id : "";
        const rowPropertyId = typeof row.property_id === "string" ? row.property_id : "";
        const publication = publicationById.get(publicationId);
        if (!publication || publication.property_id !== rowPropertyId) {
          if (contexts.has(rowPropertyId)) ambiguousPropertyIds.add(rowPropertyId);
          if (publication) ambiguousPropertyIds.add(publication.property_id);
          continue;
        }
        if (seenVersionPublicationIds.has(publicationId)) {
          ambiguousPropertyIds.add(publication.property_id);
          continue;
        }
        seenVersionPublicationIds.add(publicationId);
        const snapshot = extractPublishedPropertySnapshot(row.payload);
        contexts.set(publication.property_id, { publication, snapshot, ambiguous: false });
      }
    }
  }

  for (const propertyId of ambiguousPropertyIds) {
    if (contexts.has(propertyId)) {
      contexts.set(propertyId, { publication: null, snapshot: null, ambiguous: true });
    }
  }

  return contexts;
}

function numericFilter(value: string | null, fallback: number | null) {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function propertyFilters(url: URL): PublicPropertyFilters {
  return {
    city: url.searchParams.get("city"),
    neighborhood: url.searchParams.get("neighborhood"),
    type: url.searchParams.get("type"),
    purpose: url.searchParams.get("purpose"),
    minPrice: numericFilter(url.searchParams.get("min_price"), 0),
    maxPrice: numericFilter(url.searchParams.get("max_price"), 0),
    bedrooms: numericFilter(url.searchParams.get("bedrooms"), 0),
  };
}

async function listPublicProperties(
  supabase: SupabaseClient,
  organizationId: string,
  filters: PublicPropertyFilters,
  from: number,
  to: number,
) {
  const data: ReturnType<typeof projectPublicProperty>[] = [];
  let total = 0;
  let offset = 0;
  const candidates = new Map<string, JsonRecord>();

  // Compatibility rows are candidates only when explicitly published. A
  // canonical site/default row is checked afterwards and can still veto them.
  while (true) {
    const { data: propertyRows, error } = await supabase
      .from("properties")
      .select(PUBLIC_PROPERTY_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", PUBLIC_PROPERTY_STATUSES)
      .eq("published_on_site", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PROPERTY_BATCH_SIZE - 1);
    if (error) throw error;

    const properties = (propertyRows ?? []) as JsonRecord[];
    if (properties.length === 0) break;
    for (const property of properties) candidates.set(String(property.id), property);

    if (properties.length < PROPERTY_BATCH_SIZE) break;
    offset += PROPERTY_BATCH_SIZE;
  }

  // The canonical snapshot remains authoritative even if a compatibility flag
  // drifted. Fetch those ids separately so matching the Go projection does not
  // require scanning every private property in the organization.
  offset = 0;
  const canonicalPublishedPropertyIds: string[] = [];
  while (true) {
    const { data: publicationRows, error } = await supabase
      .from("property_channel_publications")
      .select("property_id")
      .eq("organization_id", organizationId)
      .eq("channel", "site")
      .eq("channel_account_key", "default")
      .eq("desired_state", "published")
      .not("published_version", "is", null)
      .order("property_id", { ascending: true })
      .range(offset, offset + PROPERTY_BATCH_SIZE - 1);
    if (error) throw error;
    const publications = publicationRows ?? [];
    canonicalPublishedPropertyIds.push(
      ...publications.map((publication) => String(publication.property_id)),
    );
    if (publications.length < PROPERTY_BATCH_SIZE) break;
    offset += PROPERTY_BATCH_SIZE;
  }

  const missingCanonicalIds = canonicalPublishedPropertyIds.filter(
    (propertyId) => !candidates.has(propertyId),
  );
  for (const propertyIdChunk of chunks(missingCanonicalIds, 100)) {
    const { data: propertyRows, error } = await supabase
      .from("properties")
      .select(PUBLIC_PROPERTY_COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", PUBLIC_PROPERTY_STATUSES)
      .in("id", propertyIdChunk);
    if (error) throw error;
    for (const property of propertyRows ?? []) {
      candidates.set(String(property.id), property as JsonRecord);
    }
  }

  const properties = [...candidates.values()].sort((left, right) => {
    const createdAtOrder = String(right.created_at ?? "").localeCompare(
      String(left.created_at ?? ""),
    );
    return createdAtOrder || String(left.id).localeCompare(String(right.id));
  });

  for (const propertyChunk of chunks(properties, PROPERTY_BATCH_SIZE)) {
    const propertyIds = propertyChunk.map((property) => String(property.id));
    const contexts = await loadPublicationContexts(
      supabase,
      organizationId,
      propertyIds,
    );

    for (const property of propertyChunk) {
      const propertyId = String(property.id);
      const context = contexts.get(propertyId) ?? {
        publication: null,
        snapshot: null,
      };
      if (!publicPropertyIsEligible(property, context)) continue;
      const projection = projectPublicProperty(property, context.snapshot);
      if (!publicPropertyMatchesFilters(projection, filters)) continue;
      if (total >= from && total <= to) data.push(projection);
      total += 1;
    }
  }

  return { data, total };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (isLegacyLeadWrite(req)) {
    return legacyLeadWriteGoneResponse();
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const ipRateLimit = await enforceRateLimit(
      supabase,
      req,
      "public_api_ip",
      [{ name: "minute", limit: 300, windowSeconds: 60 }],
      corsHeaders,
      { failClosed: true },
    );
    const ipRateLimitResponse = publicAPIRateLimitResponse(ipRateLimit);
    if (ipRateLimitResponse) return ipRateLimitResponse;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({
        error: "Missing or invalid Authorization header",
        code: "unauthorized",
      }, 401);
    }
    const apiKey = authHeader.slice(7).trim();
    if (!apiKey) {
      return json({ error: "Empty API key", code: "unauthorized" }, 401);
    }

    const keyHash = await sha256Hex(apiKey);
    const { data: keyData, error: keyError } = await supabase
      .from("organization_api_keys")
      .select("id, organization_id, is_active, expires_at, last_used_at")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (keyError) throw keyError;
    if (!keyData) {
      return json({ error: "Invalid API key", code: "invalid_api_key" }, 401);
    }
    if (keyData.is_active !== true) {
      return json({ error: "API key has been revoked", code: "revoked" }, 401);
    }
    const expiresAt = keyData.expires_at === null
      ? null
      : Date.parse(String(keyData.expires_at));
    const requestNow = Date.now();
    if (
      expiresAt !== null &&
      (!Number.isFinite(expiresAt) || expiresAt <= requestNow)
    ) {
      return json({ error: "API key has expired", code: "expired" }, 401);
    }

    const organizationId = keyData.organization_id;
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .select(
        "is_active, subscription_status, subscription_type, trial_ends_at, billing_grace_until",
      )
      .eq("id", organizationId)
      .maybeSingle();
    if (organizationError) throw organizationError;
    if (!organization || organization.is_active !== true) {
      return json({ error: "Invalid API key", code: "invalid_api_key" }, 401);
    }
    if (!publicAPIBillingHasAccess({
      organizationId,
      subscriptionStatus: organization.subscription_status,
      subscriptionType: organization.subscription_type,
      trialEndsAt: organization.trial_ends_at,
      billingGraceUntil: organization.billing_grace_until,
    }, requestNow)) {
      return json({
        error: "Billing access is required to use the public API.",
        code: "billing_access_required",
      }, 402);
    }

    const { data: moduleData, error: moduleError } = await supabase
      .from("organization_modules")
      .select("is_enabled")
      .eq("organization_id", organizationId)
      .eq("module_name", "api")
      .maybeSingle();
    if (moduleError) throw moduleError;

    if (!moduleData?.is_enabled) {
      return json({
        error: "API module is not enabled for this organization",
        code: "module_disabled",
      }, 403);
    }

    const keyRateLimit = await enforceRateLimit(
      supabase,
      req,
      "public_api_key",
      [
        { name: "minute", limit: 120, windowSeconds: 60 },
        { name: "hour", limit: 1_000, windowSeconds: 3600 },
      ],
      corsHeaders,
      {
        identifier: `${organizationId}:${keyData.id}`,
        failClosed: true,
      },
    );
    const keyRateLimitResponse = publicAPIRateLimitResponse(keyRateLimit);
    if (keyRateLimitResponse) return keyRateLimitResponse;

    const url = new URL(req.url);
    const path = url.pathname.replace("/public-api", "").replace(/\/$/, "") ||
      "/";

    const lastUsedAt = keyData.last_used_at === null
      ? null
      : Date.parse(String(keyData.last_used_at));
    if (
      lastUsedAt === null ||
      !Number.isFinite(lastUsedAt) ||
      lastUsedAt <= requestNow - API_KEY_USAGE_TOUCH_INTERVAL_MS
    ) {
      const usageQuery = supabase
        .from("organization_api_keys")
        .update({ last_used_at: new Date(requestNow).toISOString() })
        .eq("id", keyData.id)
        .eq("organization_id", organizationId);
      const fencedUsageQuery = keyData.last_used_at === null
        ? usageQuery.is("last_used_at", null)
        : usageQuery.eq("last_used_at", keyData.last_used_at);
      fencedUsageQuery.then(() => {});
    }

    if (req.method === "GET" && path === "/properties") {
      const page = Math.max(
        1,
        parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
      );
      const perPageRaw =
        parseInt(url.searchParams.get("per_page") ?? "50", 10) || 50;
      const perPage = Math.min(100, Math.max(1, perPageRaw));
      const from = (page - 1) * perPage;
      const to = from + perPage - 1;
      const result = await listPublicProperties(
        supabase,
        organizationId,
        propertyFilters(url),
        from,
        to,
      );

      return json({
        data: result.data,
        pagination: {
          page,
          per_page: perPage,
          total: result.total,
          total_pages: result.total ? Math.ceil(result.total / perPage) : 0,
        },
      });
    }

    const propertyMatch = path.match(/^\/properties\/([^/]+)$/);
    if (req.method === "GET" && propertyMatch) {
      const propertyId = propertyMatch[1];
      if (!PROPERTY_ID_PATTERN.test(propertyId)) {
        return json({ error: "Property not found", code: "not_found" }, 404);
      }
      const { data: property, error } = await supabase
        .from("properties")
        .select(PUBLIC_PROPERTY_COLUMNS)
        .eq("id", propertyId)
        .eq("organization_id", organizationId)
        .in("status", PUBLIC_PROPERTY_STATUSES)
        .maybeSingle();

      if (error) throw error;
      if (!property) {
        return json({ error: "Property not found", code: "not_found" }, 404);
      }
      const contexts = await loadPublicationContexts(
        supabase,
        organizationId,
        [propertyId],
      );
      const context = contexts.get(propertyId) ?? {
        publication: null,
        snapshot: null,
      };
      if (!publicPropertyIsEligible(property, context)) {
        return json({ error: "Property not found", code: "not_found" }, 404);
      }
      return json({ data: projectPublicProperty(property, context.snapshot) });
    }

    return json({ error: "Endpoint not found", code: "not_found" }, 404);
  } catch (err) {
    console.error("public-api error:", err);
    return json({
      error: "Internal Server Error",
      code: "internal_error",
    }, 500);
  }
});
