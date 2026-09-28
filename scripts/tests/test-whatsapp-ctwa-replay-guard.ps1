param(
  [Parameter(Mandatory = $true)]
  [string]$FixtureContainer
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$migration = Get-Content -Raw (Join-Path $repoRoot 'supabase/migrations/20260904121500_add_ctwa_ad_v2_evolution_clid_contract.sql')
$goSource = Get-Content -Raw (Join-Path $repoRoot 'apps/api/internal/whatsapp/webhook_native_business.go')

function Get-MigrationFunction([string]$name) {
  $pattern = '(?ms)^create or replace function private\.' + [regex]::Escape($name) + '\([^)]*\).*?^\$\$;'
  $match = [regex]::Match($migration, $pattern)
  if (-not $match.Success) { throw "Missing migration function: $name" }
  return $match.Value
}

$touchMatch = [regex]::Match($goSource, '(?ms)^const nativeNonManagedLeadTouchQuery = `(?<query>.*?)^`')
if (-not $touchMatch.Success) { throw 'Missing nativeNonManagedLeadTouchQuery' }
$touchQuery = $touchMatch.Groups['query'].Value

$sqlBefore = @'
begin;
create schema if not exists private;
create schema if not exists auth;
create or replace function auth.role() returns text language sql stable as $$ select ''::text $$;
create table public.leads (
  id uuid primary key,
  organization_id uuid not null,
  metadata jsonb not null,
  last_contact_at timestamptz,
  updated_at timestamptz
);
'@
$sqlMiddle = @'
create trigger validate_managed_whatsapp_ctwa_ad
before insert or update of metadata on public.leads
for each row execute function private.validate_managed_whatsapp_ctwa_ad();

do $fixture$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_lead uuid := '22222222-2222-4222-8222-222222222222';
  v_plain_lead uuid := '33333333-3333-4333-8333-333333333333';
  v_original_proof jsonb := jsonb_build_object(
    'entry_point_conversion_source', 'ctwa_ad',
    'explicit_source_type', 'ad'
  );
  v_reentry_proof jsonb := jsonb_build_object(
    'explicit_source_type', 'ad',
    'ctwa_clid', 'synthetic-clid-12345678',
    'show_ad_attribution', true
  );
  v_patch jsonb;
  v_before jsonb;
  v_after jsonb;
  v_rows integer;
  v_old_failed boolean := false;
  v_invalid_failed boolean := false;
begin
  insert into public.leads (id, organization_id, metadata)
  values (v_lead, v_org, jsonb_build_object(
    'whatsapp_lead_creation_contract', 'ctwa_ad_v2',
    'ctwa_confirmation_method', 'entry_point_ctwa_ad',
    'whatsapp_attribution', v_original_proof,
    'last_whatsapp_session_id', 'original-session'
  ));
  v_patch := jsonb_build_object(
    'whatsapp_attribution', v_reentry_proof,
    'last_whatsapp_session_id', 'reentry-session'
  );
  select metadata into v_before from public.leads where id = v_lead;

  -- Reproduce the old production merge against the real, unchanged trigger.
  begin
    update public.leads set metadata = metadata || v_patch where id = v_lead;
  exception when check_violation then
    if sqlerrm <> 'managed_whatsapp_ctwa_ad_required' then raise; end if;
    v_old_failed := true;
  end;
  if not v_old_failed then raise exception 'old merge unexpectedly succeeded'; end if;
  if (select metadata from public.leads where id = v_lead) is distinct from v_before then
    raise exception 'failed old merge changed lead metadata';
  end if;

  execute $touch$
'@
$sqlAfter = @'
$touch$ using v_org, v_lead, '2026-09-28T12:00:00Z'::timestamptz, v_patch;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'guarded update did not touch exactly one lead'; end if;
  select metadata into v_after from public.leads where id = v_lead;
  if v_after->'whatsapp_attribution' is distinct from v_original_proof
     or v_after->>'ctwa_confirmation_method' <> 'entry_point_ctwa_ad'
     or private.whatsapp_metadata_ctwa_confirmation_method(v_after) <> 'entry_point_ctwa_ad'
     or v_after->>'last_whatsapp_session_id' <> 'reentry-session' then
    raise exception 'guarded update did not preserve creation proof and refresh session';
  end if;

  execute $touch$
'@
$sqlAfterAgain = @'
$touch$ using v_org, v_lead, '2026-09-28T12:00:00Z'::timestamptz, v_patch;
  if (select metadata from public.leads where id = v_lead) is distinct from v_after then
    raise exception 'guarded replay changed metadata on repeat';
  end if;

  -- The integrity trigger must still reject a forged replacement proof.
  begin
    update public.leads set metadata = metadata || jsonb_build_object(
      'whatsapp_attribution', jsonb_build_object('explicit_source_type', 'ad')
    ) where id = v_lead;
  exception when check_violation then
    if sqlerrm <> 'managed_whatsapp_ctwa_ad_required' then raise; end if;
    v_invalid_failed := true;
  end;
  if not v_invalid_failed then raise exception 'integrity trigger accepted invalid proof'; end if;

  -- A lead without a CTWA creation contract still records fresh attribution.
  insert into public.leads (id, organization_id, metadata)
  values (v_plain_lead, v_org, '{}'::jsonb);
  execute $touch$
'@
$sqlEnd = @'
$touch$ using v_org, v_plain_lead, '2026-09-28T12:00:00Z'::timestamptz, v_patch;
  if (select metadata->'whatsapp_attribution' from public.leads where id = v_plain_lead)
     is distinct from v_reentry_proof then
    raise exception 'ordinary lead lost event attribution';
  end if;
  raise notice 'ctwa replay guard fixture passed';
end;
$fixture$;
rollback;
'@

$sql = $sqlBefore + "`n" +
  (Get-MigrationFunction 'whatsapp_metadata_ctwa_confirmation_method') + "`n" +
  (Get-MigrationFunction 'validate_managed_whatsapp_ctwa_ad') + "`n" +
  $sqlMiddle + $touchQuery + $sqlAfter + $touchQuery + $sqlAfterAgain + $touchQuery + $sqlEnd
$sql | docker exec -i -u postgres $FixtureContainer psql -X -v ON_ERROR_STOP=1 -d postgres -P pager=off
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL fixture failed with exit code $LASTEXITCODE" }
