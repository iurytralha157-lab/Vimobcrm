import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Fixed memory database only. No application env, network transport, installed
// PostgreSQL, services or full Supabase migration chain are used by this test.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselineFile = 'supabase/migrations/20260722000000_production_public_private_baseline.sql';
const triggerFile = 'supabase/migrations/20260921115616_add_silent_historical_lead_import.sql';
const migrationFile = 'supabase/migrations/20261019224603_guard_lead_financial_values_and_generated_amounts.sql';
const moduleFile = process.env.VIMOB_PGLITE_MODULE || resolve(repository, '../../outputs/auditoria-agenda-2026-10-12/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const artifacts = process.env.PIPELINE_FINANCIAL_SQL_ARTIFACT_DIR;
const sourceBefore = process.env.PIPELINE_FINANCIAL_SQL_BEFORE === '1';
const org = '10000000-0000-4000-8000-000000000001';
const lead = '20000000-0000-4000-8000-000000000001';
const actor = '30000000-0000-4000-8000-000000000001';
const property = '40000000-0000-4000-8000-000000000001';
const sha = value => createHash('sha256').update(value).digest('hex');
const outcomes = [];
let pg, baseline, triggerSource, migration, engine, originalACL, afterACL;
let PGliteConstructor;

function sourceTable(name) {
  const start = baseline.indexOf(`CREATE TABLE IF NOT EXISTS "public"."${name}" (`);
  assert.notEqual(start, -1);
  const end = baseline.indexOf('\n);', start);
  assert.ok(end > start);
  return baseline.slice(start, end + 3);
}
function sourceFunction() {
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION "public"."create_commission_on_won"()');
  assert.notEqual(start, -1);
  const end = baseline.indexOf('$$;', start);
  return baseline.slice(start, end + 3);
}
function sourceTrigger() {
  const start = triggerSource.indexOf('create trigger trigger_create_commission_on_won\n');
  assert.notEqual(start, -1);
  const end = triggerSource.indexOf('execute function public.create_commission_on_won();', start);
  assert.ok(end > start);
  return triggerSource.slice(start, end + 'execute function public.create_commission_on_won();'.length);
}
async function aclSnapshot(database = pg) {
  return (await database.query(`select p.proowner::regrole::text as owner,p.proacl::text as acl,p.prosecdef,p.proconfig,
    (select relacl::text from pg_class where oid='public.leads'::regclass) as lead_acl,
    (select relrowsecurity from pg_class where oid='public.leads'::regclass) as lead_rls,
    (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.leads'::regclass
      and tgname='trigger_create_commission_on_won') as financial_trigger
    from pg_proc p where p.oid='public.create_commission_on_won()'::regprocedure`)).rows[0];
}

function fixtureSQL() {
  return `create schema private;
    create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create function private.historical_import_effects_suppressed() returns boolean
      language sql immutable as 'select false';
    create table public.organizations(id uuid,default_commission_percentage numeric(5,2) default 5);
    create table public.properties(id uuid,organization_id uuid,preco numeric,valor_venda_avaliado numeric,commission_percentage numeric default 0);
    ${['leads', 'commissions', 'financial_entries'].map(sourceTable).join('\n')}
    alter table public.leads add column operational_effects_suppressed boolean not null default false;
    ${sourceFunction()}
    ${sourceTrigger()}
    revoke all on function public.create_commission_on_won() from public;
    grant execute on function public.create_commission_on_won() to service_role;
    grant select on public.leads to authenticated;
    grant select,insert,update,delete on public.leads to service_role;
    alter table public.leads enable row level security;
    create policy item10_read_only_fixture on public.leads for select to authenticated using(true);`;
}

before(async () => {
  [baseline, triggerSource, migration] = await Promise.all([baselineFile, triggerFile, migrationFile].map(p => readFile(join(repository, p), 'utf8')));
  ({ PGlite: PGliteConstructor } = await import(pathToFileURL(moduleFile).href));
  pg = new PGliteConstructor('memory://');
  engine = (await pg.query('select version() engine')).rows[0].engine;
  await pg.exec(fixtureSQL());
  originalACL = await aclSnapshot();
  if (!sourceBefore) await pg.exec(migration);
  afterACL = await aclSnapshot();
});

after(async () => {
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, sourceBefore ? 'financial-values-sql-before-receipt.json' : 'financial-values-sql-receipt.json'), JSON.stringify({
      scope: 'Literal local migration and canonical source financial trigger/tables in PGlite memory only',
      mode: sourceBefore ? 'before (original trigger only)' : 'after (literal new migration)', engine,
      sourceHashes: Object.fromEntries([[baselineFile, baseline], [triggerFile, triggerSource], [migrationFile, migration]].map(([p, s]) => [p, sha(s)])),
      migrationAppliedTo: 'process-local memory database, never application/real database',
      originalACL, afterACL, outcomes, passed: outcomes.filter(x => x.status === 'pass').length, total: outcomes.length,
      limitations: ['Prerequisite org/property definitions are minimal exact-numeric-type fixtures.',
        'Foreign keys and unrelated production triggers/functions are omitted; no full migration-chain or deployed-state proof.',
        'RLS/role ACL preservation is catalog-checked synthetically, not a JWT/Data API test.',
        'PGlite PostgreSQL 18 is not evidence of multi-session PostgreSQL concurrency or installed production version.',
        'historical_import_effects_suppressed is a fixed-false fixture; row suppression is tested.'],
    }, null, 2) + '\n');
  }
  await pg?.close();
});

async function state() {
  return { lead: (await pg.query('select deal_status,valor_interesse::text as interest,commission_percentage::text as percent,feedback from public.leads')).rows[0],
    commissions: (await pg.query('select amount::text as amount,percentage::text as percent,base_value::text as base from public.commissions order by created_at,id')).rows,
    receivables: (await pg.query("select amount::text as amount from public.financial_entries where type='receivable' order by created_at,id")).rows };
}
async function seed(data) {
  await pg.query('insert into public.organizations(id,default_commission_percentage) values($1,$2::numeric)', [org, data.orgPercent === undefined ? '5' : data.orgPercent]);
  await pg.query('insert into public.properties(id,organization_id,commission_percentage) values($1,$2,$3::numeric)', [property, org, data.propertyPercent === undefined ? '0' : data.propertyPercent]);
  // A test-only disabled trigger reproduces rows that predate the migration.
  // It is restored before the tested operation and rolled back with the fixture.
  if (!sourceBefore && data.legacy) await pg.exec('alter table public.leads disable trigger zzzz_guard_lead_financial_values');
  await pg.query(`insert into public.leads(id,organization_id,assigned_user_id,property_id,name,deal_status,valor_interesse,commission_percentage,operational_effects_suppressed)
    values($1,$2,$3,$4,'Synthetic financial fixture',$5,$6::numeric,$7::numeric,$8)`,
    [lead, org, data.assigned === false ? null : actor, property, data.initialStatus || 'open', data.interest === undefined ? '1000' : data.interest, data.percent === undefined ? '10' : data.percent, !!data.suppressed]);
  if (!sourceBefore && data.legacy) await pg.exec('alter table public.leads enable trigger zzzz_guard_lead_financial_values');
  if (data.existingCommission) await pg.query(`insert into public.commissions(organization_id,lead_id,user_id,amount,percentage,status) values($1,$2,$3,1,1,'paid')`, [org, lead, actor]);
  if (data.existingReceivable) await pg.query(`insert into public.financial_entries(organization_id,lead_id,type,amount) values($1,$2,'receivable',1)`, [org, lead]);
}
function scenario(name, data, expected, operation) {
  test(name, async () => {
    await pg.exec('begin');
    try {
      await seed(data);
      const beforeState = await state();
      await pg.exec('savepoint tested_operation');
      let error = null;
      try {
        if (operation) await operation();
        else await pg.query('update public.leads set deal_status=$2 where id=$1', [lead, data.targetStatus || 'won']);
      } catch (caught) {
        error = { code: caught.code, constraint: caught.constraint, message: caught.message, detail: caught.detail };
        await pg.exec('rollback to savepoint tested_operation');
      }
      const afterState = await state();
      expected({ error, before: beforeState, after: afterState });
      outcomes.push({ name, status: 'pass', data, error, after: afterState });
    } catch (error) {
      outcomes.push({ name, status: 'fail', data, assertion: error.message });
      throw error;
    } finally { await pg.exec('rollback'); }
  });
}
const success = (commissions, receivables, percentages, status = 'won') => result => {
  assert.equal(result.error, null);
  assert.equal(result.after.lead.deal_status, status);
  assert.deepEqual(result.after.commissions.map(x => x.amount), commissions);
  assert.deepEqual(result.after.receivables.map(x => x.amount), receivables);
  if (percentages) assert.deepEqual(result.after.commissions.map(x => x.percent), percentages);
};
const rejected = constraint => result => {
  assert.equal(result.error?.code, '23514');
  assert.equal(result.error?.constraint, constraint);
  assert.equal(result.error?.message, constraint === 'lead_financial_values_contract' ? 'lead_financial_values_invalid' : 'lead_financial_generated_amount_invalid');
  assert.equal(result.error?.detail, undefined, 'safe error must not expose a row/value');
  assert.deepEqual(result.after, result.before, 'entire lead/commission/receivable operation rolls back');
};
const invalid = rejected('lead_financial_values_contract');
const overflow = rejected('lead_financial_generated_amount_contract');

scenario('ordinary override creates unchanged commercial effects', {}, success(['100.00'], ['1000.00'], ['10.00']));
scenario('zero lead commission keeps property fallback', { percent: '0', propertyPercent: '7.5', orgPercent: '3' }, success(['75.00'], ['1000.00'], ['7.50']));
scenario('zero property commission keeps organization fallback', { percent: '0', propertyPercent: '0', orgPercent: '3' }, success(['30.00'], ['1000.00'], ['3.00']));
scenario('all zero fallbacks keep default five', { percent: '0', propertyPercent: '0', orgPercent: '0' }, success(['50.00'], ['1000.00'], ['5.00']));
scenario('all null fallbacks keep default five', { percent: null, propertyPercent: null, orgPercent: null }, success(['50.00'], ['1000.00'], ['5.00']));
scenario('unused invalid property and org fallbacks do not block explicit valid percent', { percent: '10', propertyPercent: 'NaN', orgPercent: '-5' }, success(['100.00'], ['1000.00'], ['10.00']));
scenario('used negative property fallback is rejected before any financial insert', { percent: '0', propertyPercent: '-3' }, invalid);
scenario('used NaN property fallback is rejected safely', { percent: '0', propertyPercent: 'NaN' }, invalid);
scenario('used positive Infinity property fallback is rejected safely', { percent: null, propertyPercent: 'Infinity' }, invalid);
scenario('used underflow property fallback is rejected safely', { percent: '0', propertyPercent: '1e-324' }, invalid);
scenario('used percentage exactly above one hundred is rejected without float rounding', { percent: '0', propertyPercent: '100.0000000000000000000000000000000000000001' }, invalid);
scenario('used organization fallback above one hundred is rejected', { percent: null, propertyPercent: null, orgPercent: '125' }, invalid);
scenario('no assignee ignores invalid fallback and creates receivable only', { assigned: false, percent: '0', propertyPercent: 'NaN' }, success([], ['1000.00']));
scenario('existing commission ignores invalid fallback and only creates receivable', { percent: '0', propertyPercent: 'NaN', existingCommission: true }, success(['1.00'], ['1000.00'], ['1.00']));
scenario('zero value creates no finance and does not evaluate fallback', { interest: '0', percent: '0', propertyPercent: 'NaN' }, success([], []));
scenario('null value creates no finance and does not evaluate fallback', { interest: null, percent: null, propertyPercent: 'NaN' }, success([], []));
scenario('both existing rows keep exact branch behavior', { existingCommission: true, existingReceivable: true }, success(['1.00'], ['1.00'], ['1.00']));
scenario('large interest succeeds with existing receivable and valid derived commission', { interest: '100000000000', percent: '1', existingReceivable: true }, success(['1000000000.00'], ['1.00'], ['1.00']));
scenario('large interest succeeds when both financial rows already exist', { interest: '100000000000', percent: '1', existingCommission: true, existingReceivable: true }, success(['1.00'], ['1.00'], ['1.00']));
scenario('large interest fails only when missing receivable needs oversized amount', { interest: '100000000000', percent: '1' }, overflow);
scenario('existing commission does not hide missing receivable overflow', { interest: '100000000000', percent: '1', existingCommission: true }, overflow);
scenario('no assignee still validates missing receivable amount', { assigned: false, interest: '100000000000' }, overflow);
scenario('no assignee and existing receivable permit large interest', { assigned: false, interest: '100000000000', existingReceivable: true }, success([], ['1.00']));
scenario('derived commission overflow is rejected with an existing receivable', { interest: '100000000000', percent: '100', existingReceivable: true }, overflow);
scenario('highest numeric12,2 receivable value remains valid', { interest: '9999999999.99', percent: '1' }, success(['100000000.00'], ['9999999999.99'], ['1.00']));
scenario('unrounded interest below half-cent boundary remains valid', { interest: '9999999999.994', percent: '1' }, success(['100000000.00'], ['9999999999.99'], ['1.00']));
scenario('rounding overflow rolls back the earlier commission insert too', { interest: '9999999999.995', percent: '1' }, overflow);
scenario('tiny representable values keep existing zero-after-rounding behavior', { interest: '0.0001', percent: '1' }, success(['0.00'], ['0.00'], ['1.00']));
scenario('finite float64 interest does not acquire an arbitrary commercial cap', { interest: '1e308', percent: '1e-306', existingReceivable: true }, success(['1.00'], ['1.00'], ['0.00']));
scenario('row import suppression preserves financial no-effect behavior', { suppressed: true }, success([], []));
scenario('unused invalid fallback is ignored for row-suppressed imported outcome', { suppressed: true, percent: '0', propertyPercent: 'NaN' }, success([], []));

for (const interest of ['-1', 'NaN', 'Infinity', '-Infinity', '1e309', '1e-324']) {
  scenario(`entering won rejects legacy invalid interest ${interest}`, { interest, legacy: true }, invalid);
}
for (const percent of ['-1', 'NaN', 'Infinity', '-Infinity', '101', '100.000000000000000000000000000001', '1e-324']) {
  scenario(`entering won rejects legacy invalid own percentage ${percent}`, { percent, legacy: true, existingCommission: true, existingReceivable: true }, invalid);
}
scenario('no assignee cannot bypass own invalid percentage on entering won', { assigned: false, percent: '-1', legacy: true }, invalid);
scenario('suppression cannot bypass changed invalid own fields', { interest: 'NaN', legacy: true, suppressed: true }, invalid);

for (const status of ['open', 'lost', 'won']) {
  scenario(`unrelated feedback edit preserves legacy invalid financial fields while ${status}`, { interest: '-1', percent: 'NaN', initialStatus: status, legacy: true }, result => {
    success([], [], undefined, status)(result);assert.equal(result.after.lead.feedback, 'legitimate feedback');
    assert.equal(result.after.lead.interest, '-1');assert.equal(result.after.lead.percent, 'NaN');
  }, () => pg.query('update public.leads set feedback=$2 where id=$1', [lead, 'legitimate feedback']));
}
for (const [initialStatus, targetStatus] of [['won', 'open'], ['won', 'lost'], ['lost', 'open'], ['open', 'lost']]) {
  scenario(`${initialStatus} to ${targetStatus} does not require cleansing unchanged invalid legacy values`, { initialStatus, targetStatus, interest: '-1', percent: 'NaN', legacy: true }, success([], [], undefined, targetStatus));
}
scenario('repairing interest does not block on separate unchanged legacy percentage', { interest: '-1', percent: 'NaN', legacy: true }, result => {
  success([], [], undefined, 'open')(result);assert.equal(result.after.lead.interest, '50');assert.equal(result.after.lead.percent, 'NaN');
}, () => pg.query('update public.leads set valor_interesse=50 where id=$1', [lead]));
scenario('repairing percentage does not block on separate unchanged legacy interest', { interest: '-1', percent: 'NaN', legacy: true }, result => {
  success([], [], undefined, 'open')(result);assert.equal(result.after.lead.interest, '-1');assert.equal(result.after.lead.percent, '0');
}, () => pg.query('update public.leads set commission_percentage=0 where id=$1', [lead]));
scenario('clearing financial values remains valid', {}, result => {
  success([], [], undefined, 'open')(result);assert.equal(result.after.lead.interest, null);assert.equal(result.after.lead.percent, null);
}, () => pg.query('update public.leads set valor_interesse=null,commission_percentage=null where id=$1', [lead]));
scenario('changing open lead interest to negative is rejected', {}, invalid, () => pg.query('update public.leads set valor_interesse=-1 where id=$1', [lead]));
scenario('changing won lead percentage above hundred is rejected', { initialStatus: 'won' }, invalid, () => pg.query('update public.leads set commission_percentage=101 where id=$1', [lead]));
scenario('AFTER financial producer rejects a late BEFORE mutation that would skip positive-value condition', {}, invalid, async () => {
  await pg.exec(`create function private.item10_late_mutation() returns trigger language plpgsql as $late$
    begin new.valor_interesse:=-1;return new;end;$late$;
    create trigger zzzzz_item10_late_mutation before update on public.leads for each row execute function private.item10_late_mutation();`);
  await pg.query('update public.leads set deal_status=$2 where id=$1', [lead, 'won']);
});

test('INSERT rejects invalid interest and percentage, including an INSERT already won', async () => {
  const cases = [['-1', '10', 'open'], ['NaN', '10', 'open'], ['1e309', '10', 'open'], ['1e-324', '10', 'open'], ['1000', '101', 'won']];
  for (const [interest, percent, status] of cases) {
    await pg.exec('begin');
    try {
      let error;
      try { await pg.query('insert into public.leads(organization_id,name,valor_interesse,commission_percentage,deal_status) values($1,$2,$3::numeric,$4::numeric,$5)', [org, 'Synthetic insert', interest, percent, status]); }
      catch (caught) { error = caught; }
      assert.equal(error?.code, '23514');assert.equal(error?.constraint, 'lead_financial_values_contract');
    } finally { await pg.exec('rollback'); }
  }
  outcomes.push({ name: 'INSERT invalid financial cases', status: 'pass', cases: cases.length });
});

test('SQL numeric predicate preserves null/zero/subnormals and rejects exact upper percentage violations', { skip: sourceBefore }, async () => {
  const cases = [
    [null, false, true], ['0', false, true], ['-0', true, true], ['1e308', false, true],
    ['1.7976931348623157e308', false, true], ['1e309', false, false],
    ['5e-324', false, true], ['1e-324', false, false],
    ['-1', false, false], ['NaN', false, false], ['Infinity', false, false], ['-Infinity', false, false],
    ['100', true, true], ['100.0000000000000000000000000000000000001', true, false], ['0.0000000001', true, true],
  ];
  for (const [number, percentage, expected] of cases) {
    const actual = (await pg.query('select private.lead_financial_number_is_valid($1::numeric,$2) valid', [number, percentage])).rows[0].valid;
    assert.equal(actual, expected, `${number}/${percentage}`);
  }
  outcomes.push({ name: 'numeric predicate exactness and finite transport bounds', status: 'pass', cases: cases.length });
});

test('literal migration preserves existing financial trigger, owner, security/search path, function and lead ACL/RLS', { skip: sourceBefore }, async () => {
  assert.deepEqual(afterACL, originalACL);
  const helperACL = (await pg.query(`select caller.role,helper.signature,has_function_privilege(caller.role,helper.signature,'execute') allowed
    from(values('anon'),('authenticated'),('service_role'))caller(role)
    cross join(values('private.lead_financial_number_is_valid(numeric,boolean)'),('private.guard_lead_financial_values()'))helper(signature)`)).rows;
  assert.ok(helperACL.every(x => !x.allowed));
  const browserGrants = (await pg.query(`select r.role,has_table_privilege(r.role,'public.leads','insert,update,delete,truncate,references,trigger') any_write,
    has_any_column_privilege(r.role,'public.leads','insert,update,references') any_column_write
    from(values('anon'),('authenticated'))r(role)`)).rows;
  assert.ok(browserGrants.every(x => !x.any_write && !x.any_column_write));
  outcomes.push({ name: 'preserved existing trigger/ACL/owner/search_path/RLS; helpers not exposed', status: 'pass', helperACL, browserGrants });
});

for (const [name, mutate] of [
  ['customized canonical function', async database => {
    await database.exec(sourceFunction().replace('v_org_commission numeric;', 'v_org_commission numeric; -- independent customization'));
  }],
  ['same body with SECURITY INVOKER instead of canonical definer', async database => {
    await database.exec('alter function public.create_commission_on_won() security invoker');
  }],
  ['same body with customized search path', async database => {
    await database.exec('alter function public.create_commission_on_won() set search_path to pg_catalog,public');
  }],
  ['canonical function owner without private schema USAGE', async database => {
    await database.exec(`create role item10_custom_finance_owner nologin;
      grant usage on schema public to item10_custom_finance_owner;
      grant select on public.properties,public.organizations,public.commissions,public.financial_entries to item10_custom_finance_owner;
      grant insert on public.commissions,public.financial_entries to item10_custom_finance_owner;
      alter function public.create_commission_on_won() owner to item10_custom_finance_owner;`);
    assert.equal((await database.query("select has_schema_privilege('item10_custom_finance_owner','private','USAGE') allowed")).rows[0].allowed, false);
  }],
  ['financial trigger missing suppression condition', async database => {
    await database.exec('drop trigger trigger_create_commission_on_won on public.leads');
    await database.exec(sourceTrigger().replace('  and new.operational_effects_suppressed = false\n', ''));
  }],
  ['financial trigger missing historical import condition', async database => {
    await database.exec('drop trigger trigger_create_commission_on_won on public.leads');
    await database.exec(sourceTrigger().replace('  not private.historical_import_effects_suppressed()\n  and ', '  '));
  }],
]) {
  test(`preflight aborts ${name} without replacing code or ACL`, { skip: sourceBefore }, async () => {
    const database = new PGliteConstructor('memory://');
    try {
      await database.exec(fixtureSQL());
      await database.query('insert into public.leads(organization_id,name,feedback) values($1,$2,$3)', [org, 'Unchanged fixture', 'Unrelated existing note']);
      await mutate(database);
      const beforeACL = await aclSnapshot(database);
      const beforeSource = (await database.query("select prosrc from pg_proc where oid='public.create_commission_on_won()'::regprocedure")).rows[0].prosrc;
      let error;
      try { await database.exec(migration); } catch (caught) { error = caught;await database.exec('rollback'); }
      assert.equal(error?.code, '55000');assert.equal(error?.message, 'lead_financial_contract_preflight_failed');
      assert.deepEqual(await aclSnapshot(database), beforeACL);
      assert.equal((await database.query("select prosrc from pg_proc where oid='public.create_commission_on_won()'::regprocedure")).rows[0].prosrc, beforeSource);
      assert.equal((await database.query("select feedback from public.leads")).rows[0].feedback, 'Unrelated existing note');
      const helpers = (await database.query("select to_regprocedure('private.lead_financial_number_is_valid(numeric,boolean)')::text as helper,to_regprocedure('private.guard_lead_financial_values()')::text as guard")).rows[0];
      assert.deepEqual(helpers, { helper: null, guard: null });
      outcomes.push({ name: `preflight drift rejection: ${name}`, status: 'pass', error: { code: error.code, message: error.message } });
    } finally { await database.close(); }
  });
}
