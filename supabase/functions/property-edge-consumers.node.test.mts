import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleRequest as retiredWordPressMediaMigration } from "./auto-migrate-wp-images/index.ts";
import {
  projectPublicProperty,
  publicPropertyIsEligible,
  publicPropertyMatchesFilters,
} from "./public-api/property-public-projection.ts";
import { publicAPIBillingHasAccess } from "./public-api/public-api-access.ts";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const publicApi = source("./public-api/index.ts");
const calendar = source("./_shared/google-calendar.ts");
const rateLimiter = source("./_shared/rate-limit.ts");
const wordpressMigration = source("./auto-migrate-wp-images/index.ts");
const imoview = source("./imoview-sync/index.ts");
const vista = source("./vista-sync/index.ts");
const mediaLifecycleMigration = source("../migrations/20260908000636_normalize_property_media_lifecycle.sql");
const providerMediaMigration = source("../migrations/20260908101026_reconcile_provider_property_assets.sql");
const publicationRepository = source("../../apps/api/internal/publications/repository.go");

const property = {
  id: "33333333-3333-4333-8333-333333333333",
  code: "AP-10",
  title: "Live title",
  descricao: "internal description",
  descricao_site: "Public description",
  tipo: "apartamento",
  finalidade: "venda",
  status: "active",
  published_on_site: true,
  anunciar: true,
  address_visibility: "parcial",
  endereco: "Rua sigilosa",
  numero: "123",
  complemento: "Apto 45",
  bairro: "Centro",
  cidade: "Sao Paulo",
  uf: "SP",
  cep: "01001-000",
  latitude: -23.5,
  longitude: -46.6,
  imagem_principal: "https://cdn.example/hidden.jpg",
  fotos: ["https://cdn.example/hidden.jpg", "https://cdn.example/public.jpg"],
  metadata: { hidden_site_image_urls: ["https://cdn.example/hidden.jpg"] },
};

test("canonical site state is authoritative over compatibility booleans", () => {
  assert.equal(publicPropertyIsEligible(property, {
    publication: {
      id: "44444444-4444-4444-8444-444444444444",
      property_id: property.id,
      desired_state: "unpublished",
      published_version: null,
    },
    snapshot: null,
  }), false);

  assert.equal(publicPropertyIsEligible({ ...property, anunciar: true, published_on_site: false }, {
    publication: null,
    snapshot: null,
  }), false, "anunciar alone must not revive an unpublished property");

  const publication = {
    id: "44444444-4444-4444-8444-444444444444",
    property_id: property.id,
    desired_state: "published",
    published_version: 7,
  };
  assert.equal(publicPropertyIsEligible(property, { publication, snapshot: null }), false);
  assert.equal(publicPropertyIsEligible(property, {
    publication,
    snapshot: { id: property.id, titulo: "Frozen title" },
  }), true);
  assert.equal(publicPropertyIsEligible(property, {
    publication,
    snapshot: { id: "55555555-5555-4555-8555-555555555555" },
  }), false, "a mismatched snapshot cannot project another property");
  assert.equal(publicPropertyIsEligible(property, {
    publication: { ...publication, property_id: "55555555-5555-4555-8555-555555555555" },
    snapshot: { id: property.id },
  }), false, "a mismatched publication cannot project another property");
  assert.equal(publicPropertyIsEligible(property, {
    publication,
    snapshot: { id: property.id },
    ambiguous: true,
  }), false, "ambiguous canonical rows must fail closed");
});

test("public property projection freezes canonical copy and enforces address privacy", () => {
  const legacyProjection = projectPublicProperty(property, null);
  assert.equal(legacyProjection.description, "Public description");
  assert.equal(legacyProjection.address.street, null);
  assert.equal(legacyProjection.address.zipcode, null);
  assert.equal(legacyProjection.address.latitude, null);
  assert.equal(legacyProjection.address.neighborhood, "Centro");
  assert.deepEqual(legacyProjection.images, ["https://cdn.example/public.jpg"]);
  assert.equal(legacyProjection.main_image, "https://cdn.example/public.jpg");

  const snapshotProjection = projectPublicProperty(property, {
    id: property.id,
    codigo: "AP-10",
    titulo: "Frozen title",
    descricao: "Frozen public copy",
    tipo_imovel: "apartamento",
    finalidade: "venda",
    status: "active",
    public_address_visibility: "minimo",
    bairro: "Must not escape",
    cidade: "Sao Paulo",
    estado: "SP",
    endereco: "Must not escape",
    cep: "01001-000",
    latitude: -23.5,
    longitude: -46.6,
    fotos: [
      "https://cdn.example/frozen.jpg",
      "/v1/public/property-publications/44444444-4444-4444-8444-444444444444/versions/7/assets/66666666-6666-4666-8666-666666666666",
    ],
  });
  assert.equal(snapshotProjection.title, "Frozen title");
  assert.equal(snapshotProjection.address.neighborhood, null);
  assert.equal(snapshotProjection.address.street, null);
  assert.equal(snapshotProjection.address.zipcode, null);
  assert.equal(snapshotProjection.images.length, 2, "canonical relative asset routes remain usable");
  assert.equal(publicPropertyMatchesFilters(snapshotProjection, {
    city: "sao",
    type: "apartamento",
    purpose: "venda",
  }), true);
  assert.equal(publicPropertyMatchesFilters(snapshotProjection, { neighborhood: "Centro" }), false);

  const saleAndRentProjection = projectPublicProperty({
    ...property,
    finalidade: "venda_locacao",
    preco: 900_000,
    valor_locacao: 3_500,
  }, null);
  assert.equal(publicPropertyMatchesFilters(saleAndRentProjection, {
    purpose: "locacao",
    minPrice: 3_000,
    maxPrice: 4_000,
  }), true, "rental filters must use rental price and include sale/rent inventory");
  assert.equal(publicPropertyMatchesFilters(saleAndRentProjection, {
    purpose: "venda",
    maxPrice: 4_000,
  }), false, "sale filters must not compare against rent price");
  const seasonalProjection = projectPublicProperty({
    ...property,
    finalidade: "temporada",
    preco: null,
    valor_locacao: 650,
  }, null);
  assert.equal(publicPropertyMatchesFilters(seasonalProjection, {
    purpose: "rental_catalog",
    minPrice: 600,
    maxPrice: 700,
  }), true);
});

test("public API loads immutable site/default versions and never returns raw property rows", () => {
  assert.match(publicApi, /\.select\("id, organization_id, is_active, expires_at, last_used_at"\)/);
  assert.match(publicApi, /keyData\.is_active !== true/);
  assert.match(publicApi, /if \(keyError\) throw keyError/);
  assert.match(publicApi, /Date\.parse\(String\(keyData\.expires_at\)\)/);
  assert.doesNotMatch(publicApi, /keyData\.revoked_at|organization_id, revoked_at/);
  assert.match(publicApi, /API_KEY_USAGE_TOUCH_INTERVAL_MS = 60_000/);
  assert.match(publicApi, /lastUsedAt <= requestNow - API_KEY_USAGE_TOUCH_INTERVAL_MS/);
  assert.match(publicApi, /usageQuery\.is\("last_used_at", null\)/);
  assert.match(publicApi, /usageQuery\.eq\("last_used_at", keyData\.last_used_at\)/);
  assert.match(publicApi, /\.from\("organizations"\)/);
  assert.match(
    publicApi,
    /is_active, subscription_status, subscription_type, trial_ends_at, billing_grace_until/,
  );
  assert.match(publicApi, /organization\.is_active !== true/);
  assert.match(publicApi, /publicAPIBillingHasAccess\(\{/);
  assert.match(publicApi, /code: "billing_access_required"/);
  assert.match(publicApi, /if \(moduleError\) throw moduleError/);
  const organizationLookup = publicApi.indexOf('.from("organizations")');
  const ipRateLimit = publicApi.indexOf("const ipRateLimit = await enforceRateLimit");
  const credentialLookup = publicApi.indexOf('req.headers.get("Authorization")');
  const moduleLookup = publicApi.indexOf('.from("organization_modules")');
  const keyRateLimit = publicApi.indexOf("const keyRateLimit = await enforceRateLimit");
  assert.ok(ipRateLimit >= 0 && credentialLookup > ipRateLimit);
  assert.ok(organizationLookup > credentialLookup);
  assert.ok(moduleLookup > organizationLookup && keyRateLimit > moduleLookup);
  assert.match(
    publicApi,
    /"public_api_ip",\s*\[\{ name: "minute", limit: 300, windowSeconds: 60 \}\]/,
  );
  assert.match(publicApi, /"public_api_key",[\s\S]{0,180}limit: 120[\s\S]{0,100}limit: 1_000/);
  assert.match(publicApi, /identifier: `\$\{organizationId\}:\$\{keyData\.id\}`/);
  assert.equal((publicApi.match(/failClosed: true/g) ?? []).length, 2);
  assert.match(publicApi, /code: "api_rate_limited"/);
  assert.match(publicApi, /code: "public_api_failed"/);
  assert.doesNotMatch(publicApi, /read_burst|read_hourly|limit: 2000/);
  assert.match(rateLimiter, /failClosed\?: boolean/);
  assert.match(rateLimiter, /if \(options\.failClosed\) return \{ response: null, error \}/);
  assert.match(rateLimiter, /return \{ response: null, error: null \}/);
  assert.match(publicApi, /\.from\("property_channel_publications"\)/);
  assert.match(publicApi, /\.from\("property_channel_publication_versions"\)/);
  assert.match(publicApi, /\.eq\("channel", "site"\)/);
  assert.match(publicApi, /\.eq\("channel_account_key", "default"\)/);
  assert.match(publicApi, /projectPublicProperty\(property, context\.snapshot\)/);
  assert.match(publicApi, /\.eq\("organization_id", organizationId\)/);
  assert.doesNotMatch(publicApi, /\.from\("properties"\)[\s\S]{0,120}\.select\("\*"/);
  assert.doesNotMatch(publicApi, /details:\s*\(err as Error\)\.message/);
  assert.match(publicApi, /ambiguousPropertyIds/);
});

test("public API billing eligibility mirrors the Go tenant policy", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");
  const context = {
    organizationId: "11111111-1111-4111-8111-111111111111",
    subscriptionStatus: "active",
    subscriptionType: "free",
    trialEndsAt: null,
    billingGraceUntil: null,
  };

  assert.equal(publicAPIBillingHasAccess(context, now), true);
  assert.equal(publicAPIBillingHasAccess({
    ...context,
    subscriptionType: "trial",
    subscriptionStatus: "trial",
    trialEndsAt: "2026-09-09T12:00:00.000Z",
  }, now), true);
  assert.equal(publicAPIBillingHasAccess({
    ...context,
    subscriptionType: "trial",
    subscriptionStatus: "trial",
    trialEndsAt: "2026-09-08T12:00:00.000Z",
  }, now), false, "trial must still be active strictly after the request time");
  assert.equal(publicAPIBillingHasAccess({
    ...context,
    subscriptionType: "paid",
    subscriptionStatus: "active",
  }, now), true);
  for (const status of ["overdue", "past_due"]) {
    assert.equal(publicAPIBillingHasAccess({
      ...context,
      subscriptionType: "paid",
      subscriptionStatus: status,
      billingGraceUntil: "2026-09-09T12:00:00.000Z",
    }, now), true);
  }
  assert.equal(publicAPIBillingHasAccess({
    ...context,
    subscriptionType: "paid",
    subscriptionStatus: "overdue",
    billingGraceUntil: "2026-09-08T11:59:59.000Z",
  }, now), false);
  assert.equal(publicAPIBillingHasAccess({
    ...context,
    organizationId: " ",
  }, now), false);
  assert.equal(publicAPIBillingHasAccess({
    ...context,
    subscriptionType: "unknown",
  }, now), false);
});

test("legacy WordPress media migration is a side-effect-free tombstone", async () => {
  const response = retiredWordPressMediaMigration(new Request("https://edge.example/auto-migrate-wp-images", {
    method: "POST",
  }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, "legacy_property_media_migration_retired");
  assert.doesNotMatch(
    wordpressMigration,
    /createClient|req\.json|\bfetch\s*\(|\.from\s*\(|\.rpc\s*\(|\.upload\s*\(|\.update\s*\(/i,
  );
});

test("Google Calendar omits generated property context and requires active membership", () => {
  assert.doesNotMatch(calendar, /async function getLinkedProperty/);
  assert.match(calendar, /event:\s*\{ \.\.\.event, lead, property: null \}/);
  assert.match(calendar, /\.eq\("is_active", true\)/);
  assert.match(calendar, /if \(!membership\) return false/);
  const membershipCheck = calendar.indexOf("if (!membership) return false");
  const ownerGrant = calendar.indexOf("if (event.user_id === userId) return true");
  assert.ok(membershipCheck >= 0 && ownerGrant > membershipCheck);
});

test("admin ingestion keeps tenant-scoped writes and the canonical 20-photo ceiling", () => {
  for (const sync of [imoview, vista]) {
    assert.match(sync, /const propertyPhotoLimit = 20/);
    assert.match(sync, /organization_members/);
    assert.match(sync, /\.eq\("is_active", true\)/);
    assert.match(sync, /\["owner", "admin"\]\.includes\(membership\.role\)/);
    assert.match(sync, /organization_id: organizationId/);
    assert.match(sync, /\.rpc\("reconcile_imported_property_photos"/);
    assert.match(sync, /p_organization_id:\s*organizationId/);
    assert.match(sync, /p_property_id:\s*propertyId/);
    assert.match(sync, /p_photo_urls:\s*photos/);
    assert.match(sync, /p_primary_url:\s*photos\[0\] \?\? null/);
    assert.match(sync, /p_gallery_complete:\s*galleryComplete/);
    assert.match(sync, /galleryComplete:\s*false/);
    assert.match(sync, /const propertyMediaCapacityError = "property_media_capacity_exhausted_append_only"/);
    assert.match(sync, /error\.code === "23514" && error\.message\.includes\(propertyMediaCapacityError\)/);
    assert.match(sync, /Media reconciliation error for \$\{(?:code|codigo)\}: \$\{mediaError\}/);
    assert.match(sync, /returnedCode/);
    assert.match(sync, /\.select\("id"\)\s*\.maybeSingle\(\)/);
    assert.match(sync, /descricao_site:/);
    assert.match(sync, /`Imóvel \$\{(?:code|codigo)\}`/);
    assert.doesNotMatch(sync, /ImÃ³vel/);
    assert.doesNotMatch(sync, /Ã|Â|â/);
    assert.match(sync, /finalidade:/);
    assert.match(sync, /tipo:/);
    assert.doesNotMatch(sync, /reconcileStaleImportedProperties/);
    assert.doesNotMatch(sync, /stale_inventory/);
    assert.doesNotMatch(sync, /\.update\(\{\s*status:\s*"inativo"/);
    assert.match(sync, /Missing rows are therefore never (?:deactivated|inferred as inactive)/);
    assert.match(sync, /const syncLeaseMs = 5 \* 60 \* 1_000/);
    assert.match(sync, /status:\s*"syncing"/);
    assert.match(sync, /\.eq\("updated_at", runToken\)/);
    assert.match(sync, /integration_disabled/);

    const propertyPayloadStart = sync.indexOf("const propertyData");
    const propertyPayloadEnd = sync.indexOf("};", propertyPayloadStart);
    assert.ok(propertyPayloadStart >= 0 && propertyPayloadEnd > propertyPayloadStart);
    const propertyPayload = sync.slice(propertyPayloadStart, propertyPayloadEnd);
    assert.doesNotMatch(propertyPayload, /imagem_principal|image_urls|fotos/,
      "legacy media fields must be written only inside the transactional RPC");
  }

  assert.match(imoview, /async function persistImoviewProperty/);
  assert.match(imoview, /\.insert\(\[propertyData\]\)/);
  assert.match(imoview, /insertError\?\.code !== "23505"/);
  assert.match(imoview, /const \{ data: raced, error: rereadError \} = await loadExisting\(\)/);
  assert.match(imoview, /\.eq\("organization_id", organizationId\)[\s\S]{0,160}\.eq\("imoview_codigo", sourceCode\)/);
  assert.doesNotMatch(imoview, /\.upsert\(/);
  assert.doesNotMatch(imoview, /onConflict/);
  assert.match(imoview, /const collectionKeys = \[/);
  assert.match(imoview, /!Array\.isArray\(collection\) \|\| collection\.length > propertyPhotoLimit/);
  assert.match(imoview, /validEntries === collection\.length && photos\.length === collection\.length/);
  assert.match(imoview, /normalizeImportedPropertyStatus\(sourceStatus, true\)/);
  assert.match(vista, /const collectionIsExplicit = Array\.isArray\(fotosData\) && fotosData\.length <= propertyPhotoLimit/);
  assert.match(vista, /validEntries === entries\.length/);
  assert.match(vista, /entryKeys\.size === entries\.length/);
  assert.match(vista, /galleryComplete:\s*gallery\.galleryComplete/);
  assert.match(vista, /status = normalizeImportedPropertyStatus\(item\.Status\)/);
  assert.match(vista, /status !== "ativo" && !existingMap\.has\(codigo\)/);
  assert.match(vista, /\.update\(propertyData\)[\s\S]{0,120}\.eq\("id", existingId\)[\s\S]{0,120}\.eq\("organization_id", organizationId\)/);
  assert.match(vista, /\.eq\("last_number", sequence\.last_number\)/);
  assert.match(vista, /property_code_generation_conflict/);
  assert.match(vista, /invalid_organization_id/);

  assert.match(mediaLifecycleMigration, /properties_mirror_legacy_photos_to_assets/);
  assert.match(mediaLifecycleMigration, /after insert or update of imagem_principal, image_urls, fotos, metadata/);
  assert.match(mediaLifecycleMigration, /insert into public\.property_assets/);
  assert.match(mediaLifecycleMigration, /constraint = 'property_assets_photo_capacity'/);

  assert.match(providerMediaMigration, /create or replace function public\.reconcile_imported_property_photos/);
  assert.match(providerMediaMigration, /security definer\s+set search_path = ''/);
  assert.match(providerMediaMigration, /for update;/);
  assert.match(providerMediaMigration, /property\.organization_id = p_organization_id\s+and property\.id = p_property_id/);
  assert.match(providerMediaMigration, /v_provider not in \('imoview', 'vista'\)/);
  assert.match(providerMediaMigration, /property_assets_provider_reference_check/);
  assert.match(providerMediaMigration, /cardinality\(p_photo_urls\), 0\) > 20/);
  assert.match(providerMediaMigration, /v_url !~\* '\^https:\/\//);
  assert.match(providerMediaMigration, /Provider photos stay append-only/);
  assert.match(providerMediaMigration, /raise exception 'property_media_capacity_exhausted_append_only'[\s\S]+?constraint = 'property_assets_photo_capacity'[\s\S]+?Imported media is append-only/);
  assert.doesNotMatch(providerMediaMigration, /delete from public\.property_assets/i);
  assert.doesNotMatch(providerMediaMigration, /legacy_mirror|legacy_backfill/i);
  assert.doesNotMatch(providerMediaMigration, /if p_gallery_complete is true then/i);
  assert.match(providerMediaMigration, /shared ownership[\s\S]+?integration_providers/);
  assert.match(providerMediaMigration, /coalesce\(asset\.metadata->>'integration_managed', 'false'\) = 'true'/);
  assert.match(providerMediaMigration, /'integration_managed', true[\s\S]+?'integration_providers', pg_catalog\.jsonb_build_array\(v_provider\)/);
  assert.match(providerMediaMigration, /visibility = 'public'[\s\S]+?asset\.external_url is not null/);
  assert.match(providerMediaMigration, /imagem_principal = v_legacy_primary[\s\S]+?image_urls = v_legacy_urls[\s\S]+?fotos = pg_catalog\.to_jsonb\(v_legacy_urls\)/);
  assert.match(providerMediaMigration, /revoke all on function public\.reconcile_imported_property_photos[\s\S]+?from public, anon, authenticated, service_role;/);
  assert.match(providerMediaMigration, /grant execute on function public\.reconcile_imported_property_photos[\s\S]+?to service_role;/);

  const primaryRotationStart = providerMediaMigration.indexOf("-- A sync may rotate only its own sole-owned primary");
  const compatibilityMirrorStart = providerMediaMigration.indexOf("-- Compatibility columns mirror", primaryRotationStart);
  assert.ok(primaryRotationStart >= 0 && compatibilityMirrorStart > primaryRotationStart);
  const primaryRotation = providerMediaMigration.slice(primaryRotationStart, compatibilityMirrorStart);
  assert.match(primaryRotation, /candidate\.visibility = 'public'[\s\S]+?candidate\.external_url = v_requested_primary/);
  assert.match(primaryRotation, /candidate\.metadata->>'integration_managed'[\s\S]+?property_asset_integration_providers\(candidate\.metadata\) \? v_provider/);
  assert.match(primaryRotation, /current_primary\.is_primary[\s\S]+?current_primary\.metadata->>'integration_managed'[\s\S]+?jsonb_array_length[\s\S]+?= 1/);
  assert.match(primaryRotation, /v_requested_primary_asset_id is not null[\s\S]+?v_current_primary_asset_id is null or v_current_primary_replaceable/);
  assert.match(primaryRotation, /set is_primary = false[\s\S]+?current_primary\.metadata->>'integration_managed'[\s\S]+?jsonb_array_length[\s\S]+?= 1/);
  assert.match(primaryRotation, /set is_primary = true[\s\S]+?asset\.visibility = 'public'[\s\S]+?asset\.external_url = v_requested_primary[\s\S]+?not exists/);
  const clearPrimary = primaryRotation.indexOf("set is_primary = false");
  const promotePrimary = primaryRotation.indexOf("set is_primary = true");
  assert.ok(clearPrimary >= 0 && promotePrimary > clearPrimary);
  assert.equal((providerMediaMigration.match(/set is_primary = false/g) ?? []).length, 1);

  assert.match(publicationRepository, /join public\.property_assets as asset/);
  assert.match(publicationRepository, /asset\.visibility = 'public'/);
  assert.match(publicationRepository, /media->>'asset_id' = asset\.id::text/);
  assert.match(publicationRepository, /media->>'source_hash' = coalesce/);
});

test("Vista API targets are server-configured and fail closed before DNS resolution", () => {
  assert.match(vista, /const vistaManagedHost = "vistahost\.com\.br"/);
  assert.match(vista, /const vistaAdditionalHostsEnv = "VISTA_ALLOWED_API_HOSTS"/);
  assert.match(vista, /if \(!isAllowedVistaApiHost\(host\)\) \{\s*throw new Error\("unapproved_vista_api_host"\)/);
  assert.match(vista, /if \(!rule\.startsWith\("\*\."\)\) return host === rule/);
  assert.match(vista, /return host\.endsWith\(`\.\$\{suffix\}`\)/);
  assert.match(vista, /redirect: "error"/);
  const allowlistCheck = vista.indexOf("if (!isAllowedVistaApiHost(host))");
  const dnsResolution = vista.indexOf("Deno.resolveDns(host, recordType)");
  assert.ok(allowlistCheck >= 0 && dnsResolution > allowlistCheck);
});
