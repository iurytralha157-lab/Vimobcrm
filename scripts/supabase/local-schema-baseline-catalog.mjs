import assert from 'node:assert/strict';
import { digestJSON, sha256 } from './local-schema-baseline-contract.mjs';

export const REFERENCE_TABLES = ['private.queue_timezone_catalog', 'public.admin_subscription_plans',
  'public.available_permissions', 'public.help_articles', 'public.home_publications'];

export async function referenceDataFingerprint(db, tables = REFERENCE_TABLES) {
  assert.deepEqual(tables, REFERENCE_TABLES, 'Only the five reviewed static reference tables are permitted.');
  const fingerprints = [];
  for (const table of tables) {
    const row = (await db.query(`select count(*)::integer count,coalesce(jsonb_agg(to_jsonb(reference_row)
      order by to_jsonb(reference_row)::text),'[]'::jsonb)::text content from ${table} reference_row`)).rows[0];
    assert.ok(row.count >= 0 && row.count <= 2000);
    fingerprints.push({ table, count: row.count, sha256: sha256(row.content) });
  }
  return { kind: 'vimob-local-reference-data-v1', sha256: digestJSON(fingerprints), tables: fingerprints };
}

function effectiveACL(column, owner, kind) {
  const fallback = kind === null ? "'{}'::aclitem[]" : `pg_catalog.acldefault((${kind})::"char",${owner})`;
  const grantor = 'pg_catalog.pg_get_userbyid(privilege.grantor)';
  const grantee = "case when privilege.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(privilege.grantee) end";
  return `(select coalesce(jsonb_agg(jsonb_build_object('grantor',${grantor},'grantee',${grantee},
    'privilege',privilege.privilege_type,'grantable',privilege.is_grantable)
    order by ${grantor},${grantee},privilege.privilege_type,privilege.is_grantable),'[]'::jsonb)
    from pg_catalog.unnest(coalesce(${column},${fallback})) acl_item
    cross join lateral pg_catalog.aclexplode(array[acl_item]) privilege)`;
}

const TICKET_SEQUENCE = /^lead_distribution_ticket_[0-9a-f]{32}$/;
export async function validateRuntimeTicketSequences(db) {
  const rows = (await db.query(`select c.relname,c.relkind,c.relpersistence,c.reloptions,pg_catalog.pg_get_userbyid(c.relowner) owner,
    q.seqtypid::regtype::text type,q.seqstart::text start,q.seqincrement::text increment,q.seqmin::text minimum,
    q.seqmax::text maximum,q.seqcache::text cache,q.seqcycle cycle,${effectiveACL('c.relacl','c.relowner',"'s'")} acl,
    (select count(*)::integer from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype in ('a','i','e')) owned_dependencies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_sequence q on q.seqrelid=c.oid
    where n.nspname='private' and c.relname ~ '^lead_distribution_ticket_[0-9a-f]{32}$' order by c.relname`)).rows;
  for (const row of rows) {
    assert.equal(row.relkind, 'S', 'Runtime ticket name is not a sequence.');
    assert.equal(row.relpersistence, 'p'); assert.equal(row.reloptions, null);
    assert.equal(row.owner, 'postgres'); assert.equal(row.type, 'bigint');
    assert.equal(row.increment, '1'); assert.equal(row.minimum, '1');
    assert.equal(row.maximum, '9223372036854775807'); assert.equal(row.cache, '1'); assert.equal(row.cycle, false);
    assert.ok(BigInt(row.start) >= 1n && BigInt(row.start) <= 9223372036854775807n);
    assert.equal(row.owned_dependencies, 0, 'Runtime ticket has unexpected table/extension ownership.');
    assert.deepEqual(row.acl, ['SELECT','UPDATE','USAGE'].map(privilege => ({ grantee:'postgres', grantor:'postgres', grantable:false, privilege })), 'Runtime ticket privileges differ from the canonical private counter.');
  }
  return rows.length;
}

// Catalog proof deliberately contains definitions/privileges, never table rows,
// connection strings, tokens, Vault values or provider configuration values.
export async function catalogFingerprint(db, { excludeLocalCron = false } = {}) {
  const priorSearchPath = (await db.query("select pg_catalog.current_setting('search_path') value")).rows[0].value;
  await db.query("set search_path = ''");
  let failed = false;
  try {
  await validateRuntimeTicketSequences(db);
  const schemas = (await db.query(`select nspname from pg_namespace where nspname !~ '^pg_'
    and nspname not in ('information_schema','vimob_local_bootstrap','supabase_migrations') order by nspname`)).rows;
  const schemaScope = `(${schemas.map(row => `'${row.nspname.replaceAll("'", "''")}'`).join(',')})`;
  const groups = {
    schemas: `select nspname, pg_get_userbyid(nspowner) owner, ${effectiveACL('nspacl','nspowner',"'n'")} acl
      from pg_namespace where nspname in ('public','private') order by 1`,
    extensions: `select e.extname, e.extversion, n.nspname schema, pg_get_userbyid(e.extowner) owner
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1`,
    relations: `select n.nspname schema,c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
      c.relreplident,c.reloptions,pg_get_userbyid(c.relowner) owner,${effectiveACL('c.relacl','c.relowner',"case when c.relkind='S' then 's' else 'r' end")} acl
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S','f') order by 1,2`,
    columns: `select n.nspname schema,c.relname,a.attname,(row_number() over(partition by a.attrelid order by a.attnum))::integer ordinal,format_type(a.atttypid,a.atttypmod) type,
      a.attnotnull,a.attidentity,a.attgenerated,a.attstorage,${effectiveACL('a.attacl','c.relowner',null)} acl,
      pg_get_expr(d.adbin,d.adrelid) default_value,co.collname collation
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      left join pg_collation co on co.oid=a.attcollation
      where n.nspname in ('public','private') and a.attnum>0 and not a.attisdropped order by 1,2,4`,
    functions: `select n.nspname schema,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
      pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,${effectiveACL('p.proacl','p.proowner',"'f'")} acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.prokind in ('f','p') order by 1,2,3`,
    triggers: `select n.nspname schema,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and (n.nspname in ('public','private') or (n.nspname='auth' and c.relname='users')) order by 1,2,3`,
    constraints: `select n.nspname schema,c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,
      pg_get_constraintdef(k.oid,true) definition from pg_constraint k join pg_class c on c.oid=k.conrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') order by 1,2,3`,
    indexes: `select n.nspname schema,c.relname,i.relname index_name,x.indisvalid,x.indisready,x.indisreplident,
      pg_get_indexdef(i.oid,0,true) definition from pg_index x join pg_class c on c.oid=x.indrelid
      join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') order by 1,2,3`,
    policies: `select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
      where schemaname in ('public','private','storage','realtime') order by 1,2,3`,
    views: `select n.nspname schema,c.relname,pg_get_viewdef(c.oid,true) definition from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('v','m') order by 1,2`,
    enums: `select n.nspname schema,t.typname,e.enumsortorder,e.enumlabel from pg_type t
      join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid
      where n.nspname in ('public','private') order by 1,2,3`,
    domains: `select n.nspname schema,t.typname,format_type(t.typbasetype,t.typtypmod) base,t.typnotnull,t.typdefault,
      pg_get_userbyid(t.typowner) owner,${effectiveACL('t.typacl','t.typowner',"'T'")} acl from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname in ('public','private') and t.typtype='d' order by 1,2`,
    types: `select n.nspname schema,t.typname,t.typtype,pg_get_userbyid(t.typowner) owner,${effectiveACL('t.typacl','t.typowner',"'T'")} acl,
      t.typinput::regprocedure::text input,t.typoutput::regprocedure::text output,t.typcategory
      from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private') order by 1,2`,
    sequences: `select schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size
      from pg_sequences where schemaname in ('public','private') order by 1,2`,
    defaultPrivileges: `select pg_get_userbyid(d.defaclrole) owner,coalesce(n.nspname,'') schema,d.defaclobjtype,${effectiveACL('d.defaclacl','d.defaclrole',null)} acl
      from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
      where n.nspname in ('public','private') or d.defaclnamespace=0 order by 1,2,3`,
    publications: `select p.pubname,pg_get_userbyid(p.pubowner) owner,p.puballtables,p.pubinsert,p.pubupdate,p.pubdelete,p.pubtruncate,p.pubviaroot,
      coalesce((select jsonb_agg(jsonb_build_array(n.nspname,c.relname,r.prattrs::text,pg_get_expr(r.prqual,r.prrelid)) order by n.nspname,c.relname)
      from pg_publication_rel r join pg_class c on c.oid=r.prrelid join pg_namespace n on n.oid=c.relnamespace where r.prpubid=p.oid),'[]'::jsonb) relations
      from pg_publication p order by 1`,
  };
  const catalog = {};
  for (const [name, query] of Object.entries(groups)) {
    // Platform schemas are part of a full Supabase restore, with their ACLs.
    const expanded = query.replaceAll("('public','private')", schemaScope)
      .replaceAll("('public','private','storage','realtime')", schemaScope);
    catalog[name] = (await db.query(expanded)).rows;
    if (excludeLocalCron) catalog[name] = catalog[name].filter(row => row.schema !== 'cron' && row.schemaname !== 'cron' && row.nspname !== 'cron' && row.extname !== 'pg_cron');
    // The QA sentinel is harness infrastructure, never application schema.
    catalog[name] = catalog[name].filter(row => !(row.schema === 'private' &&
      (row.relname === 'queue_homologation_sentinel' || ['queue_homologation_sentinel', '_queue_homologation_sentinel'].includes(row.typname))));
    if (name === 'columns') catalog[name] = catalog[name].filter(row => !(row.schema === 'private' && row.relname === 'queue_homologation_sentinel_pkey' && row.attname === 'singleton'));
    if (['relations','columns','sequences'].includes(name)) catalog[name] = catalog[name].filter(row =>
      !((row.schema === 'private' || row.schemaname === 'private') && TICKET_SEQUENCE.test(row.relname || row.sequencename || '')));
  }
  const runtimeTicketCountersExcluded = await validateRuntimeTicketSequences(db);
  return { kind: 'vimob-local-schema-catalog-v2', sha256: digestJSON(catalog), counts: Object.fromEntries(Object.entries(catalog).map(([key, rows]) => [key, rows.length])), runtimeTicketCountersExcluded, catalog };
  } catch (error) { failed = true; throw error; }
  finally {
    const restore = db.query("select pg_catalog.set_config('search_path',$1,false)", [priorSearchPath]);
    if (failed) await restore.catch(() => {}); else await restore;
  }
}

export function catalogDifferences(before, after) {
  const groups = new Set([...Object.keys(before.catalog), ...Object.keys(after.catalog)]);
  return [...groups].filter(group => digestJSON(before.catalog[group]) !== digestJSON(after.catalog[group]));
}
