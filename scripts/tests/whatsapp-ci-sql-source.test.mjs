import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { materializeSQL, B1_FUNCTION_SOURCE, STRICT_CHECK_SOURCE, QUEUE_COLUMNS_SOURCE, QUEUE_SOURCES } from './whatsapp-ci-sql-source.mjs';
import { schemaSources } from './whatsapp-ci-bootstrap.mjs';

const creativeLedgerSource = 'supabase/migrations/20260903204548_require_ctwa_ad_lead_creation_and_attribution.sql';

test('creative ledger fixture extracts exact table/security/index/FK DDL only', async () => {
  const source = await readFile(new URL('../../' + creativeLedgerSource, import.meta.url));
  const result = materializeSQL(creativeLedgerSource, source), sql = result.bytes.toString();
  assert.equal(result.ddlOnly, true);
  assert.equal(result.ddlBlocks.length, 2);
  assert.deepEqual(result.ddlBlocks.map(block => block.executedSha256), [
    '6548354fd1e25789df9442ace14e101ceb7df15faa8f4197b550ee32a7fd6549',
    '374eec16f84432d4b6ddc874a503ddf0a367c764e21e52f8d853f3814f1605b3',
  ]);
  assert.equal(result.executedSha256, '1a210f420688f8fd9c822962b3ebbb942d55456d7a2c8ff8995e19ce55016b93');
  assert.match(sql, /^create table if not exists private\.whatsapp_meta_creative_event_ledger \(/);
  assert.match(sql, /primary key \(organization_id, whatsapp_session_id, provider_message_id\)/);
  assert.match(sql, /check \(length\(provider_message_id\) between 1 and 500\)/);
  assert.match(sql, /enable row level security/);
  assert.equal((sql.match(/create index if not exists/g) || []).length, 2);
  assert.match(sql, /revoke all on table private\.whatsapp_meta_creative_event_ledger\nfrom public, anon, authenticated, service_role;/);
  for (const table of ['organizations', 'whatsapp_sessions', 'leads'])
    assert.ok(sql.includes(`references public.${table}(id) on delete cascade;`));
  assert.doesNotMatch(sql, /create (?:or replace )?function|create trigger|drop trigger|\binsert into\b|\bupdate public\b|\bdelete from\b|^commit;/im);
});

test('creative ledger fixture rejects canonical/block/delimiter drift', async () => {
  const source = await readFile(new URL('../../' + creativeLedgerSource, import.meta.url));
  for (const changed of [Buffer.concat([source, Buffer.from('\n-- drift')]),
    Buffer.from(source.toString().replace('provider_message_id text not null', 'provider_message_id text')),
    Buffer.from(source.toString().replace('on delete cascade;', 'on delete restrict;')),
    Buffer.from(source.toString().replace('-- The same trigger reserves meta_creative', '-- Changed boundary')),
    Buffer.concat([source, source])]) assert.throws(() => materializeSQL(creativeLedgerSource, changed));
  const canonical = source.toString().replaceAll('\r\n', '\n');
  assert.equal(materializeSQL(creativeLedgerSource, Buffer.from(canonical.replaceAll('\n', '\r\n'))).executedSha256,
    materializeSQL(creativeLedgerSource, source).executedSha256);
});

test('creative ledger fixture is inserted before its canonical consumers in both modes', () => {
  for (const sharedQueue of [false, true]) {
    const sources = schemaSources(sharedQueue);
    assert.equal(sources.filter(file => file === creativeLedgerSource).length, 1);
    assert.ok(sources.indexOf(creativeLedgerSource) < sources.indexOf('supabase/migrations/20260904123000_managed_whatsapp_distribution_auto_reply.sql'));
    assert.ok(sources.indexOf(creativeLedgerSource) > sources.indexOf('supabase/migrations/20260903045350_refine_managed_whatsapp_reentry_and_queue_tags.sql'));
  }
});

test('ordinary canonical SQL is executed byte for byte', () => {
  const source = Buffer.from('select 1;\r\n');
  const result = materializeSQL('ordinary.sql', source);
  assert.deepEqual(result.bytes, source); assert.equal(result.sourceSha256, result.executedSha256);
  assert.throws(() => materializeSQL('ordinary.sql', Buffer.from([0xef, 0xff, 0xff])));
});
for (const relative of [STRICT_CHECK_SOURCE, QUEUE_COLUMNS_SOURCE]) {
  test('only the exact approved DDL is materialized: ' + relative, async () => {
    const source = await readFile(new URL('../../' + relative, import.meta.url));
    const result = materializeSQL(relative, source);
    assert.equal(result.ddlOnly, true); assert.match(result.bytes.toString(), /^alter table /);
    assert.doesNotMatch(result.bytes.toString(), /\b(?:insert|update|delete)\b|^begin;|^commit;/im);
    assert.throws(() => materializeSQL(relative, Buffer.concat([source, Buffer.from('\n-- drift')])));
  });
}
for (const relative of QUEUE_SOURCES) {
  test('canonical shared queue dependency is pinned without transformation: ' + relative, async () => {
    const source = await readFile(new URL('../../' + relative, import.meta.url));
    const result = materializeSQL(relative, source);
    assert.deepEqual(result.bytes, source); assert.equal(result.sourceSha256, result.executedSha256);
    assert.throws(() => materializeSQL(relative, Buffer.concat([source, Buffer.from('\n-- drift')])));
  });
  test('shared dependency rejects weakened authorization and duplicated SQL: ' + relative, async () => {
    const source = await readFile(new URL('../../' + relative, import.meta.url));
    const text = source.toString();
    const changes = relative === QUEUE_SOURCES[0] ? [
      ['q.organization_id=p_organization_id', 'true'],
      ['jsonb_array_length(p_schedule->\'days\') <> 7', 'false'],
    ] : [
      ['organization_id=p_organization_id and lead_id=p_lead_id', 'lead_id=p_lead_id'],
      ['om.membership_generation=m.membership_generation', 'true'],
      ['p_actor_id is distinct from auth.uid()', 'false'],
      ['enable row level security', 'disable row level security'],
      ['from public,anon,authenticated,service_role;', 'from public,anon;'],
    ];
    for (const [before, after] of changes) {
      assert.ok(text.includes(before), 'reviewed authorization/validation anchor changed: ' + before);
      const changed = Buffer.from(text.replace(before, after));
      assert.notDeepEqual(changed, source);
      assert.throws(() => materializeSQL(relative, changed), /reviewed canonical dependency changed/);
    }
    assert.throws(() => materializeSQL(relative, Buffer.concat([source, source])), /reviewed canonical dependency changed/);
  });
}
for (const file of ['20260722000001_baseline_alignment.sql', '20260728183851_unify_lead_distribution.sql']) {
  test('only the reviewed operational block is omitted: ' + file, async () => {
    const relative = 'supabase/migrations/' + file;
    const source = await readFile(new URL('../../' + relative, import.meta.url));
    const result = materializeSQL(relative, source);
    assert.equal(result.operationalOmission, true); assert.notEqual(result.sourceSha256, result.executedSha256);
    assert.ok(result.bytes.length > source.length / 2);
    for (const changed of [Buffer.from(source.toString().replace('pg_net', 'changed').replace('cleanup-round-robin-ticket-sequences', 'changed')),
      Buffer.concat([source, source])]) assert.throws(() => materializeSQL(relative, changed));
  });
}
test('B1 extraction admits only the reviewed signature/body, never activation statements', async () => {
  const source = await readFile(new URL('../../' + B1_FUNCTION_SOURCE, import.meta.url));
  const result = materializeSQL(B1_FUNCTION_SOURCE, source);
  assert.equal(result.functionOnly, true);
  assert.match(result.bytes.toString(), /^create or replace function private\.capture_whatsapp_webhook_routing_snapshot_v2\(/);
  assert.match(result.bytes.toString(), /\n\$\$;$/);
  assert.doesNotMatch(result.bytes.toString(), /alter table|^begin;|^commit;|app_ready_release|^revoke |^grant /m);
  for (const changed of [Buffer.from(source.toString().replace('p_processing_epoch integer', 'p_processing_epoch bigint')),
    Buffer.from(source.toString().replace('\n$$;', '\n$changed$;')), Buffer.concat([source, source])]) {
    assert.throws(() => materializeSQL(B1_FUNCTION_SOURCE, changed));
  }
});
