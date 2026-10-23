import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const omissions = new Map([
  ['supabase/migrations/20260722000001_baseline_alignment.sql', 'create extension if not exists "pg_net" with schema "public";'],
  ['supabase/migrations/20260728183851_unify_lead_distribution.sql', `do $ticket_cleanup_job$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname = 'cleanup-round-robin-ticket-sequences'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$ticket_cleanup_job$;

select cron.schedule(
  'cleanup-round-robin-ticket-sequences',
  '31 3 * * *',
  $cron$select private.cleanup_orphan_round_robin_ticket_sequences();$cron$
);`],
]);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const B1_FUNCTION_SOURCE = 'supabase/cutovers/20261008_activate_whatsapp_unlinked_epoch.sql';
export const STRICT_CHECK_SOURCE = 'supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql';
export const QUEUE_COLUMNS_SOURCE = 'supabase/migrations/20260920012629_preserve_deleted_round_robin_identity.sql';
export const CREATIVE_LEDGER_SOURCE = 'supabase/migrations/20260903204548_require_ctwa_ad_lead_creation_and_attribution.sql';
export const QUEUE_SOURCES = Object.freeze([
  'supabase/migrations/20261015022236_queue_operating_schedule_contract.sql',
  'supabase/migrations/20261015022536_queue_runtime_state_and_audience.sql',
]);
export const ADDITIONAL_SOURCES = Object.freeze([B1_FUNCTION_SOURCE, STRICT_CHECK_SOURCE, QUEUE_COLUMNS_SOURCE, CREATIVE_LEDGER_SOURCE, ...QUEUE_SOURCES]);
const sourcePins = new Map([
  [CREATIVE_LEDGER_SOURCE, '1943f92d4fd572450f1056a42ba48e443fb85d8718e93ebe6565aaaf8d40b1ba'],
  [STRICT_CHECK_SOURCE, '0caf6cda86a04ea92b55c23877c48dc14c3b002f52f12e093b95852dba8864de'],
  [QUEUE_COLUMNS_SOURCE, 'd594ae0cfccd8adb13797e1107d77680217f8ab7049042567d029bfafaba880e'],
  [QUEUE_SOURCES[0], '8d65e69ae4b910de960bd663cbc582aebf43774ec26eb6fac5226f3ffc97174b'],
  [QUEUE_SOURCES[1], 'facf3823241e589d70f0ee36136cba44e62c4e58f0824e0a2f552f71bb5661ad'],
]);

function creativeLedgerDDL(source, text) {
  const tableAnchor = 'create table if not exists private.whatsapp_meta_creative_event_ledger (';
  const tableEnd = '\n\n-- The same trigger reserves meta_creative';
  const foreignKeyAnchor = "do $$\nbegin\n  if not exists (\n    select 1\n    from pg_catalog.pg_constraint\n    where conrelid = 'private.whatsapp_meta_creative_event_ledger'::regclass";
  for (const anchor of [tableAnchor, tableEnd, foreignKeyAnchor])
    assert.equal(text.split(anchor).length, 2, 'reviewed creative ledger DDL anchor changed/duplicated');
  const tableStart = text.indexOf(tableAnchor), tableFinish = text.indexOf(tableEnd, tableStart);
  const fkStart = text.indexOf(foreignKeyAnchor), fkFinish = text.indexOf('\n$$;', fkStart) + 4;
  assert.ok(tableFinish > tableStart && fkFinish > fkStart);
  const blocks = [
    { name: 'table-indexes-rls-grants', start: tableStart, finish: tableFinish,
      expected: '6548354fd1e25789df9442ace14e101ceb7df15faa8f4197b550ee32a7fd6549' },
    { name: 'foreign-keys', start: fkStart, finish: fkFinish,
      expected: '374eec16f84432d4b6ddc874a503ddf0a367c764e21e52f8d853f3814f1605b3' },
  ];
  const ddlBlocks = blocks.map(block => {
    assert.equal(sha256(text.slice(block.start, block.finish)), block.expected, 'reviewed creative ledger DDL body/delimiter changed');
    return { name: block.name, sourceStartLine: text.slice(0, block.start).split('\n').length,
      sourceEndLine: text.slice(0, block.finish).split('\n').length, executedSha256: block.expected };
  });
  const bytes = Buffer.from(blocks.map(block => text.slice(block.start, block.finish)).join('\n\n') + '\n');
  assert.equal(sha256(bytes), '1a210f420688f8fd9c822962b3ebbb942d55456d7a2c8ff8995e19ce55016b93');
  return { bytes, sourceSha256: sha256(source), canonicalSourceSha256: sha256(text), executedSha256: sha256(bytes),
    operationalOmission: false, ddlOnly: true, ddlBlocks };
}
function ddlBlock(relative, text) {
  const columns = relative === QUEUE_COLUMNS_SOURCE;
  const anchor = columns ? 'alter table public.round_robins\n  add column if not exists deleted_at' :
    'alter table public.whatsapp_webhook_inbox\n  drop constraint if exists whatsapp_webhook_active_routing_snapshot_v1_check;';
  assert.equal(text.split(anchor).length, 2, 'reviewed DDL anchor changed/duplicated');
  const start = text.indexOf(anchor), end = columns ? text.indexOf(';', start) + 1 : text.indexOf('\n\n-- Cover conversations', start);
  assert.ok(end > start);
  const bytes = Buffer.from(text.slice(start, end));
  assert.equal(sha256(bytes), columns ? 'd721ab27b144074f61fe54b72d9fcf32d6d05feb69c691f2aaf04cef033ebe1e' :
    'ef5139b9ebf8a3fc1c78e8c121893fa5ceab06531e81fca402175e284933990d', 'reviewed DDL body/delimiter changed');
  return bytes;
}
const b1Signature = `create or replace function private.capture_whatsapp_webhook_routing_snapshot_v2(
  p_organization_id uuid,
  p_session_id uuid,
  p_provider_message_id text,
  p_inbox_event_key text,
  p_processing_lane text,
  p_routing_key text,
  p_binding_eligible boolean,
  p_identity_aliases text[],
  p_contact_phone text,
  p_context_kind text,
  p_context_proof text,
  p_managed_message_distribution boolean,
  p_managed_event_pending boolean,
  p_managed_event_handled boolean,
  p_rule_id uuid,
  p_origin_round_robin_id uuid,
  p_provider_event_lead_id uuid,
  p_processing_epoch integer
)`;
function b1Function(source) {
  const text = source.toString('utf8').replaceAll('\r\n', '\n');
  assert.equal(sha256(text), '8982da6326e7f6dbcd270b5994bb451fab24fbd8a94fdca1665964a87a12d7bb', 'reviewed B1 source changed');
  assert.equal(text.split(b1Signature).length, 2, 'B1 signature must appear exactly once');
  const start = text.indexOf(b1Signature), end = text.indexOf('\n$$;', start) + 4;
  assert.ok(end > start);
  const bytes = Buffer.from(text.slice(start, end));
  assert.equal(sha256(bytes), 'ec235bb7b9c78bac8f5802ffd7c229fa0ed9b12412efe50ec39b7b8a1db67bed', 'reviewed B1 function body/delimiter changed');
  return bytes;
}

// Only these two reviewed operational statements are omitted. No regex SQL
// filtering, production cutover, scheduler or network executor is permitted.
// The remaining canonical bytes are preserved; both hashes are recorded.
export function materializeSQL(relative, source) {
  assert.deepEqual(Buffer.from(source.toString('utf8')), source, 'SQL must be UTF-8 without replacement');
  const canonical = source.toString('utf8').replaceAll('\r\n', '\n');
  if (sourcePins.has(relative)) assert.equal(sha256(canonical), sourcePins.get(relative), 'reviewed canonical dependency changed: ' + relative);
  if (relative === CREATIVE_LEDGER_SOURCE) return creativeLedgerDDL(source, canonical);
  if ([STRICT_CHECK_SOURCE, QUEUE_COLUMNS_SOURCE].includes(relative)) {
    const bytes = ddlBlock(relative, canonical);
    return { bytes, sourceSha256: sha256(source), executedSha256: sha256(bytes), operationalOmission: false, ddlOnly: true };
  }
  if (relative === B1_FUNCTION_SOURCE) {
    const bytes = b1Function(source);
    return { bytes, sourceSha256: sha256(source), executedSha256: sha256(bytes), operationalOmission: false, functionOnly: true };
  }
  const text = source.toString('utf8');
  let sql = text;
  const omission = omissions.get(relative);
  if (omission) {
    const exact = omission.replace(/\n/g, text.includes('\r\n') ? '\r\n' : '\n');
    assert.equal(text.split(exact).length, 2, 'reviewed operational SQL changed/missing/duplicated: ' + relative);
    sql = text.replace(exact, '-- CI only: reviewed operational extension/scheduler omitted; see source manifest.');
  }
  const bytes = Buffer.from(sql);
  return { bytes, sourceSha256: sha256(source), executedSha256: sha256(bytes), operationalOmission: Boolean(omission) };
}
