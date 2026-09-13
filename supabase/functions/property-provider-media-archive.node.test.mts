import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationName = "20260908113000_archive_provider_property_assets.sql";
const migration = readFileSync(
  new URL(`../migrations/${migrationName}`, import.meta.url),
  "utf8",
);

function between(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing section start: ${start}`);
  assert.ok(endIndex > startIndex, `missing section end: ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("provider media archive is a forward-only migration", () => {
  assert.ok(
    migrationName > "20260908101026_reconcile_provider_property_assets.sql",
    "logical archive migration must run after the provider reconciliation foundation",
  );
  assert.match(migration, /^begin;[\s\S]+commit;\s*$/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.property_assets/i);
});

test("only a complete gallery retires this provider and shared ownership survives", () => {
  const retirement = between(
    "-- Only a complete upstream gallery",
    "select pg_catalog.count(*)::integer\n    into v_existing_photo_count",
  );

  assert.match(retirement, /if p_gallery_complete is true then/);
  assert.match(
    retirement,
    /property_asset_integration_providers\(asset\.metadata\) - v_provider\s+as remaining_providers/,
  );
  assert.match(retirement, /jsonb_array_length\(absence\.remaining_providers\) = 0/);
  assert.match(retirement, /'integration_retired', true/);
  assert.match(retirement, /'integration_providers', absence\.remaining_providers/);
  assert.match(retirement, /else asset\.is_primary/);
  const setStart = retirement.indexOf("set metadata =");
  const setEnd = retirement.indexOf("from provider_absences as absence", setStart);
  assert.ok(setStart >= 0 && setEnd > setStart);
  const retirementAssignments = retirement.slice(setStart, setEnd);
  assert.doesNotMatch(
    retirementAssignments,
    /\b(?:external_url|storage_path|checksum_sha256|visibility|id)\s*=/,
  );
  assert.match(migration, /p_gallery_complete boolean default false/);
});

test("a provider reactivates managed rows and adopts only legacy-mirror locators in place", () => {
  const reactivation = between(
    "-- Add this provider to current managed rows",
    "insert into public.property_assets (",
  );

  assert.match(reactivation, /update public\.property_assets as asset/);
  assert.match(reactivation, /- 'integration_retired'/);
  assert.match(
    reactivation,
    /property_asset_integration_providers\(asset\.metadata\)[\s\S]+jsonb_build_array\(v_provider\)/,
  );
  assert.match(reactivation, /'integration_managed', true/);
  assert.match(reactivation, /'integration_providers'/);
  assert.match(
    reactivation,
    /metadata->>'integration_managed', 'false'\) = 'true'[\s\S]+or coalesce\(asset\.metadata->>'legacy_mirror', 'false'\) = 'true'/,
  );
  assert.doesNotMatch(reactivation, /- 'legacy_mirror'/);
  assert.match(reactivation, /asset\.external_url = any\(v_urls\)/);
  assert.doesNotMatch(reactivation, /\bset\s+(?:external_url|storage_path|checksum_sha256|visibility|id)\s*=/i);

  const retirement = between(
    "-- Only a complete upstream gallery",
    "select pg_catalog.count(*)::integer\n    into v_existing_photo_count",
  );
  assert.match(retirement, /metadata->>'integration_managed', 'false'\) = 'true'/);
  assert.match(
    retirement,
    /property_asset_integration_providers\(asset\.metadata\) \? v_provider/,
  );

  const insertion = between(
    "insert into public.property_assets (",
    "-- A provider may rotate only its own sole-owned primary",
  );
  assert.match(insertion, /where not exists \([\s\S]+asset\.external_url = source\.url/);
});

test("retired photos do not consume live capacity and metadata changes run the guard", () => {
  const capacity = between(
    "-- The hard limit applies to the current gallery",
    "create or replace function public.reconcile_imported_property_photos(",
  );

  assert.match(
    capacity,
    /coalesce\(asset\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );
  assert.match(
    capacity,
    /before insert or update of organization_id, property_id, asset_type, metadata/,
  );
  assert.match(capacity, /property_assets_photo_capacity/);
  const parentLock = capacity.indexOf("for update;");
  const idempotentLocatorCheck = capacity.indexOf("if tg_op = 'INSERT'", parentLock);
  assert.ok(
    parentLock >= 0 && idempotentLocatorCheck > parentLock,
    "the parent lock must serialize the locator check before capacity is counted",
  );

  assert.match(
    migration,
    /v_existing_photo_count \+ v_activation_photo_count > 20/,
  );
  assert.match(
    migration,
    /retired provider rows do not consume capacity/,
  );
});

test("primary selection and compatibility mirrors contain only active rows", () => {
  const primary = between(
    "-- A provider may rotate only its own sole-owned primary",
    "-- Compatibility columns contain only the active public external gallery",
  );
  assert.match(
    primary,
    /candidate\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );
  assert.match(
    primary,
    /current_primary\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );
  assert.match(
    primary,
    /preserved_primary\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );

  const compatibility = between(
    "-- Compatibility columns contain only the active public external gallery",
    "revoke all on function public.reconcile_imported_property_photos",
  );
  assert.match(
    compatibility,
    /asset\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );
  assert.match(compatibility, /imagem_principal = v_legacy_primary/);
  assert.match(compatibility, /image_urls = v_legacy_urls/);
  assert.match(compatibility, /fotos = pg_catalog\.to_jsonb\(v_legacy_urls\)/);

  const legacyMirror = between(
    "-- Legacy property-column writes remain additive",
    "-- Reassert the backend-only table boundary",
  );
  assert.match(
    legacyMirror,
    /existing_primary\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );
  assert.match(
    legacyMirror,
    /asset\.metadata->>'integration_retired', 'false'\) <> 'true'/,
  );
  assert.match(
    legacyMirror,
    /after insert or update of imagem_principal, image_urls, fotos, metadata/,
  );
  assert.match(legacyMirror, /pg_trigger_depth\(\) > 1/);
  assert.match(
    legacyMirror,
    /set imagem_principal = v_active_primary,[\s\S]+image_urls = v_active_urls,[\s\S]+fotos = pg_catalog\.to_jsonb\(v_active_urls\)/,
  );
  assert.match(
    legacyMirror,
    /property\.image_urls is distinct from v_active_urls/,
  );
});

test("archive metadata shape and privileged boundaries are enforced defensively", () => {
  for (const required of [
    "property_assets_integration_archive_shape_check",
    "property_assets_primary_active_check",
    "validate constraint property_assets_integration_archive_shape_check",
    "validate constraint property_assets_primary_active_check",
    "property_assets_active_property_order_idx",
  ]) {
    assert.match(migration, new RegExp(required));
  }

  assert.match(migration, /metadata->'integration_providers' <@ '\["imoview", "vista"\]'::jsonb/);
  assert.match(migration, /not is_primary[\s\S]+integration_retired/);
  assert.match(
    migration,
    /revoke all on function public\.reconcile_imported_property_photos[\s\S]+from public, anon, authenticated, service_role;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.reconcile_imported_property_photos[\s\S]+to service_role;/,
  );
  assert.match(
    migration,
    /revoke all on table public\.property_assets[\s\S]+from public, anon, authenticated;/,
  );

  const immutabilityGuard = between(
    "-- A service-role writer may still manage manual assets",
    "-- The hard limit applies to the current gallery",
  );
  assert.match(immutabilityGuard, /property_assets_integration_archive_guard/);
  assert.match(immutabilityGuard, /tg_op = 'DELETE'/);
  assert.match(immutabilityGuard, /from public\.properties as property/);
  for (const immutableField of [
    "organization_id",
    "property_id",
    "asset_type",
    "visibility",
    "storage_path",
    "external_url",
    "checksum_sha256",
  ]) {
    assert.match(
      immutabilityGuard,
      new RegExp(`new\\.${immutableField} is distinct from old\\.${immutableField}`),
    );
  }
  assert.match(
    immutabilityGuard,
    /before delete or update of[\s\S]+metadata[\s\S]+execute function private\.enforce_provider_property_asset_archive\(\)/,
  );
});
