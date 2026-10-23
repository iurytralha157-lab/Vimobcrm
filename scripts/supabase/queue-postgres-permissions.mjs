import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed, runtime, claim } from './queue-postgres-fixture.mjs';

export async function runPermissionCases({ observer: db, sessions, test }) {
  const [a] = sessions;
  const metadata = async (f, actor) => (await db.query('select private.queue_pool_metadata($1,$2,$3) result', [f.org, f.lead, actor])).rows[0].result;
  const removeRole = (f, actor) => db.query('delete from public.user_organization_roles where organization_id=$1 and user_id=$2', [f.org, actor]);

  await test('ordinary broker with no custom role retains Go default lead_operate when claiming', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0]; await removeRole(f, actor);
    assert.equal((await metadata(f, actor)).canClaim, true);
    assert.equal((await claim(a, f, actor, 'default-broker', await runtime(db, f))).reason, 'claimed');
  });

  await test('explicit lead_operate denial disables metadata and ordinary broker claim', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0]; await removeRole(f, actor);
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]);
    assert.equal((await metadata(f, actor)).canClaim, false);
    assert.equal((await claim(a, f, actor, 'denied-default', await runtime(db, f))).reason, 'forbidden');
  });

  await test('custom role without lead_operate adds to rather than removes broker defaults', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0];
    await db.query('delete from public.organization_role_permissions where role_id=$1', [f.role]);
    assert.equal((await metadata(f, actor)).canClaim, true);
    assert.equal((await claim(a, f, actor, 'empty-custom-role', await runtime(db, f))).reason, 'claimed');
  });

  await test('custom role lead_operate grant permits the same claim as the API resolver', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0];
    assert.equal((await metadata(f, actor)).canClaim, true);
    assert.equal((await claim(a, f, actor, 'custom-grant', await runtime(db, f))).reason, 'claimed');
  });

  await test('admin inherited wildcard keeps Go precedence over an explicit permission denial', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0];
    await db.query("update public.organization_members set role='admin' where organization_id=$1 and user_id=$2", [f.org, actor]);
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]);
    assert.equal((await metadata(f, actor)).canClaim, true);
    assert.equal((await claim(a, f, actor, 'admin-wildcard', await runtime(db, f))).reason, 'claimed');
  });

  await test('custom role wildcard keeps Go precedence over an explicit permission denial', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0];
    await db.query("insert into public.organization_role_permissions(organization_id,role_id,permission_key,permission_id) values($1,$2,'*',(select id from public.available_permissions where key='*'))", [f.org, f.role]);
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [f.org, actor]);
    assert.equal((await metadata(f, actor)).canClaim, true);
    assert.equal((await claim(a, f, actor, 'role-wildcard', await runtime(db, f))).reason, 'claimed');
  });

  await test('legacy lead_edit alias denial maps to canonical lead_operate for claim', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0];
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_edit',false)", [f.org, actor]);
    assert.equal((await metadata(f, actor)).canClaim, false);
    assert.equal((await claim(a, f, actor, 'alias-denial', await runtime(db, f))).reason, 'forbidden');
  });

  await test('lead_view_all role grant does not make an outsider a private queue participant', async () => {
    const f = await seed(db, { pool: true }), actor = randomUUID();
    await db.query('insert into public.users(id,name) values($1,$2)', [actor, 'Synthetic outside queue']);
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)', [f.org, actor]);
    await db.query('insert into public.user_organization_roles(organization_id,user_id,role_id) values($1,$2,$3)', [f.org, actor, f.role]);
    await db.query("insert into public.organization_role_permissions(organization_id,role_id,permission_key,permission_id) values($1,$2,'lead_view_all',(select id from public.available_permissions where key='lead_view_all'))", [f.org, f.role]);
    assert.equal(await metadata(f, actor), null);
    assert.equal((await claim(a, f, actor, 'view-all-outsider', await runtime(db, f))).reason, 'forbidden');
  });

  await test('permission denial in one organization does not revoke the same actors other queue', async () => {
    const one = await seed(db, { pool: true }), two = await seed(db, { pool: true }), actor = one.users[0];
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)', [two.org, actor]);
    await db.query('insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position) values($1,$2,$3,$4,10)', [randomUUID(), two.org, two.queue, actor]);
    await db.query("insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,'lead_operate',false)", [one.org, actor]);
    assert.equal((await metadata(one, actor)).canClaim, false); assert.equal((await metadata(two, actor)).canClaim, true);
    assert.equal((await claim(a, one, actor, 'org-denied', await runtime(db, one))).reason, 'forbidden');
    assert.equal((await claim(a, two, actor, 'other-org-default', await runtime(db, two))).reason, 'claimed');
  });

  await test('denying every lead read scope prevents claim despite lead_operate permission', async () => {
    const f = await seed(db, { pool: true }), actor = f.users[0];
    await db.query(`insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed)
      select $1,$2,key,false from unnest(array['lead_view_own','lead_view_team','lead_view_all']) key`, [f.org, actor]);
    assert.equal((await metadata(f, actor)).canClaim, false);
    assert.equal((await claim(a, f, actor, 'no-read-scope', await runtime(db, f))).reason, 'forbidden');
  });
}
